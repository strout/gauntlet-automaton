import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { type ScryfallCard, tileCardImages } from "../../scryfall.ts";
import { formatPool, makeSealedDeck } from "../../sealeddeck.ts";
import {
  type CardCounts,
  COMMON_SLOTS,
  type EchoedRarity,
  type FraQueryKey,
} from "./cards.ts";
import { resolveFraSheet } from "./constants.ts";
import { resolveDiscordId } from "./discord-utils.ts";
import {
  markMirroredDelivered,
  nextPackNumber,
  pendingMirroredCards,
  readMirroredCards,
  storeMirroredPairs,
} from "./mirrored-cards.ts";
import { empowerJace, holdFracturePack } from "./jace.ts";
import { imageAttachment, poolAccentColor } from "./posting.ts";
import { findRival, getRivalPairs, playerMatcher } from "./rivals.ts";
import {
  findEchoedCardByName,
  fraRollLock,
  rareOrMythicSlot,
  type RolledPair,
  rollMirroredPair,
  rollSlots,
  toSealedDeckEntries,
} from "./rolling.ts";

const FRACTURE_COMMAND_CHANNELS = new Set([
  CONFIG.PACKGEN_CHANNEL_ID,
  CONFIG.BOT_BUNKER_CHANNEL_ID,
]);

/** Chance the common land slot is a dual land (otherwise basic). */
const DUAL_LAND_CHANCE = 0.5;
/** Upgrade odds for the first mirrored slot; the rest stay uncommon. */
const MIRRORED_MYTHIC_CHANCE = 0.048;
const MIRRORED_RARE_CHANCE = 0.234;
const MIRRORED_SLOTS = 3;

/** Commons (and the land) aren't limited; everything else is 1 per pack. */
const maxPackCopies = (slot: FraQueryKey): number =>
  COMMON_SLOTS.has(slot) ? Infinity : 1;

/** 11 non-echoed slots: R/M, 2 U, 5 colored C, 2 any C, 1 land. */
function rollNonEchoedSlots(counts: CardCounts): Promise<ScryfallCard[]> {
  const slots: FraQueryKey[] = [
    rareOrMythicSlot(),
    "uncommon",
    "uncommon",
    "whiteCommon",
    "blueCommon",
    "blackCommon",
    "redCommon",
    "greenCommon",
    "anyCommon",
    "anyCommon",
    Math.random() < DUAL_LAND_CHANCE ? "dualLand" : "basicLand",
  ];
  return rollSlots(slots, counts, maxPackCopies);
}

function rollMirroredRarity(slot: number): EchoedRarity {
  if (slot !== 1) return "uncommon";
  const roll = Math.random();
  if (roll < MIRRORED_MYTHIC_CHANCE) return "mythic";
  if (roll < MIRRORED_MYTHIC_CHANCE + MIRRORED_RARE_CHANCE) return "rare";
  return "uncommon";
}

async function rollMirroredPairs(counts: CardCounts): Promise<RolledPair[]> {
  const rivalCounts: CardCounts = new Map();
  const pairs: RolledPair[] = [];
  for (let slot = 1; slot <= MIRRORED_SLOTS; slot++) {
    pairs.push(
      await rollMirroredPair(
        slot,
        rollMirroredRarity(slot),
        counts,
        rivalCounts,
        1,
      ),
    );
  }
  return pairs;
}

/**
 * `!fracture @player …` — rolls a Reality Fracture comeback pack.
 *
 * Only honoured when posted by this bot (match reporting posts
 * `!fracture @loser was defeated … by @winner.` in pack generation).
 *
 * 11 non-echoed cards plus 3 mirrored cards. If the player's rival already
 * opened the matching pack number, the mirrored cards come from the
 * Mirrored Cards tab; otherwise they're rolled here and the partner halves are
 * stored for the rival.
 */
