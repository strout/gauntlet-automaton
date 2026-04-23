import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { choice, shuffle, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards, tileRareImages } from "../../scryfall.ts";
import { makeSealedDeck } from "../../sealeddeck.ts";
import { addPoolChange, getPlayers } from "../../standings.ts";

export const BASE_MAIN_POOL_SEARCH = `game:arena s:sos -t:basic`;

/**
 * Full Scryfall query (without `unique:` — pass `{ unique: "cards" }` to `searchCards`)
 * for the six Mythical Archive slots. Replace with the final SOS query when ready.
 */
export const SOS_MYTHICAL_ARCHIVE_SCRYFALL_QUERY = "s:soa game:arena -t:basic";

const MAX_DECADE_ATTEMPTS = 25_000;

/** Where `!sos-pool` may run; also where posted pools trigger a Pool Changes row. */
const SOS_POOL_COMMAND_CHANNEL_IDS = new Set([
  CONFIG.STARTING_POOL_CHANNEL_ID,
  CONFIG.BOT_BUNKER_CHANNEL_ID,
]);

export function splitMythicalArchiveByRarity(cards: readonly ScryfallCard[]): {
  readonly uncommons: readonly ScryfallCard[];
  readonly rares: readonly ScryfallCard[];
  readonly mythics: readonly ScryfallCard[];
} {
  const uncommons: ScryfallCard[] = [];
  const rares: ScryfallCard[] = [];
  const mythics: ScryfallCard[] = [];
  for (const c of cards) {
    if (c.rarity === "uncommon") uncommons.push(c);
    else if (c.rarity === "rare") rares.push(c);
    else if (c.rarity === "mythic") mythics.push(c);
  }
  return { uncommons, rares, mythics };
}

/** Stable identity for duplicate checks within a decade (10-card pack). */
function commonIdentity(card: ScryfallCard): string {
  return card.oracle_id ??
    `${card.name}\0${card.set}\0${card.collector_number}`;
}

/** Colors used for WUBRG coverage (front face `colors`, else `color_identity`). */
function wubrgOnCard(card: ScryfallCard): ReadonlySet<string> {
  const fromColors = card.colors?.filter((c) =>
    c === "W" || c === "U" || c === "B" || c === "R" || c === "G"
  );
  if (fromColors && fromColors.length > 0) {
    return new Set(fromColors);
  }
  return new Set(
    card.color_identity.filter((c) =>
      c === "W" || c === "U" || c === "B" || c === "R" || c === "G"
    ),
  );
}

function decadeCoversWubrg(cards: readonly ScryfallCard[]): boolean {
  const seen = new Set<string>();
  for (const card of cards) {
    for (const c of wubrgOnCard(card)) {
      seen.add(c);
    }
  }
  return (
    seen.has("W") && seen.has("U") && seen.has("B") && seen.has("R") &&
    seen.has("G")
  );
}

/**
 * Rolls 10 distinct commons such that W, U, B, R, and G each appear on at least
 * one card in the decade. Returns null if `maxAttempts` is exceeded.
 */
function rollCommonDecade(
  commons: readonly ScryfallCard[],
  dualLands: readonly ScryfallCard[],
  maxAttempts: number,
): ScryfallCard[] | null {
  const wubrg = ["W", "U", "B", "R", "G"] as const;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const used = new Set<string>();

    const tryAdd = (
      decade: ScryfallCard[],
      card: ScryfallCard | undefined,
    ): boolean => {
      if (!card) return false;
      const id = commonIdentity(card);
      if (used.has(id)) return false;
      used.add(id);
      decade.push(card);
      return true;
    };

    const colorCover: ScryfallCard[] = [];
    const colorOrder = shuffle([...wubrg]);
    let failed = false;
    for (const color of colorOrder) {
      const candidates = commons.filter((c) =>
        !used.has(commonIdentity(c)) && wubrgOnCard(c).has(color)
      );
      const c = choice(candidates);
      if (!tryAdd(colorCover, c)) {
        failed = true;
        break;
      }
    }

    if (failed || colorCover.length !== 5 || !decadeCoversWubrg(colorCover)) {
      continue;
    }

    const fillerPool = shuffle(
      commons.filter((c) => !used.has(commonIdentity(c))),
    );
    if (fillerPool.length < 5) continue;

    const fillers: ScryfallCard[] = [];
    for (let i = 0; i < 5; i++) {
      if (!tryAdd(fillers, fillerPool[i])) {
        failed = true;
        break;
      }
    }

    if (failed || fillers.length !== 5) continue;

    const decade = [...colorCover, ...fillers];
    if (decadeCoversWubrg(decade)) {
      if (Math.random() < 0.5) {
        const replaceIdx = Math.floor(Math.random() * decade.length);
        const dualLand = choice(dualLands);
        if (dualLand) {
          decade[replaceIdx] = dualLand;
        }
      }
      return decade;
    }
  }

  return null;
}

