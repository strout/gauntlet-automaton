import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
  SealedDeckEntryRequest,
} from "../../sealeddeck.ts";
import { ScryfallCard, searchCards, transformCard } from "../../scryfall.ts";

/**
 * Looks up a card by name (and optionally set) on Scryfall to get full card data.
 */
async function getScryfallCard(name: string, set?: string): Promise<ScryfallCard | null> {
  const setFilter = set ? ` set:${set.toLowerCase()}` : "";
  const query = `!"${name.replace(/"/g, '\\"')}"${setFilter} game:arena`;
  const results = await searchCards(query, { unique: "cards" });
  return results[0] ?? null;
}

/**
 * Expands SealedDeckEntry into individual cards (e.g. 3x Card → 3 entries of 1x Card).
 */
function expandEntries(entries: readonly SealedDeckEntry[]): SealedDeckEntry[] {
  const expanded: SealedDeckEntry[] = [];
  for (const entry of entries) {
    for (let i = 0; i < (entry.count ?? 1); i++) {
      expanded.push({
        name: entry.name,
        count: 1,
        set: entry.set,
      });
    }
  }
  return expanded;
}

/**
 * Aggregates entries by name+set, summing counts.
 */
function aggregateEntries(entries: readonly SealedDeckEntryRequest[]): SealedDeckEntryRequest[] {
  const byKey = new Map<string, { name: string; count: number; set?: string }>();
  for (const e of entries) {
    const key = `${e.name}|${e.set ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += e.count ?? 1;
    } else {
      byKey.set(key, {
        name: e.name,
        count: e.count ?? 1,
        set: e.set,
      });
    }
  }
  return Array.from(byKey.values());
}

/**
 * Transforms a sealed deck pool: fetches the pool, transforms each card via transformCard,
 * and creates a new sealeddeck.tech pool with the transformed cards.
 *
 * @param keyCode - The pool ID from sealeddeck.tech/[key_code]
 * @returns The new pool ID and full URL, or null if the source pool could not be fetched
 */
export async function transformPool(
  keyCode: string,
): Promise<{ poolId: string; url: string } | null> {
  const pool = await fetchSealedDeck(keyCode);

  const allEntries = [
    ...(pool.sideboard ?? []),
    ...(pool.deck ?? []),
    ...(pool.hidden ?? []),
  ];

  const expanded = expandEntries(allEntries);
  const transformedEntries: SealedDeckEntryRequest[] = [];

  for (const entry of expanded) {
    const scryfallCard = await getScryfallCard(entry.name, entry.set);
    if (!scryfallCard) {
      // Card not found on Scryfall - keep original
      transformedEntries.push({
        name: entry.name,
        count: 1,
        set: entry.set,
      });
      continue;
    }

    const transformed = await transformCard(scryfallCard);
    if (transformed) {
      transformedEntries.push({
        name: transformed.name,
        count: 1,
        set: transformed.set,
      });
    } else {
      // No replacement found - keep original
      transformedEntries.push({
        name: entry.name,
        count: 1,
        set: entry.set,
      });
    }
  }

  const aggregated = aggregateEntries(transformedEntries);
  const newPoolId = await makeSealedDeck({
    sideboard: aggregated,
  });

  return {
    poolId: newPoolId,
    url: `https://sealeddeck.tech/${newPoolId}`,
  };
}
