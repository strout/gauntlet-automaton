import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../config.ts";
import { Handler } from "../dispatch.ts";
import { type ScryfallCard, tileCardImages } from "../scryfall.ts";
import { formatPool, makeSealedDeck } from "../sealeddeck.ts";
import {
  type CardCounts,
  COMMON_SLOTS,
  type EchoedRarity,
  type FraQueryKey,
} from "../archive/leagues/fra/cards.ts";
import { poolAccentColor } from "../archive/leagues/fra/posting.ts";
import {
  rareOrMythicSlot,
  type RolledPair,
  rollMirroredPair,
  rollSlots,
  toSealedDeckEntries,
} from "../archive/leagues/fra/rolling.ts";

/** Upgrade odds for the first mirrored slot; the rest stay uncommon. */
const MIRRORED_MYTHIC_CHANCE = 0.048;
const MIRRORED_RARE_CHANCE = 0.234;
const MIRRORED_SLOTS = 3;
/** Chance the common land slot is a dual land (otherwise basic). */
const DUAL_LAND_CHANCE = 0.5;

/** Commons (and the land) aren't limited; everything else is 1 per pack. */
const maxPackCopies = (slot: FraQueryKey): number =>
  COMMON_SLOTS.has(slot) ? Infinity : 1;

/**
 * 11 non-echoed slots, matching a Reality Fracture comeback pack:
 * rare or mythic, 2 uncommon, 5 colored commons, 2 any commons, 1 land.
 */
function rollNonEchoed(counts: CardCounts): Promise<ScryfallCard[]> {
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

function mirroredRarity(slot: number): EchoedRarity {
  if (slot !== 1) return "uncommon";
  const roll = Math.random();
  if (roll < MIRRORED_MYTHIC_CHANCE) return "mythic";
  if (roll < MIRRORED_MYTHIC_CHANCE + MIRRORED_RARE_CHANCE) return "rare";
  return "uncommon";
}

/**
 * Two comeback packs. Each has its own 11 non-echoed cards. The three echoed
 * pairs are rolled once and split, one half into each pack.
 */
async function rollMirroredPackPair(): Promise<
  readonly [readonly ScryfallCard[], readonly ScryfallCard[]]
> {
  const countsA: CardCounts = new Map();
  const countsB: CardCounts = new Map();
  const [nonEchoedA, nonEchoedB] = await Promise.all([
    rollNonEchoed(countsA),
    rollNonEchoed(countsB),
  ]);
  const usedPairs = new Set<string>();
  const pairs: RolledPair[] = [];
  for (let slot = 1; slot <= MIRRORED_SLOTS; slot++) {
    pairs.push(
      await rollMirroredPair(
        slot,
        mirroredRarity(slot),
        countsA,
        countsB,
        1,
        usedPairs,
      ),
    );
  }
  return [
    [...nonEchoedA, ...pairs.map((pair) => pair.ownerScryfall)],
    [...nonEchoedB, ...pairs.map((pair) => pair.rivalScryfall)],
  ];
}

async function isLeagueCommittee(
  client: djs.Client,
  userId: string,
): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    return member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID);
  } catch {
    return false;
  }
}

async function packImage(
  cards: readonly ScryfallCard[],
  name: string,
): Promise<djs.AttachmentBuilder | undefined> {
  try {
    const blob = await tileCardImages(cards, "small");
    return new djs.AttachmentBuilder(Buffer.from(await blob.arrayBuffer()), {
      name,
      description: "Mirrored pack",
    });
  } catch (err) {
    console.error(`[mirrored] Failed to build ${name}:`, err);
    return undefined;
  }
}

async function packEmbed(
  cards: readonly ScryfallCard[],
  title: string,
  imageName: string,
): Promise<{ embed: djs.EmbedBuilder; file?: djs.AttachmentBuilder }> {
  const sideboard = toSealedDeckEntries(cards);
  const poolId = await makeSealedDeck({ sideboard });
  const file = await packImage(cards, imageName);
  const embed = new djs.EmbedBuilder()
    .setTitle(title)
    .setDescription(formatPool({ sideboard }))
    .setColor(poolAccentColor(cards))
    .addFields({
      name: "This pack only",
      value: `[Pack contents](https://sealeddeck.tech/${poolId})`,
    })
    .setTimestamp();
  if (file) embed.setImage(`attachment://${imageName}`);
  return { embed, file };
}

/**
 * `!mirroredpack` — LC only, bot bunker only. Rolls a pair of Reality Fracture
 * comeback packs and posts them here. Nothing is written to a spreadsheet.
 */
export const mirroredPackHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const command = message.content.trim().split(/\s+/)[0]?.toLowerCase();
  if (command !== "!mirroredpack") return;
  handle.claim();

  if (!message.inGuild() || !message.channel.isTextBased()) {
    await message.reply("Use this command in a server channel.");
    return;
  }
  if (message.channelId !== CONFIG.BOT_BUNKER_CHANNEL_ID) {
    await message.reply("Use `!mirroredpack` in the bot bunker.");
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply(
      "Only League Committee members can run `!mirroredpack`.",
    );
    return;
  }

  await message.reply("Rolling a mirrored pack pair…");
  try {
    const [packA, packB] = await rollMirroredPackPair();
    const [postedA, postedB] = await Promise.all([
      packEmbed(packA, "Mirrored pack A", "pack-a.png"),
      packEmbed(packB, "Mirrored pack B", "pack-b.png"),
    ]);
    const files = [postedA.file, postedB.file].filter((
      file,
    ): file is djs.AttachmentBuilder => file !== undefined);
    await message.channel.send({
      content:
        "Mirrored pack pair. Each pack has one half of the three echoed cards. Not recorded.",
      embeds: [postedA.embed, postedB.embed],
      files,
    });
  } catch (err) {
    console.error("[mirrored] !mirroredpack failed:", err);
    await message.channel.send(
      "Failed to roll a mirrored pack pair. Check logs.",
    );
  }
};
