import { choice } from "../../random.ts";
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
): ScryfallCard {
  const allowed = cards.filter((card) =>
    (counts.get(card.name) ?? 0) < MAX_COPIES
  );
  const picked = choice(allowed.length > 0 ? allowed : cards);
  if (!picked) throw new Error("Trek pool query returned no cards");
  counts.set(picked.name, (counts.get(picked.name) ?? 0) + 1);
  return picked;
}

async function pickKey(
  key: TrkQueryKey,
  counts: CardCounts,
): Promise<ScryfallCard> {
  return pick(await cardsFor(key), counts);
}

async function pickRareOrMythic(counts: CardCounts): Promise<ScryfallCard> {
  const key: TrkQueryKey = Math.random() < MYTHIC_CHANCE ? "mythic" : "rare";
  return await pickKey(key, counts);
}

async function pickRepeat(
  key: TrkQueryKey,
  count: number,
  counts: CardCounts,
): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (let i = 0; i < count; i++) cards.push(await pickKey(key, counts));
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
