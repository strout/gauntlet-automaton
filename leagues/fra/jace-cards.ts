import { choice } from "../../random.ts";
import { type ScryfallCard, searchCards } from "../../scryfall.ts";
import type { SealedDeckEntry, SealedDeckPool } from "../../sealeddeck.ts";
import { fraCardsFor, type FraQueryKey } from "./cards.ts";
import type { MirroredCardRow } from "./mirrored-cards.ts";
import { findEchoedCardByName, toSealedDeckEntries } from "./rolling.ts";

/** The last 6 Universes Within sets; Booster Tutor commands are `!<code>`. */
export const UW_SETS = ["sos", "ecl", "eoe", "tdm", "dft", "dsk"] as const;
export type UwSet = typeof UW_SETS[number];

const UW_QUERY =
  "(set:sos or set:ecl or set:dft or set:eoe or set:tdm or set:dsk) is:default";

/** Mono-colored commons per color, then 2 any commons (no basics). */
const UW_COMMON_QUERIES: readonly string[] = [
  ...["w", "u", "b", "r", "g"].map((c) => `${UW_QUERY} r:c c=${c}`),
  `${UW_QUERY} r:c -t:basic`,
  `${UW_QUERY} r:c -t:basic`,
];

/** FRA comeback-pack slots that Jace −2 rerolls (the land slot stays). */
const FRA_COMMON_SLOTS: readonly FraQueryKey[] = [
  "whiteCommon",
  "blueCommon",
  "blackCommon",
  "redCommon",
  "greenCommon",
  "anyCommon",
];
const FRA_LAND_SLOTS: readonly FraQueryKey[] = ["dualLand", "basicLand"];

async function pickRandom(query: string): Promise<ScryfallCard> {
  const card = choice(await searchCards(query));
  if (!card) throw new Error(`No cards matched ${query}`);
  return card;
}

/** Jace −1: a random Universes Within uncommon. */
export function rollUwUncommon(): Promise<ScryfallCard> {
  return pickRandom(`${UW_QUERY} r:u`);
}

/** Jace −2: 1 common of each color, then 2 any commons. */
export async function rollUwCommons(): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (const query of UW_COMMON_QUERIES) cards.push(await pickRandom(query));
  return cards;
}

/** Two different Universes Within sets for Jace −8. */
export function pickTwoUwSets(): [UwSet, UwSet] {
  const n = UW_SETS.length;
  const first = Math.floor(Math.random() * n);
  const second = (first + 1 + Math.floor(Math.random() * (n - 1))) % n;
  return [UW_SETS[first], UW_SETS[second]];
}

/** Compares card names, ignoring case and the back face of DFCs. */
function cardKey(name: string): string {
  return name.split(" // ")[0].trim().toLowerCase();
}

/** One entry per physical card (count 1), across every pool section. */
export function expandPool(
  pool: Pick<SealedDeckPool, "sideboard" | "deck" | "hidden">,
): SealedDeckEntry[] {
  return [...pool.sideboard, ...pool.deck, ...pool.hidden].flatMap((e) =>
    Array.from(
      { length: e.count },
      () => ({ name: e.name, set: e.set, count: 1 }),
    )
  );
}

/** Merges entries with the same card name into counts. */
export function mergeEntries(
  entries: readonly SealedDeckEntry[],
): SealedDeckEntry[] {
  const merged = new Map<string, SealedDeckEntry>();
  for (const e of entries) {
    const key = cardKey(e.name);
    const prev = merged.get(key);
    merged.set(key, {
      name: prev?.name ?? e.name,
      set: prev?.set ?? e.set,
      count: (prev?.count ?? 0) + e.count,
    });
  }
  return [...merged.values()].filter((e) => e.count > 0);
}

/**
 * Removes one copy of `name` from `cards` in place.
 *
 * @returns false if the card wasn't there
 */
function removeOne(cards: SealedDeckEntry[], name: string): boolean {
  const idx = cards.findIndex((c) => cardKey(c.name) === cardKey(name));
  if (idx < 0) return false;
  cards.splice(idx, 1);
  return true;
}

