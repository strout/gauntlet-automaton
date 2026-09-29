import { choice } from "../../random.ts";
import { type ScryfallCard, searchCards } from "../../scryfall.ts";

/** Scryfall queries for FRA starting pools and comeback packs. */
export const FRA_QUERIES = {
  foil: 'set:fra cn<281 -o:"unless you control a"',
  mythic: "set:fra r:m cn<194",
  rare: "set:fra r:r cn<194",
  uncommon: "set:fra r:u cn<182",
  echoedMythic: "set:fra r:m cn>194 cn<280",
  echoedRare: "set:fra r:r cn>197 cn<280",
  echoedUncommon: "set:fra r:u cn>181 cn<281",
  dualLand: "set:fra cn>174 cn<195 r:c",
  basicLand: "set:fra t:basic",
  whiteCommon: "set:fra r:c (cn<24 or cn:125 or cn:130 or cn:173)",
  blueCommon: "set:fra r:c ((cn<47 cn>26) or cn:133 or cn:153 or cn:171)",
  blackCommon: "set:fra r:c ((cn>47 cn<71) or cn:123 or cn:156 or cn:172)",
  redCommon: "set:fra r:c ((cn<97 cn>72) or cn:157 or cn:164 or cn:166)",
  greenCommon: "set:fra r:c ((cn>96 cn<121) or cn:134 or cn:139 or cn:174)",
  anyCommon: "set:fra r:c (cn:188 or cn<175)",
} as const;

export type FraQueryKey = keyof typeof FRA_QUERIES;

export type EchoedRarity = "uncommon" | "rare" | "mythic";

export const ECHOED_QUERY_BY_RARITY: Readonly<
  Record<EchoedRarity, FraQueryKey>
> = {
  uncommon: "echoedUncommon",
  rare: "echoedRare",
  mythic: "echoedMythic",
};

/** All cards matching an FRA query (Scryfall responses are cached). */
export async function fraCardsFor(
  key: FraQueryKey,
): Promise<readonly ScryfallCard[]> {
  return await searchCards(FRA_QUERIES[key]);
}

/** Slots that roll commons (including dual and basic lands). */
export const COMMON_SLOTS: ReadonlySet<FraQueryKey> = new Set<FraQueryKey>([
  "whiteCommon",
  "blueCommon",
  "blackCommon",
  "redCommon",
  "greenCommon",
  "anyCommon",
  "dualLand",
  "basicLand",
]);

/** Copies of each card name already in a pool or pack. */
export type CardCounts = Map<string, number>;

export function copiesOf(counts: CardCounts, name: string): number {
  return counts.get(name) ?? 0;
}

export function addCopy(counts: CardCounts, name: string): void {
  counts.set(name, copiesOf(counts, name) + 1);
}

/**
 * Picks a random card for a query among names with fewer than `maxCopies`
 * in `counts`, then records the pick in `counts`.
 */
export async function pickFraCard(
  key: FraQueryKey,
  counts: CardCounts,
  maxCopies: number,
): Promise<ScryfallCard> {
  const cards = await fraCardsFor(key);
  const allowed = cards.filter((c) => copiesOf(counts, c.name) < maxCopies);
  const picked = choice(allowed.length > 0 ? allowed : cards);
  if (!picked) {
    throw new Error(`No FRA cards matched ${key}: ${FRA_QUERIES[key]}`);
  }
  addCopy(counts, picked.name);
  return picked;
}
