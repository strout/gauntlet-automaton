import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { choice, weightedChoice } from "../../random.ts";
import {
  fetchRandomCardForQuery,
  ScryfallCard,
  searchCards,
  tileCardImages,
} from "../../scryfall.ts";
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

/** Count front-face colors (not color_identity) for weighting. */
function colorCount(card: ScryfallCard): number {
  const colors = card.colors?.filter((c) => "WUBRG".includes(c));
  return colors?.length ?? 0;
}

/** Card identity for duplicate detection. */
function cardIdentity(card: ScryfallCard): string {
  return card.oracle_id ?? `${card.name}\0${card.set}`;
}

/** Weights for comeback pack commons (optimized via interactive testing). */
const COMEBACK_WEIGHTS = {
  TWO_COLOR_IN_COLOR_SLOT: 0.405, // A
  TWO_COLOR_IN_ALL_SLOT: 0.235, // B
  MONOCOLOR_IN_ALL_SLOT: 0, // C (0 = exclude mono-color from all-card slot)
} as const;

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

async function rollComebackElectiveCards(
  _identification: string,
  _losses: number,
  electiveQueries: readonly [string, string, string],
): Promise<readonly ScryfallCard[]> {
  const queries = electiveQueries;
  const cards: (ScryfallCard | null)[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    console.log(
      `[SOS comeback] elective ${i + 1}/${queries.length} /cards/random q=${q}`,
    );
    cards.push(await fetchRandomCardForQuery(q));
  }
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i]) {
      console.error(
        `[SOS comeback] Scryfall /cards/random returned no card for elective ${
          i + 1
        }/3; q=${queries[i]}`,
      );
      throw new Error(
        "SOS comeback: Scryfall returned no card for an elective query",
      );
    }
  }
  return cards as ScryfallCard[];
}

/**
 * Rolls one SOS comeback pack: 1 main-pool rare/mythic (2:1), 1 weighted MA
 * card, 3 uncommons, 6 commons (1 with W, 1 with U, 1 with B, 1 with R, 1 with G,
 * 1 colorless), plus 3 elective-driven randoms from **Course Sheet** queries.
 * Retries if any card appears twice among the 6 commons slots.
 */
export async function rollComebackPack(args: {
  readonly identification: string;
  readonly losses: number;
  readonly electiveQueries: readonly [string, string, string];
}): Promise<ScryfallCard[]> {
  const [
    rares,
    mythics,
    uncommons,
    hasWhite,
    hasBlue,
    hasBlack,
    hasRed,
    hasGreen,
    allCommons,
    mythicalArchive,
  ] = await Promise.all([
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:rare`, { unique: "cards" }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:mythic`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:uncommon`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common c:w`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common c:u`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common c:b`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common c:r`, {
      unique: "cards",
    }),
    searchCards(`${BASE_MAIN_POOL_SEARCH} rarity:common c:g`, {
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
    const u = uncommons[Math.floor(Math.random() * uncommons.length)];
    if (!u) throw new Error("Comeback pack: missing main-set uncommons");
    pack.push(u);
  }

  // Build weighted pools for each color slot
  const monoSlotWeights: [ScryfallCard, number][][] = [
    hasWhite.map((c): [ScryfallCard, number] => [
      c,
      colorCount(c) === 1 ? 1 : COMEBACK_WEIGHTS.TWO_COLOR_IN_COLOR_SLOT,
    ]),
    hasBlue.map((c): [ScryfallCard, number] => [
      c,
      colorCount(c) === 1 ? 1 : COMEBACK_WEIGHTS.TWO_COLOR_IN_COLOR_SLOT,
    ]),
    hasBlack.map((c): [ScryfallCard, number] => [
      c,
      colorCount(c) === 1 ? 1 : COMEBACK_WEIGHTS.TWO_COLOR_IN_COLOR_SLOT,
    ]),
    hasRed.map((c): [ScryfallCard, number] => [
      c,
      colorCount(c) === 1 ? 1 : COMEBACK_WEIGHTS.TWO_COLOR_IN_COLOR_SLOT,
    ]),
    hasGreen.map((c): [ScryfallCard, number] => [
      c,
      colorCount(c) === 1 ? 1 : COMEBACK_WEIGHTS.TWO_COLOR_IN_COLOR_SLOT,
    ]),
  ];

  // Build weighted pool for all-card slot (colorless = 1, mono = C, 2-color = B)
  const allSlotWeights: [ScryfallCard, number][] = allCommons.map(
    (c): [ScryfallCard, number] => {
      const cc = colorCount(c);
      if (cc === 0) return [c, 1]; // colorless = 1
      if (cc === 1) return [c, COMEBACK_WEIGHTS.MONOCOLOR_IN_ALL_SLOT]; // mono = C
      return [c, COMEBACK_WEIGHTS.TWO_COLOR_IN_ALL_SLOT]; // 2-color = B
    },
  );

  do {
    const commons: ScryfallCard[] = [];
    const seen = new Set<string>();

    // Slots 1-5: weighted mono-color slots
    commons.push(weightedChoice(monoSlotWeights[0])!);
    commons.push(weightedChoice(monoSlotWeights[1])!);
    commons.push(weightedChoice(monoSlotWeights[2])!);
    commons.push(weightedChoice(monoSlotWeights[3])!);
    commons.push(weightedChoice(monoSlotWeights[4])!);

    // Slot 6: all-card weighted slot
    commons.push(weightedChoice(allSlotWeights)!);

    // Check for duplicates
    let hasDuplicate = false;
    for (const c of commons) {
      const id = cardIdentity(c);
      if (seen.has(id)) {
        hasDuplicate = true;
        break;
      }
      seen.add(id);
    }

    if (!hasDuplicate) {
      pack.push(...commons);
      break;
    }
    // Duplicate found, retry
  } while (true);

  const electiveCards = await rollComebackElectiveCards(
    args.identification,
    args.losses,
    args.electiveQueries,
  );
  pack.push(...electiveCards);

  return pack;
}

export interface SosComebackPlayer {
  readonly identification: string;
  readonly discordId: string;
  /** Player Database loss count when granting this comeback. */
  readonly losses: number;
}

/**
 * Merges {@link rollComebackPack} into the player's current pool, logs Pool
 * Changes, and announces in {@link CONFIG.PACKGEN_CHANNEL_ID} (same pattern as
 * FIN `generateAndSendPack`).
 */
export async function generateAndSendComebackPack(
  client: djs.Client,
  player: SosComebackPlayer,
  /** Already resolved elective queries from validated submissions. */
  electiveQueries: readonly [string, string, string],
): Promise<void> {
  const packCards = await rollComebackPack({
    identification: player.identification,
    losses: player.losses,
    electiveQueries,
  });
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
