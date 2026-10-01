import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { type ScryfallCard, tileRareImages } from "../../scryfall.ts";
import { makeSealedDeck } from "../../sealeddeck.ts";
import {
  type CardCounts,
  COMMON_SLOTS,
  type EchoedRarity,
  type FraQueryKey,
} from "./cards.ts";
import { resolveFraSheet } from "./constants.ts";
import { isLeagueCommittee, resolveDiscordId } from "./discord-utils.ts";
import {
  readMirroredCards,
  STARTING_POOL_PACK_NUMBER,
  storeMirroredPairs,
} from "./mirrored-cards.ts";
import { imageAttachment, poolAccentColor } from "./posting.ts";
import { findRival, getRivalPairs, playerMatcher } from "./rivals.ts";
import {
  fraRollLock,
  rareOrMythicSlot,
  type RolledPair,
  rollMirroredPair,
  rollSlots,
  toSealedDeckEntries,
} from "./rolling.ts";

const POOL_COMMAND_CHANNELS = new Set([
  CONFIG.STARTING_POOL_CHANNEL_ID,
  CONFIG.BOT_BUNKER_CHANNEL_ID,
]);

/** Mythic odds for each mirrored rare/mythic pair (otherwise rare). */
const MIRRORED_MYTHIC_CHANCE = 0.17647;
const MIRRORED_RARE_MYTHIC_PAIRS = 2;
const MIRRORED_UNCOMMON_PAIRS = 16;

/** Starting pool copy limits per player. */
const MAX_COMMON_COPIES = 4;
const MAX_OTHER_COPIES = 2;

const maxStartingCopies = (slot: FraQueryKey): number =>
  COMMON_SLOTS.has(slot) ? MAX_COMMON_COPIES : MAX_OTHER_COPIES;

const repeat = (key: FraQueryKey, n: number): FraQueryKey[] =>
  Array.from({ length: n }, () => key);

/**
 * 62 unmirrored slots: 7 R/M, 12 U, 7 of each color common, 5 any common,
 * 3 common dual lands.
 */
function rollUnmirroredSlots(counts: CardCounts): Promise<ScryfallCard[]> {
  const slots: FraQueryKey[] = [
    ...Array.from({ length: 7 }, rareOrMythicSlot),
    ...repeat("uncommon", 12),
    ...repeat("whiteCommon", 7),
    ...repeat("blueCommon", 7),
    ...repeat("blackCommon", 7),
    ...repeat("redCommon", 7),
    ...repeat("greenCommon", 7),
    ...repeat("anyCommon", 5),
    ...repeat("dualLand", 3),
  ];
  return rollSlots(slots, counts, maxStartingCopies);
}

/**
 * 18 mirrored pairs: 2 R/M then 16 U. Owner halves go to player 1, partner
 * halves to player 2; either player may end up with 2 of the same card.
 */
async function rollStartingPairs(
  counts1: CardCounts,
  counts2: CardCounts,
): Promise<RolledPair[]> {
  const rarities: EchoedRarity[] = [
    ...Array.from(
      { length: MIRRORED_RARE_MYTHIC_PAIRS },
      (): EchoedRarity =>
        Math.random() < MIRRORED_MYTHIC_CHANCE ? "mythic" : "rare",
    ),
    ...Array.from(
      { length: MIRRORED_UNCOMMON_PAIRS },
      (): EchoedRarity => "uncommon",
    ),
  ];
  const pairs: RolledPair[] = [];
  for (const [i, rarity] of rarities.entries()) {
    pairs.push(
      await rollMirroredPair(i + 1, rarity, counts1, counts2, MAX_OTHER_COPIES),
    );
  }
  return pairs;
}

/** Replies to the command with the pool embed, pool.txt, and rare image. */
async function postStartingPool(
  command: djs.Message<true>,
  discordId: string,
  identification: string,
  pool: readonly ScryfallCard[],
  poolId: string,
): Promise<void> {
  const member = await command.guild.members.fetch(discordId).catch(() =>
    undefined
  );
  const poolText = new djs.AttachmentBuilder(
    Buffer.from(
      pool.map((c) =>
        `${c.name} (${c.set.toUpperCase()}) ${c.collector_number}`
      ).join("\n"),
      "utf-8",
    ),
    { name: "pool.txt", description: "FRA starting pool card list" },
  );
  const rares = await imageAttachment(
    tileRareImages(pool, "small"),
    "rares.png",
    "Rare and mythic cards from starting pool",
  );

  const embed = new djs.EmbedBuilder()
    .setTitle(
      `FRA Starting Pool — ${member?.displayName ?? identification}`,
    )
    .setColor(poolAccentColor(pool))
    .addFields([
      {
        name: "SealedDeck link",
        value: `https://sealeddeck.tech/${poolId}`,
        inline: false,
      },
      { name: "SealedDeck ID", value: `\`${poolId}\``, inline: true },
      { name: "Total cards", value: pool.length.toString(), inline: true },
    ])
    .setTimestamp();
  if (member) embed.setThumbnail(member.displayAvatarURL({ size: 256 }));
  if (rares) embed.setImage("attachment://rares.png");

  await command.reply({
    content: `<@${discordId}>`,
    embeds: [embed],
    files: rares ? [poolText, rares] : [poolText],
  });
}