function resolveDiscordId(input: string): string | null {
  const mentionMatch = input.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

/**
 * Rolls a starting SOS pool: 6 rare/mythic (7:1 rare weighting), 18 uncommons,
 * 60 commons (six packs of 10: unique within each pack, each pack touches all
 * five colors), 6 Mythical Archive cards (5 uncommons + 1 rare/mythic at
 * rare vs mythic weights `9.6/12.5` and `2.6/12.5` among MA prints).
 */
export async function rollStartingPool(): Promise<ScryfallCard[]> {
  const pool: ScryfallCard[] = [];

  try {
    const [
      rares,
      mythics,
      uncommons,
      commons,
      dualLands,
      mythicalArchive,
    ] = await Promise.all([
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:rare`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common -otag:dual-land`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common otag:dual-land`, {
        unique: "cards",
      }),
      searchCards(SOS_MYTHICAL_ARCHIVE_SCRYFALL_QUERY, { unique: "cards" }),
    ]);

    if (mythicalArchive.length === 0) {
      console.error(
        "SOS rollStartingPool: Mythical Archive query returned no cards.",
      );
      return [];
    }

    const {
      uncommons: maUncommons,
      rares: maRares,
      mythics: maMythics,
    } = splitMythicalArchiveByRarity(mythicalArchive);
    if (maUncommons.length === 0) {
      console.error(
        "SOS rollStartingPool: Mythical Archive query has no uncommons (need 5).",
      );
      return [];
    }
    if (maRares.length === 0 && maMythics.length === 0) {
      console.error(
        "SOS rollStartingPool: Mythical Archive query has no rare or mythic (need 1).",
      );
      return [];
    }

    const rareMythicWeights: [ScryfallCard, number][] = [
      ...rares.map((card): [ScryfallCard, number] => [card, 7]),
      ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
    ];

    for (let i = 0; i < 6; i++) {
      const randomCard = weightedChoice(rareMythicWeights);
      if (randomCard) pool.push(randomCard);
    }

    for (let i = 0; i < 18; i++) {
      const randomCard = choice(uncommons);
      if (randomCard) pool.push(randomCard);
    }

    const poolCommons: ScryfallCard[] = [];
    for (let d = 0; d < 6; d++) {
      const decade = rollCommonDecade(commons, dualLands, MAX_DECADE_ATTEMPTS);
      if (!decade) {
        throw new Error(
          `Could not roll commons decade ${
            d + 1
          }/6 (10 unique cards, all five colors); try again or broaden the common pool.`,
        );
      }
      poolCommons.push(...decade);
    }

    pool.push(...poolCommons);

    for (let i = 0; i < 5; i++) {
      const c = choice(maUncommons);
      if (c) pool.push(c);
    }

    const maRareWt = 9.6 / 12.5;
    const maMythicWt = 2.6 / 12.5;
    const maRareMythicWeights: [ScryfallCard, number][] = [
      ...maRares.map((card): [ScryfallCard, number] => [card, maRareWt]),
      ...maMythics.map((card): [ScryfallCard, number] => [card, maMythicWt]),
    ];
    const maRareOrMythic = weightedChoice(maRareMythicWeights);
    if (maRareOrMythic) pool.push(maRareOrMythic);

    return pool;
  } catch (error) {
    console.error("Error rolling SOS starting pool:", error);
    return [];
  }
}

export function getPoolAccentColor(pool: ScryfallCard[]): number {
  const colorCounts: Record<string, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  for (const card of pool) {
    for (const color of wubrgOnCard(card)) {
      if (color in colorCounts) {
        colorCounts[color]++;
      }
    }
  }

  const mostCommonColor = Object.entries(colorCounts)
    .reduce((a, b) =>
      colorCounts[a[0]] > colorCounts[b[0]]
        ? a
        : colorCounts[a[0]] < colorCounts[b[0]]
        ? b
        : ["M", a[1]]
    )[0];

  const colorHex: Record<string, number> = {
    W: 0xfff9e3,
    U: 0x0e68ab,
    B: 0x7c3aed,
    R: 0xd3202a,
    G: 0x00733e,
  };

  return colorHex[mostCommonColor] || 0xe87800;
}

/**
 * Builds the Discord post (embed, pool.txt, sealeddeck, rare/mythic image). If
 * `replyTo` is set, posts as a reply there (same channel as the command);
 * otherwise sends in `channel`. Records a pool change when that channel is
 * starting-pools or bot bunker.
 */
export async function generateAndPostStartingPool(
  user: djs.User | djs.GuildMember,
  channel: djs.TextChannel,
  replyTo?: djs.Message,
): Promise<void> {
  try {
    console.log(`Generating SOS starting pool for user ${user.id}...`);

    await channel.sendTyping();

    const pool = await rollStartingPool();
    if (pool.length === 0) {
      throw new Error("Failed to generate starting pool");
    }

    const poolContent = pool
      .map((card) =>
        `${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`
      )
      .join("\n");

    const poolBuffer = Buffer.from(poolContent, "utf-8");
    const poolAttachment = new djs.AttachmentBuilder(poolBuffer, {
      name: "pool.txt",
      description: "SOS starting pool card list",
    });

    if (!(user instanceof djs.GuildMember)) {
      user = await channel.guild.members.fetch(user.id).catch(() => user);
    }

    const initialEmbed = new djs.EmbedBuilder()
      .setTitle(`SOS Starting Pool — ${user.displayName}`)
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "SealedDeck link",
          value: "Generating…",
          inline: false,
        },
        {
          name: "SealedDeck ID",
          value: "Generating…",
          inline: true,
        },
        {
          name: "Total cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    const poolPost =
      await (replyTo?.reply.bind(replyTo) ?? channel.send.bind(channel))({
        embeds: [initialEmbed],
        files: [poolAttachment],
      });

    const [sealedDeckResult, rareImageResult] = await Promise.allSettled([
      makeSealedDeck({
        sideboard: pool.map((card) => ({
          name: card.name,
          count: 1,
          set: card.set,
        })),
      }),
      tileRareImages(pool, "small"),
    ]);

    let poolId: string;
    let sealedDeckLink: string;
    if (sealedDeckResult.status === "fulfilled") {
      poolId = sealedDeckResult.value;
      sealedDeckLink = `https://sealeddeck.tech/${poolId}`;
    } else {
      console.error("SealedDeck generation failed:", sealedDeckResult.reason);
      poolId = "Error";
      sealedDeckLink = "Failed to generate";
    }

    let rareImageAttachment: djs.AttachmentBuilder | undefined;
    if (rareImageResult.status === "fulfilled") {
      const rareImageBuffer = Buffer.from(
        await rareImageResult.value.arrayBuffer(),
      );
      rareImageAttachment = new djs.AttachmentBuilder(rareImageBuffer, {
        name: "rares.png",
        description: "Rare and mythic cards from starting pool",
      });
    } else {
      console.error("Rare image generation failed:", rareImageResult.reason);
    }

    const finalEmbed = new djs.EmbedBuilder()
      .setTitle(`SOS Starting Pool — ${user.displayName}`)
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "SealedDeck link",
          value: sealedDeckLink,
          inline: false,
        },
        {
          name: "SealedDeck ID",
          value: `\`${poolId}\``,
          inline: true,
        },
        {
          name: "Total cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    if (rareImageAttachment) {
      finalEmbed.setImage("attachment://rares.png");
    }

    const finalFiles = [poolAttachment];
    if (rareImageAttachment) {
      finalFiles.push(rareImageAttachment);
    }

    try {
      await poolPost.edit({
        embeds: [finalEmbed],
        files: finalFiles,
      });
    } catch (editError) {
      console.error("Failed to edit SOS starting pool message:", editError);
    }

    console.log(`Posted SOS starting pool for user ${user.id}`);

    try {
      if (SOS_POOL_COMMAND_CHANNEL_IDS.has(channel.id)) {
        const { rows } = await getPlayers();
        const playerRow = rows.find((p) => p["Discord ID"] === user.id);
        if (playerRow && poolId !== "Error") {
          await addPoolChange(
            playerRow.Identification,
            "starting pool",
            poolId,
            "SOS starting pool",
            poolId,
          );
          console.log(
            `Added starting pool record for ${playerRow.Identification} (${poolId})`,
          );
        }
      }
    } catch (error) {
      console.error("Error adding pool change record:", error);
    }
  } catch (error) {
    console.error("Error generating and posting SOS starting pool:", error);
    throw error;
  }
}

/**
 * `!sos-pool @Player` — League Committee only; starting pools channel or bot bunker.
 * The pool embed is a reply to the command in that channel.
 */
export const sosStartingPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (!message.content.startsWith("!sos-pool")) return;
  handle.claim();

  if (!message.inGuild()) return;

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  if (!SOS_POOL_COMMAND_CHANNEL_IDS.has(message.channel.id)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) {
      await message.reply(
        "Only League Committee members can use this command.",
      );
      return;
    }
  } catch {
    await message.reply("Could not verify your roles.");
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  if (parts.length < 2) {
    await message.reply("Usage: `!sos-pool @Player`");
    return;
  }

  const discordId = resolveDiscordId(parts[1]);
  if (!discordId) {
    await message.reply(
      "First argument must be a Discord mention or numeric user ID.",
    );
    return;
  }

  const { rows } = await getPlayers();
  const playerRow = rows.find((p) => p["Discord ID"] === discordId);
  if (!playerRow) {
    await message.reply(
      `No player with Discord ID \`${discordId}\` found in the Player Database.`,
    );
    return;
  }

  const channel = message.channel as djs.TextChannel;

  let targetUser: djs.User;
  try {
    targetUser = await message.client.users.fetch(discordId);
  } catch {
    await message.reply("Could not resolve that Discord user.");
    return;
  }

  try {
    await generateAndPostStartingPool(targetUser, channel, message);
  } catch (e) {
    console.error("[SOS] starting pool error:", e);
    await message.reply(
      `Failed to generate pool: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};
