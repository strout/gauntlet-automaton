import { choice, weightedChoice } from "../../random.ts";
import { type ScryfallCard, searchCards } from "../../scryfall.ts";

/**
 * One colorless common per color, so each is drawn at the same rate as that
 * color's other commons. Shuttlecraft, Cybernetic Specialist, Tea, Tricorder,
 * Warp Core.
 */
const COLOR_POOL_COMMON = {
  white: "cn:259",
  blue: "cn:262",
  black: "cn:269",
  red: "cn:270",
  green: "cn:274",
} as const;

/** Scryfall queries for a Trek starting pool. */
export const TRK_QUERIES = {
  rare: "s:trk r:r",
  mythic: "s:trk r:m",
  uncommon: "s:trk r:u",
  white: `s:trk ((c:w r:c) or ${COLOR_POOL_COMMON.white})`,
  blue: `s:trk ((c:u r:c) or ${COLOR_POOL_COMMON.blue})`,
  black: `s:trk ((c:b r:c) or ${COLOR_POOL_COMMON.black})`,
  red: `s:trk ((c:r r:c) or ${COLOR_POOL_COMMON.red})`,
  green: `s:trk ((c:g r:c) or ${COLOR_POOL_COMMON.green})`,
  anyCommon: "s:trk r:c -t:basic -(t:land o:life)",
  dualLand: "s:trk t:land -t:basic r:c o:life",
} as const;

export type TrkQueryKey = keyof typeof TRK_QUERIES;

/** Chance a rare/mythic slot is a mythic. Same as FRA's unmirrored slots. */
export const MYTHIC_CHANCE = 1 / 6;

const MAX_COPIES = 4;

const RARE_MYTHIC_SLOTS = 6;
const UNCOMMON_SLOTS = 18;
const COLOR_COMMON_SLOTS = 8;
const ANY_COMMON_SLOTS = 17;
const DUAL_LAND_SLOTS = 3;

type CardCounts = Map<string, number>;

async function cardsFor(key: TrkQueryKey): Promise<readonly ScryfallCard[]> {
  const query = TRK_QUERIES[key];
  const cards = await searchCards(query);
  if (cards.length === 0) throw new Error(`No cards matched ${key}: ${query}`);
  return cards;
}

function pick(
  cards: readonly ScryfallCard[],
  counts: CardCounts,
  maxCopies = MAX_COPIES,
): ScryfallCard {
  const allowed = cards.filter((card) =>
    (counts.get(card.name) ?? 0) < maxCopies
  );
  if (allowed.length === 0 && maxCopies < MAX_COPIES) {
    throw new Error("No card left under the copy limit");
  }
  const picked = choice(allowed.length > 0 ? allowed : cards);
  if (!picked) throw new Error("Trek pool query returned no cards");
  counts.set(picked.name, (counts.get(picked.name) ?? 0) + 1);
  return picked;
}

async function pickKey(
  key: TrkQueryKey,
  counts: CardCounts,
  maxCopies = MAX_COPIES,
): Promise<ScryfallCard> {
  return pick(await cardsFor(key), counts, maxCopies);
}

async function pickRareOrMythic(counts: CardCounts): Promise<ScryfallCard> {
  const key: TrkQueryKey = Math.random() < MYTHIC_CHANCE ? "mythic" : "rare";
  return await pickKey(key, counts);
}

async function pickRepeat(
  key: TrkQueryKey,
  count: number,
  counts: CardCounts,
  maxCopies = MAX_COPIES,
): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (let i = 0; i < count; i++) {
    cards.push(await pickKey(key, counts, maxCopies));
  }
  return cards;
}

/**
 * 84 cards: 6 rare/mythic, 18 uncommons, 8 commons of each color, 17 other
 * nonbasic commons, and 3 common dual lands. A name can appear four times.
 */
