import { withRetry } from "./retry.ts";

/**
 * Map of split card names to their canonical names and sets.
 * SealedDeck GET returns the first half, but POST sometimes requires the full name to disambiguate.
 */
export const splitCardNames = new Map<string, { name: string; set: string }>(
  (await (await fetch(
    "https://api.scryfall.com/cards/search?q=game:arena+is:split",
  )).json()).data.flatMap((
    x: { name: string; set: string },
  ) => [[x.name.split(" /")[0], x], [x.name, x]]),
);

/**
 * Represents a single card entry in a sealed deck pool.
 */
export type SealedDeckEntry = {
  readonly name: string;
  readonly count: number;
  readonly set?: string;
};

export type SealedDeckEntryRequest =
  & Partial<SealedDeckEntry>
  & Pick<SealedDeckEntry, "name">;

/**
 * Represents a complete sealed deck pool with all card categories.
 */
export type SealedDeckPool = {
  readonly poolId: string;
  readonly sideboard: readonly SealedDeckEntry[];
  readonly hidden: readonly SealedDeckEntry[];
  readonly deck: readonly SealedDeckEntry[];
};

/**
 * Request type for creating or updating a sealed deck pool.
 * All properties are optional and poolId is excluded.
 */
export type SealedDeckPoolRequest = Partial<
  Readonly<
    {
      [K in keyof Omit<SealedDeckPool, "poolId">]:
        readonly SealedDeckEntryRequest[];
    }
  >
>;

const sealedDeckCache = new Map<string, SealedDeckPool>();

/**
 * Fetches a sealed deck pool by ID from the SealedDeck.tech API.
 * Results are cached to avoid repeated requests.
 *
 * @param id - The pool ID to fetch
 * @returns Promise that resolves to the sealed deck pool
 */
export async function fetchSealedDeck(id: string): Promise<SealedDeckPool> {
  const cached = sealedDeckCache.get(id);
  if (cached) return cached;

  const url = `https://sealeddeck.tech/api/pools/${id}`;
  return await withRetry(async () => {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        "GET: Bad SealedDeck response: " + resp.status + " (for " + url + ")",
      );
    }
    const json = await resp.json();
    const pool = fixNames(json);
    sealedDeckCache.set(pool.poolId, pool);
    return pool;
  });
}

/**
 * Creates or updates a sealed deck pool via the SealedDeck.tech API.
 *
 * @param req - The pool request data
 * @param poolId - Optional existing pool ID to update
 * @returns Promise that resolves to the pool ID
 */
export function makeSealedDeck(
  req: SealedDeckPoolRequest,
  poolId?: string,
): Promise<string> {
  const body = { ...fixNames(req), poolId };
  return withRetry(async (disableRetry) => {
    const resp = await fetch("https://sealeddeck.tech/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      if (resp.status === 400) {
        const responseText = await resp.text();
        console.error("SealedDeck API rejected request (400):");
        console.error("Request body:", body);
        console.error("Response body:", responseText);
        disableRetry();
      }
      throw new Error("POST: Bad SealedDeck response: " + resp.status);
    }

    const json = await resp.json();

    // Cache the complete pool if this was a new pool creation
    if (!poolId) {
      const ensureCompleteEntries = (entries: readonly SealedDeckEntryRequest[]): readonly SealedDeckEntry[] =>
        entries.map(entry => ({
          name: entry.name,
          count: entry.count ?? 1,
          set: entry.set,
        }));
      
      const completePool: SealedDeckPool = {
        poolId: json.poolId,
        sideboard: ensureCompleteEntries(body.sideboard || []),
        hidden: ensureCompleteEntries(body.hidden || []),
        deck: ensureCompleteEntries(body.deck || []),
      };
      sealedDeckCache.set(json.poolId, completePool);
    }

    return json.poolId;
  });
}

function fixNames<T extends SealedDeckPoolRequest>(json: T): T {
  function fix(cards: readonly SealedDeckEntryRequest[]) {
    return cards.map((x) => {
      const found = splitCardNames.get(x.name);
      return ({ ...x, name: found?.name ?? x.name, set: x.set ?? found?.set });
    });
  }
  return {
    ...json,
    sideboard: json.sideboard && fix(json.sideboard) || [],
    hidden: json.hidden && fix(json.hidden) || [],
    deck: json.deck && fix(json.deck) || [],
  };
}

/**
 * Formats a sealed deck pool as a readable string with markdown code block.
 * Combines all cards from sideboard, deck, and hidden sections.
 *
 * @param pool - The sealed deck pool to format
 * @returns Formatted string representation of the pool
 */
export function formatPool(pool: Partial<SealedDeckPool>): string {
  return "```\n" +
    [...pool.sideboard ?? [], ...pool.deck ?? [], ...pool.hidden ?? []].map((
      c,
    ) => c.count + " " + c.name + (c.set ? " (" + c.set + ")" : "")).join(
      "\n",
    ) + "\n```";
}