export const fracturePackHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!fracture") return;
  handle.claim();

  if (message.author.id !== message.client.user.id) {
    await message.reply(
      "Fracture packs are rolled automatically when a loss is reported.",
    );
    return;
  }
  if (
    !message.inGuild() || !FRACTURE_COMMAND_CHANNELS.has(message.channelId)
  ) {
    console.error(
      `[fra] Ignoring !fracture outside pack generation / bot bunker: ${message.url}`,
    );
    return;
  }

  const targetId = parts[1] ? resolveDiscordId(parts[1]) : null;
  if (!targetId) {
    console.error(`[fra] !fracture missing player mention: ${message.content}`);
    return;
  }

  const loaded = await resolveFraSheet()
    .then((sheet) =>
      Promise.all([sheet, sheet.getPlayers(), getRivalPairs(sheet)])
    )
    .catch((e) => {
      console.error("[fra] !fracture failed to read sheets:", e);
      return undefined;
    });
  if (!loaded) {
    await message.reply(
      "Couldn't read the FRA spreadsheet (Player Database / Rival Pairings). Check logs.",
    );
    return;
  }
  const [sheet, players, rivalPairs] = loaded;
  const player = players.rows.find((p) => p["Discord ID"] === targetId);
  if (!player) {
    await message.reply(
      `<@${targetId}> isn't on the Reality Fracture Player Database.`,
    );
    return;
  }

  const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));
  const rivalFromPairings = findRival(
    rivalPairs,
    player.Identification,
    samePlayer,
  );
  if (!rivalFromPairings) {
    await message.reply(
      `No rival found for **${player.Identification}** on Rival Pairings.`,
    );
    return;
  }
  const rival =
    players.rows.find((p) => samePlayer(p.Identification, rivalFromPairings))
      ?.Identification ?? rivalFromPairings;

  const packGen = await message.client.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel | null;
  if (!packGen) {
    await message.reply("Pack generation channel not found.");
    return;
  }

  using _ = await fraRollLock();

  try {
    const held = await holdFracturePack(sheet, targetId).catch((e) => {
      console.error("[fra] Couldn't check for a pending Jace choice:", e);
      return undefined;
    });
    if (held) {
      await packGen.send(held);
      return;
    }
  } catch (e) {
    console.error("[fra] Failed to post held Fracture pack notice:", e);
    return;
  }

  try {
    const mirroredRows = await readMirroredCards(sheet);
    const packNumber = nextPackNumber(
      mirroredRows,
      player.Identification,
      samePlayer,
    );
    const pending = pendingMirroredCards(
      mirroredRows,
      player.Identification,
      packNumber,
      samePlayer,
    );

    const counts: CardCounts = new Map();
    const nonEchoed = await rollNonEchoedSlots(counts);

    let mirroredCards: ScryfallCard[];
    let rolledPairs: RolledPair[] | undefined;
    if (pending.length > 0) {
      if (pending.length !== MIRRORED_SLOTS) {
        console.warn(
          `[fra] ${player.Identification} pack ${packNumber}: expected ` +
            `${MIRRORED_SLOTS} pending mirrored cards, found ${pending.length}`,
        );
      }
      mirroredCards = await Promise.all(
        pending.map((r) => findEchoedCardByName(r.card)),
      );
    } else {
      rolledPairs = await rollMirroredPairs(counts);
      mirroredCards = rolledPairs.map((p) => p.ownerScryfall);
    }

    const packCards = [...nonEchoed, ...mirroredCards];
    const sideboard = toSealedDeckEntries(packCards);
    const packPoolId = await makeSealedDeck({ sideboard });

    if (rolledPairs) {
      await storeMirroredPairs(
        sheet,
        player.Identification,
        rival,
        packNumber,
        rolledPairs,
        packPoolId,
      );
    } else {
      await markMirroredDelivered(sheet, pending, packPoolId);
    }

    let combinedPoolId: string | undefined;
    try {
      const poolChanges = await sheet.getPoolChanges();
      const currentPoolId = poolChanges.rows
        .filter((c) => c.Name === player.Identification)
        .findLast((c) => c["Full Pool"])?.["Full Pool"] ?? undefined;
      combinedPoolId = await makeSealedDeck({ sideboard }, currentPoolId);
      await sheet.addPoolChange(
        player.Identification,
        "add pack",
        packPoolId,
        `Fracture pack #${packNumber}`,
        combinedPoolId,
      );
    } catch (e) {
      console.error("[fra] Failed to record fracture pack on Pool Changes:", e);
      await message.reply(
        `Pack rolled, but recording it on Pool Changes failed. CC <@${CONFIG.OWNER_ID}>`,
      );
    }

    const image = await imageAttachment(
      tileCardImages(packCards, "small"),
      "pack.png",
      "FRA comeback pack",
    );
    const embed = new djs.EmbedBuilder()
      .setTitle(`FRA comeback pack — ${player.Identification}`)
      .setDescription(formatPool({ sideboard }))
      .setColor(poolAccentColor(packCards))
      .addFields([
        ...(combinedPoolId
          ? [{
            name: "Combined pool",
            value: `[Open pool](https://sealeddeck.tech/${combinedPoolId})`,
            inline: true,
          }]
          : []),
        {
          name: "This pack only",
          value: `[Pack contents](https://sealeddeck.tech/${packPoolId})`,
          inline: true,
        },
      ])
      .setTimestamp();
    if (image) embed.setImage("attachment://pack.png");

    await packGen.send({
      content: `<@${targetId}> — comeback pack (loss)`,
      embeds: [embed],
      files: image ? [image] : [],
    });

    // Jace's abilities target this pack's Pool Changes row, so skip him if
    // recording failed.
    if (combinedPoolId) {
      try {
        await empowerJace(message.client, sheet, targetId, {
          poolId: packPoolId,
          label: `Fracture pack #${packNumber}`,
        });
      } catch (e) {
        console.error("[fra] Empower Jace failed:", e);
        await message.reply(
          `Pack rolled, but Empower Jace failed for <@${targetId}>: ${
            e instanceof Error ? e.message : e
          }. CC <@${CONFIG.OWNER_ID}>`,
        );
      }
    }
  } catch (e) {
    console.error("[fra] !fracture failed:", e);
    await message.reply("Failed to roll Fracture pack. Check logs.");
  }
};