export async function rollTrkStartingPool(): Promise<ScryfallCard[]> {
  const counts: CardCounts = new Map();
  const rares: ScryfallCard[] = [];
  for (let i = 0; i < RARE_MYTHIC_SLOTS; i++) {
    rares.push(await pickRareOrMythic(counts));
  }
  const colors = [
    "white",
    "blue",
    "black",
    "red",
    "green",
  ] as const satisfies readonly TrkQueryKey[];
  const colorCommons: ScryfallCard[] = [];
  for (const color of colors) {
    colorCommons.push(
      ...await pickRepeat(color, COLOR_COMMON_SLOTS, counts),
    );
  }
  const pool = [
    ...rares,
    ...await pickRepeat("uncommon", UNCOMMON_SLOTS, counts),
    ...colorCommons,
    ...await pickRepeat("anyCommon", ANY_COMMON_SLOTS, counts),
    ...await pickRepeat("dualLand", DUAL_LAND_SLOTS, counts),
  ];
  if (pool.length !== 84) {
    throw new Error(`Trek starting pool has ${pool.length} cards, expected 84`);
  }
  return pool;
}

const PACK_COLORS = [
  "white",
  "blue",
  "black",
  "red",
  "green",
] as const satisfies readonly TrkQueryKey[];

/** Any common, including basics and duals. Used by wildcard slots. */
const ANY_COMMON = "s:trk r:c";
/** A basic land. The starting pool has no separate basic slot. */
const BASIC_LAND = "s:trk t:basic";

const COMMON_EXCLUSIONS = "-t:basic -(t:land o:life)";

/**
 * 14 cards. One rare or mythic (mythic 1 in 6, same as a starting-pool slot),
 * 3 uncommons, 7 commons (one of each color and two of any other common,
 * with basics and duals removed), one land (half basic, half common dual),
 * one common-or-uncommon wildcard, and one wildcard weighted common 25,
 * uncommon 55, rare 17, mythic 3. Each uncommon name appears at most once.
 */
export async function rollTrkLossPack(): Promise<ScryfallCard[]> {
  const counts: CardCounts = new Map();
  const colorCommons: ScryfallCard[] = [];
  for (const color of PACK_COLORS) {
    colorCommons.push(
      await pickQuery(
        `${TRK_QUERIES[color]} ${COMMON_EXCLUSIONS}`,
        color,
        counts,
      ),
    );
  }
  const anyCommons = await cardsFor("anyCommon");
  const pack = [
    await pickRareOrMythic(counts),
    ...await pickRepeat("uncommon", 3, counts, 1),
    ...colorCommons,
    pick(anyCommons, counts),
    pick(anyCommons, counts),
    await pickLossLand(counts),
    await pickWeighted([
      ["common", 1],
      ["uncommon", 1],
    ], counts),
    await pickWeighted([
      ["common", 25],
      ["uncommon", 55],
      ["rare", 17],
      ["mythic", 3],
    ], counts),
  ];
  if (pack.length !== 14) {
    throw new Error(`Trek loss pack has ${pack.length} cards, expected 14`);
  }
  return pack;
}

async function pickLossLand(counts: CardCounts): Promise<ScryfallCard> {
  if (Math.random() < 0.5) {
    return await pickQuery(BASIC_LAND, "basic", counts);
  }
  return await pickKey("dualLand", counts);
}

type PackRarity = "common" | "uncommon" | "rare" | "mythic";

async function pickWeighted(
  weights: readonly [PackRarity, number][],
  counts: CardCounts,
): Promise<ScryfallCard> {
  const rarity = weightedChoice(weights);
  if (!rarity) throw new Error("Loss pack wildcard weights were empty");
  if (rarity === "common") return await pickQuery(ANY_COMMON, "common", counts);
  const maxCopies = rarity === "uncommon" ? 1 : MAX_COPIES;
  return await pickKey(rarity, counts, maxCopies);
}

async function pickQuery(
  query: string,
  label: string,
  counts: CardCounts,
): Promise<ScryfallCard> {
  const cards = await searchCards(query);
  if (cards.length === 0) {
    throw new Error(`No cards matched ${label}: ${query}`);
  }
  return pick(cards, counts);
}