async function fraNames(
  keys: readonly FraQueryKey[],
): Promise<ReadonlySet<string>> {
  const lists = await Promise.all(keys.map(fraCardsFor));
  return new Set(lists.flat().map((c) => cardKey(c.name)));
}

export interface RebuiltPack {
  /** Full contents of the new pack. */
  readonly entries: readonly SealedDeckEntry[];
  /** Scryfall data for the cards Jace added (for images). */
  readonly added: readonly ScryfallCard[];
}

/**
 * Jace −2: drops the pack's non-land commons and adds 7 Universes Within
 * commons. Exactly one land-slot card is kept.
 */
export async function rerollPackCommons(
  pack: SealedDeckPool,
): Promise<RebuiltPack> {
  const [commonNames, landNames] = await Promise.all([
    fraNames(FRA_COMMON_SLOTS),
    fraNames(FRA_LAND_SLOTS),
  ]);
  const cards = expandPool(pack);
  // A land can also match the any-common query; prefer one that can't.
  const landIdx = [
    cards.findIndex((c) =>
      landNames.has(cardKey(c.name)) && !commonNames.has(cardKey(c.name))
    ),
    cards.findIndex((c) => landNames.has(cardKey(c.name))),
  ].find((i) => i >= 0);
  const kept = cards.filter((c, i) =>
    i === landIdx || !commonNames.has(cardKey(c.name))
  );
  const removed = cards.length - kept.length;
  if (removed !== UW_COMMON_QUERIES.length) {
    console.warn(
      `[fra] Jace −2 on ${pack.poolId}: removed ${removed} commons ` +
        `(expected ${UW_COMMON_QUERIES.length})`,
    );
  }
  const added = await rollUwCommons();
  return {
    entries: mergeEntries([...kept, ...toSealedDeckEntries(added)]),
    added,
  };
}

/**
 * Jace −5: swaps each of the owner's mirrored cards in the pack for its
 * Mirrored Pair card.
 */
export async function swapMirroredCards(
  pack: SealedDeckPool,
  mirrored: readonly MirroredCardRow[],
): Promise<RebuiltPack> {
  const cards = expandPool(pack);
  for (const row of mirrored) {
    if (!row.counterpart) {
      throw new Error(`Mirrored Cards row ${row.rowNum} has no Counterpart`);
    }
    if (!removeOne(cards, row.card)) {
      throw new Error(`${row.card} isn't in pack ${pack.poolId}`);
    }
  }
  const added = await Promise.all(
    mirrored.map((r) => findEchoedCardByName(r.counterpart)),
  );
  return {
    entries: mergeEntries([...cards, ...toSealedDeckEntries(added)]),
    added,
  };
}

/**
 * The full pool with `oldPack` swapped out for `newEntries`.
 *
 * @throws if the full pool doesn't contain every card of `oldPack`
 */
export function replacePackInPool(
  fullPool: SealedDeckPool,
  oldPack: SealedDeckPool,
  newEntries: readonly SealedDeckEntry[],
): SealedDeckEntry[] {
  const cards = expandPool(fullPool);
  for (const card of expandPool(oldPack)) {
    if (!removeOne(cards, card.name)) {
      throw new Error(
        `Full pool ${fullPool.poolId} is missing ${card.name} from pack ${oldPack.poolId}`,
      );
    }
  }
  return mergeEntries([...cards, ...newEntries]);
}

/**
 * Scryfall cards for each physical card in `entries`, for image tiling.
 * Cards not found in `known` or the FRA set are skipped.
 */
export async function cardsForImage(
  entries: readonly SealedDeckEntry[],
  known: readonly ScryfallCard[],
): Promise<ScryfallCard[]> {
  const byKey = new Map<string, ScryfallCard>();
  for (const card of [...await searchCards("set:fra"), ...known]) {
    byKey.set(cardKey(card.name), card);
  }
  return expandPool({ sideboard: entries, deck: [], hidden: [] }).flatMap((e) =>
    byKey.get(cardKey(e.name)) ?? []
  );
}