/**
 * `!frapool @player1 @player2` — LC only. Rolls both rivals' 80-card starting
 * pools: 62 unmirrored cards each plus 18 mirrored pairs split between them.
 * Pairs are stored on Mirrored Cards as pack #0 and both pools are recorded on
 * Pool Changes.
 */
export const fraPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!frapool") return;
  handle.claim();

  if (!message.inGuild()) {
    await message.reply("Use this command in a server channel.");
    return;
  }
  if (!POOL_COMMAND_CHANNELS.has(message.channelId)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply("Only League Committee members can run `!frapool`.");
    return;
  }

  const id1 = parts[1] ? resolveDiscordId(parts[1]) : null;
  const id2 = parts[2] ? resolveDiscordId(parts[2]) : null;
  if (!id1 || !id2 || id1 === id2) {
    await message.reply("Usage: `!frapool @Player1 @Player2`.");
    return;
  }

  const loaded = await resolveFraSheet()
    .then((sheet) =>
      Promise.all([sheet, sheet.getPlayers(), getRivalPairs(sheet)])
    )
    .catch((e) => {
      console.error("[fra] !frapool failed to read sheets:", e);
      return undefined;
    });
  if (!loaded) {
    await message.reply(
      "Couldn't read the FRA spreadsheet (Player Database / Rival Pairings). Check logs.",
    );
    return;
  }
  const [sheet, players, rivalPairs] = loaded;
  const player1 = players.rows.find((p) => p["Discord ID"] === id1);
  const player2 = players.rows.find((p) => p["Discord ID"] === id2);
  if (!player1 || !player2) {
    const missing = [
      !player1 ? `<@${id1}>` : null,
      !player2 ? `<@${id2}>` : null,
    ].filter(Boolean);
    await message.reply(
      `Not on the Reality Fracture Player Database: ${missing.join(", ")}.`,
    );
    return;
  }
  const name1 = player1.Identification;
  const name2 = player2.Identification;
  const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));

  const listedRival = findRival(rivalPairs, name1, samePlayer);
  if (!listedRival || !samePlayer(listedRival, name2)) {
    await message.reply(
      `**${name1}** and **${name2}** aren't rivals on Rival Pairings.`,
    );
    return;
  }

  using _ = await fraRollLock();

  try {
    const [poolChanges, mirroredRows] = await Promise.all([
      sheet.getPoolChanges(),
      readMirroredCards(sheet),
    ]);
    const alreadyRolled = [name1, name2].filter((name) =>
      poolChanges.rows.some((c) =>
        c.Type === "starting pool" && samePlayer(c.Name, name)
      ) ||
      mirroredRows.some((r) =>
        r.packNumber === STARTING_POOL_PACK_NUMBER && samePlayer(r.owner, name)
      )
    );
    if (alreadyRolled.length > 0) {
      await message.reply(
        `Starting pool already on file for ${
          alreadyRolled.map((n) => `**${n}**`).join(" and ")
        }.`,
      );
      return;
    }

    await message.reply(
      `Rolling Reality Fracture starting pools for <@${id1}> and <@${id2}>…`,
    );

    const counts1: CardCounts = new Map();
    const counts2: CardCounts = new Map();
    const [unmirrored1, unmirrored2, pairs] = await Promise.all([
      rollUnmirroredSlots(counts1),
      rollUnmirroredSlots(counts2),
      rollStartingPairs(counts1, counts2),
    ]);
    const pool1 = [...unmirrored1, ...pairs.map((p) => p.ownerScryfall)];
    const pool2 = [...unmirrored2, ...pairs.map((p) => p.rivalScryfall)];

    const [poolId1, poolId2] = await Promise.all([
      makeSealedDeck({ sideboard: toSealedDeckEntries(pool1) }),
      makeSealedDeck({ sideboard: toSealedDeckEntries(pool2) }),
    ]);

    await storeMirroredPairs(
      sheet,
      name1,
      name2,
      STARTING_POOL_PACK_NUMBER,
      pairs,
      poolId1,
      poolId2,
    );

    const rolls = [
      { id: id1, name: name1, pool: pool1, poolId: poolId1 },
      { id: id2, name: name2, pool: pool2, poolId: poolId2 },
    ];
    for (const roll of rolls) {
      await sheet.addPoolChange(
        roll.name,
        "starting pool",
        roll.poolId,
        "FRA starting pool",
        roll.poolId,
      );
      await postStartingPool(
        message,
        roll.id,
        roll.name,
        roll.pool,
        roll.poolId,
      );
    }

    await message.reply(
      `Starting pools recorded for **${name1}** ` +
        `(https://sealeddeck.tech/${poolId1}) and **${name2}** ` +
        `(https://sealeddeck.tech/${poolId2}).`,
    );
  } catch (e) {
    console.error("[fra] !frapool failed:", e);
    await message.reply(
      `Failed to roll starting pools for <@${id1}> and <@${id2}>. Check logs.`,
    );
  }
};
