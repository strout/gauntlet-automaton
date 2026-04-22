import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { choice, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import { formatPool, makeSealedDeck } from "../../sealeddeck.ts";
import { addPoolChange, getPoolChanges } from "../../standings.ts";
import {
  BASE_MAIN_POOL_SEARCH,
  SOS_MYTHICAL_ARCHIVE_SCRYFALL_QUERY,
  splitMythicalArchiveByRarity,
} from "./pools.ts";

/** Rarity distribution for the single comeback-pack Mystical Archive card. */
const MYTHICAL_ARCHIVE_COMEBACK_WEIGHTS = {
  uncommon: 87.5,
  rare: 9.6,
  mythic: 2.9,
} as const;

type MaRarityBucket = "uncommon" | "rare" | "mythic";

function rollOneMythicalArchiveComebackCard(
  maUncommons: readonly ScryfallCard[],
  maRares: readonly ScryfallCard[],
  maMythics: readonly ScryfallCard[],
): ScryfallCard | null {
  const buckets: {
    readonly slot: MaRarityBucket;
    readonly cards: readonly ScryfallCard[];
    readonly weight: number;
  }[] = [
    {
      slot: "uncommon",
      cards: maUncommons,
      weight: MYTHICAL_ARCHIVE_COMEBACK_WEIGHTS.uncommon,
    },
    {
      slot: "rare",
      cards: maRares,
      weight: MYTHICAL_ARCHIVE_COMEBACK_WEIGHTS.rare,
    },
    {
      slot: "mythic",
      cards: maMythics,
      weight: MYTHICAL_ARCHIVE_COMEBACK_WEIGHTS.mythic,
    },
  ];
  const nonEmpty = buckets.filter((b) => b.cards.length > 0);
  if (nonEmpty.length === 0) return null;

  const slotWeights: [MaRarityBucket, number][] = nonEmpty.map((
    b,
  ) => [b.slot, b.weight]);
  const slot = weightedChoice(slotWeights);
  if (!slot) return null;

  const list = slot === "uncommon"
    ? maUncommons
    : slot === "rare"
    ? maRares
    : maMythics;
  return choice(list) ?? null;
}

/**
 * Three extra comeback cards driven by season context (stub: returns none).
 * Implement when rules depend on week, bracket, losses, etc.
 */
export function rollComebackPackVariableSlots(): Promise<readonly ScryfallCard[]> {
  return Promise.resolve([]);
}

/**
 * Rolls one SOS comeback pack: 1 main-pool rare/mythic (2:1), 1 weighted MA
 * card, 3 uncommons, 6 commons, plus {@link rollComebackPackVariableSlots}.
 */
export async function rollComebackPack(): Promise<ScryfallCard[]> {
  const [rares, mythics, uncommons, commons, mythicalArchive] = await Promise
    .all([
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:rare`, { unique: "cards" }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common`, {
        unique: "cards",
      }),
      searchCards(SOS_MYTHICAL_ARCHIVE_SCRYFALL_QUERY, { unique: "cards" }),
    ]);

  const { uncommons: maU, rares: maR, mythics: maM } =
    splitMythicalArchiveByRarity(
      mythicalArchive,
    );

  const rareMythicWeights: [ScryfallCard, number][] = [
    ...rares.map((card): [ScryfallCard, number] => [card, 2]),
    ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
  ];

  const pack: ScryfallCard[] = [];

  const rm = weightedChoice(rareMythicWeights);
  if (!rm) {
    throw new Error("Comeback pack: could not roll main rare/mythic slot");
  }
  pack.push(rm);

  const ma = rollOneMythicalArchiveComebackCard(maU, maR, maM);
  if (!ma) {
    throw new Error(
      "Comeback pack: Mythical Archive query has no rollable uncommon/rare/mythic",
    );
  }
  pack.push(ma);

  for (let i = 0; i < 3; i++) {
    const u = choice(uncommons);
    if (!u) throw new Error("Comeback pack: missing main-set uncommons");
    pack.push(u);
  }
  for (let i = 0; i < 6; i++) {
    const c = choice(commons);
    if (!c) throw new Error("Comeback pack: missing main-set commons");
    pack.push(c);
  }

  const variable = await rollComebackPackVariableSlots();
  pack.push(...variable);

  return pack;
}

export interface SosComebackPlayer {
  readonly identification: string;
  readonly discordId: string;
}

/**
 * Merges {@link rollComebackPack} into the player's current pool, logs Pool
 * Changes, and announces in {@link CONFIG.PACKGEN_CHANNEL_ID} (same pattern as
 * FIN `generateAndSendPack`).
 */
export async function generateAndSendComebackPack(
  client: djs.Client,
  player: SosComebackPlayer,
): Promise<void> {
  const packCards = await rollComebackPack();
  if (packCards.length === 0) {
    throw new Error("Comeback pack rolled zero cards");
  }

  const sealedDeckCards = packCards.map((card) => ({
    name: card.name,
    count: 1 as const,
    set: card.set,
  }));

  const poolChanges = await getPoolChanges();
  const playerChanges = poolChanges.rows.filter((change) =>
    change.Name === player.identification
  );
  const currentPoolId = playerChanges.findLast((change) => change["Full Pool"])
    ?.["Full Pool"] ?? undefined;

  const newPoolId = await makeSealedDeck(
    { sideboard: sealedDeckCards },
    currentPoolId,
  );

  const packPoolId = await makeSealedDeck({ sideboard: sealedDeckCards });

  await addPoolChange(
    player.identification,
    "add pack",
    packPoolId,
    "SOS comeback pack (loss)",
    newPoolId,
  );

  let packImageAttachment: djs.AttachmentBuilder | undefined;
  try {
    const packImageBlob = await tileCardImages(packCards, "small");
    const packImageBuffer = Buffer.from(await packImageBlob.arrayBuffer());
    packImageAttachment = new djs.AttachmentBuilder(packImageBuffer, {
      name: "pack.png",
      description: "SOS comeback pack",
    });
  } catch (error) {
    console.error("[SOS] Failed to generate comeback pack image:", error);
  }

  const embed = new djs.EmbedBuilder()
    .setTitle(`SOS comeback pack — ${player.identification}`)
    .setDescription(formatPool({ sideboard: sealedDeckCards }))
    .setColor(0x7c3aed)
    .addFields([
      {
        name: "Combined pool",
        value: `[Open pool](https://sealeddeck.tech/${newPoolId})`,
        inline: true,
      },
      {
        name: "This pack only",
        value: `[Pack contents](https://sealeddeck.tech/${packPoolId})`,
        inline: true,
      },
    ])
    .setTimestamp();

  if (packImageAttachment) {
    embed.setImage("attachment://pack.png");
  }

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel;

  const files = packImageAttachment ? [packImageAttachment] : [];
  await channel.send({
    content: `<@${player.discordId}> — comeback pack (loss)`,
    embeds: [embed],
    files,
  });
}
