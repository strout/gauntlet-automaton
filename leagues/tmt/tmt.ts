import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../../dispatch.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import {
  makeSealedDeck,
  SealedDeckEntry,
  SealedDeckPool,
  SealedDeckPoolRequest,
} from "../../sealeddeck.ts";

// Path to the local Scryfall bulk data file (optional)
const DEFAULT_CARDS_PATH = "./default-cards.json";

/**
 * Represents a card entry with its various printings
 */
export interface CardWithPrintings {
  readonly card: ScryfallCard;
  readonly printings: readonly ScryfallCard[];
}

type MutationKeyRarity = string;
type MutationKeyColors = string;
type MutationKeyTypes = string;
type MutationKeyCmc = number;

type CmcMap = ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>;
type TypesMap = ReadonlyMap<MutationKeyTypes, CmcMap>;
type ColorsMap = ReadonlyMap<MutationKeyColors, TypesMap>;
type RarityMap = ReadonlyMap<MutationKeyRarity, ColorsMap>;

let mutationMap: RarityMap | null = null;

let allCardsCache: readonly ScryfallCard[] | null = null;

let allArenaCardsCache: readonly ScryfallCard[] | null = null;

export function extractMainTypes(card: ScryfallCard): string {
  // For MDFCs, always use the front face's type_line
  let typeLine: string | undefined;
  if (card.card_faces && card.card_faces.length > 0) {
    typeLine = card.card_faces[0].type_line;
  } else {
    typeLine = card.type_line;
  }

  if (!typeLine) {
    return "";
  }

  // Remove everything after the first hyphen (including em-dash, en-dash)
  // Split on " - " first to get main types before subtype separator
  const beforeHyphen = typeLine.split(/\s+[-—–]\s+/)[0];

  // Split by space and remove supertypes (Legendary, Basic, Snow, etc.)
  const supertypes = new Set([
    "legendary",
    "basic",
    "snow",
    "world",
    "ongoing",
  ]);

  const types = beforeHyphen
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !supertypes.has(t))
    .sort();

  return types.join(" ");
}

export interface MutationKey {
  readonly rarity: MutationKeyRarity;
  readonly colors: MutationKeyColors;
  readonly types: MutationKeyTypes;
  readonly cmc: MutationKeyCmc;
}

export function buildMutationKey(card: ScryfallCard): MutationKey {
  const rarity = card.rarity.toLowerCase();
  const colors = (card.color_identity ?? []).slice().sort().join("");
  const types = extractMainTypes(card);
  const cmc = card.cmc;

  return { rarity, colors, types, cmc };
}

/**
 * Checks if a card is available on Arena (game:arena)
 * @param card - The Scryfall card to check
 * @returns true if the card is available on Arena
 */
function isCardOnArena(card: ScryfallCard): boolean {
  return card.games?.includes("arena") ?? false;
}

/**
 * Checks if a card is from the TMT set
 * @param card - The Scryfall card to check
 * @returns true if the card is from TMT
 */
function isCardFromTMT(card: ScryfallCard): boolean {
  return card.set?.toLowerCase() === "tmt";
}

/**
 * Checks if a card is a token (not a real playable card)
 * @param card - The Scryfall card to check
 * @returns true if the card is a token
 */
function isCardToken(card: ScryfallCard): boolean {
  const setType = card.set_type;
  return setType === "token";
}

/**
 * Checks if a card is legal in both Vintage and Timeless.
 * Note: Scryfall 'legal' or 'restricted' both count as legal for our purposes.
 * This naturally excludes Alchemy-exclusive and rebalanced (A-) cards.
 * @param card - The Scryfall card to check
 * @returns true if the card is legal or restricted in both Vintage and Timeless
 */
function isCardLegalInVintageAndTimeless(card: ScryfallCard): boolean {
  const v = card.legalities["vintage"];
  const t = card.legalities["timeless"];
  return (v === "legal" || v === "restricted") &&
    (t === "legal" || t === "restricted");
}

/**
 * Loads cards from the local bulk data file if it exists.
 * Populates both allCardsCache (mutation targets) and allArenaCardsCache (lookup).
 * Falls back to null if the file doesn't exist or can't be read.
 * @returns Array of filtered Scryfall cards (non-TMT) or null if file not available
 */
async function loadCardsFromLocalFile(): Promise<
  ScryfallCard[] | null
> {
  try {
    const fileInfo = await Deno.stat(DEFAULT_CARDS_PATH);
    if (!fileInfo.isFile) {
      return null;
    }

    console.log("Loading cards from local file...");
    const content = await Deno.readTextFile(DEFAULT_CARDS_PATH);
    const allCards = JSON.parse(content) as ScryfallCard[];

    // Load ALL Arena cards (including TMT) for lookup purposes
    // Include rebalanced and token cards so we can identify them
    const allArenaCards = allCards.filter((card) => isCardOnArena(card));
    allArenaCardsCache = allArenaCards;
    console.log(
      `Loaded ${allArenaCards.length} total Arena cards for lookup`,
    );

    // Filter for Arena cards that are:
    // - NOT TMT
    // - NOT tokens
    // - Legal in both Vintage and Timeless (real cards on Arena)
    // These are the cards that TMT cards can be mutated into
    const filtered = allCards.filter((card) =>
      !isCardFromTMT(card) && !isCardToken(card) &&
      isCardLegalInVintageAndTimeless(card) && isCardOnArena(card)
    );

    console.log(
      `Loaded ${filtered.length} non-TMT Arena cards from local file`,
    );
    return filtered;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.log("Local card file not found, falling back to API");
    } else {
      console.error("Error loading local card file:", error);
    }
    return null;
  }
}

/**
 * Lazily initializes and returns the mutation map.
 * Searches Scryfall for TMT cards and groups them by mutation key.
 * Each unique card name gets an entry with all its printings.
 * Returns nested maps: rarity -> colors -> types -> cmc -> CardWithPrintings[]
 *
 * @returns Promise resolving to the nested mutation map
 */
export async function getMutationMap(): Promise<RarityMap> {
  if (mutationMap !== null) {
    return mutationMap;
  }

  // Try to load from local file first
  const localCards = await loadCardsFromLocalFile();

  // Fall back to API if local file not available
  let cards: readonly ScryfallCard[];
  if (localCards !== null) {
    cards = localCards;
  } else {
    console.log("Fetching cards from Scryfall API...");
    // Fetch non-TMT cards for mutation targets
    cards = await searchCards("-e:tmt f:vintage f:timeless game:arena", {
      unique: "prints", // Search by unique printings
    });

    // Also fetch ALL Arena cards including TMT for lookup
    // Use a simpler query that gets all Arena cards
    console.log("Fetching all Arena cards for lookup...");
    allArenaCardsCache = await searchCards("game:arena", {
      unique: "cards", // One entry per card name
    });
    console.log(
      `Loaded ${allArenaCardsCache.length} total Arena cards for lookup`,
    );
  }

  // Build nested map: rarity -> colors -> types -> cmc -> CardWithPrintings[]
  const rarityMap = new Map<MutationKeyRarity, Map<MutationKeyColors, Map<MutationKeyTypes, Map<MutationKeyCmc, CardWithPrintings[]>>>>();

  for (const card of cards) {
    const key = buildMutationKey(card);

    // Get or create nested maps at each level
    let colorsMap = rarityMap.get(key.rarity);
    if (!colorsMap) {
      colorsMap = new Map();
      rarityMap.set(key.rarity, colorsMap);
    }

    let typesMap = colorsMap.get(key.colors);
    if (!typesMap) {
      typesMap = new Map();
      colorsMap.set(key.colors, typesMap);
    }

    let cmcMap = typesMap.get(key.types);
    if (!cmcMap) {
      cmcMap = new Map();
      typesMap.set(key.types, cmcMap);
    }

    // Group by oracle_id within this key
    const existing = cmcMap.get(key.cmc);
    if (!existing) {
      // First card for this cmc, need to create CardWithPrintings
      const cardsByOracleId = new Map<string, ScryfallCard[]>();
      cardsByOracleId.set(card.oracle_id ?? card.name, [card]);

      const entries: CardWithPrintings[] = [];
      for (const [, printings] of cardsByOracleId) {
        entries.push({
          card: printings[0],
          printings: printings,
        });
      }
      cmcMap.set(key.cmc, entries);
    } else {
      // Need to merge with existing - find by oracle_id
      const oracleId = card.oracle_id;
      if (oracleId) {
        let found = false;
        for (const entry of existing) {
          if (entry.card.oracle_id === oracleId) {
            (entry.printings as ScryfallCard[]).push(card);
            found = true;
            break;
          }
        }
        if (!found) {
          existing.push({
            card: card,
            printings: [card],
          });
        }
      }
    }
  }

  // Convert to readonly nested maps
  const readonlyRarityMap = new Map<MutationKeyRarity, ReadonlyMap<MutationKeyColors, ReadonlyMap<MutationKeyTypes, ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>>>>();

  for (const [rarity, colorsMap] of rarityMap) {
    const readonlyColorsMap = new Map<MutationKeyColors, ReadonlyMap<MutationKeyTypes, ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>>>();
    for (const [colors, typesMap] of colorsMap) {
      const readonlyTypesMap = new Map<MutationKeyTypes, ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>>();
      for (const [types, cmcMap] of typesMap) {
        const readonlyCmcMap = new Map<MutationKeyCmc, readonly CardWithPrintings[]>();
        for (const [cmc, entries] of cmcMap) {
          readonlyCmcMap.set(cmc, entries);
        }
        readonlyTypesMap.set(types, readonlyCmcMap);
      }
      readonlyColorsMap.set(colors, readonlyTypesMap);
    }
    readonlyRarityMap.set(rarity, readonlyColorsMap);
  }

  mutationMap = readonlyRarityMap;
  allCardsCache = cards;
  return mutationMap;
}

/**
 * Returns all Scryfall cards used to build the mutation map.
 * Lazily initializes if not already cached.
 * @returns Promise resolving to the array of all cards
 */
export async function getAllCards(): Promise<readonly ScryfallCard[]> {
  if (allCardsCache !== null) {
    return allCardsCache;
  }
  // Initialize by building the mutation map (which caches cards as a side effect)
  await getMutationMap();
  return allCardsCache!;
}

/**
 * Returns all Arena cards including TMT cards.
 * Lazily initializes if not already cached.
 * @returns Promise resolving to the array of all Arena cards
 */
export async function getAllArenaCards(): Promise<readonly ScryfallCard[]> {
  if (allArenaCardsCache !== null) {
    return allArenaCardsCache;
  }
  // Initialize by building the mutation map
  await getMutationMap();
  return allArenaCardsCache ?? [];
}

/**
 * Clears the mutation map and cards cache. Useful for testing or forcing a refresh.
 */
export function clearMutationMap(): void {
  mutationMap = null;
  allCardsCache = null;
  allArenaCardsCache = null;
}

/**
 * Type for rarity filter options.
 */
export type RaritySlot = "common" | "uncommon" | "rare+mythic";

/**
 * Extracts the front face name from a double-faced card name.
 * For single-faced cards, returns the full name.
 * @param cardName - The card name (may contain " // " separator)
 * @returns The front face name
 */
function getFrontFaceName(cardName: string): string {
  const separator = " // ";
  const index = cardName.indexOf(separator);
  if (index === -1) {
    return cardName;
  }
  return cardName.substring(0, index);
}

/**
 * Builds a name-to-card lookup map from the cached cards.
 * Uses allArenaCardsCache which includes TMT cards.
 * For double-faced cards, indexes by both full name and front face name.
 * @returns Map from lowercase card name to ScryfallCard
 */
function buildNameToCardMap(): Map<string, ScryfallCard> {
  const map = new Map<string, ScryfallCard>();
  if (!allArenaCardsCache) {
    return map;
  }
  for (const card of allArenaCardsCache) {
    const fullName = card.name.toLowerCase();
    // Only store the first occurrence (preferred printing)
    if (!map.has(fullName)) {
      map.set(fullName, card);
    }

    // Also index by front face name for double-faced cards
    const frontFaceName = getFrontFaceName(card.name).toLowerCase();
    if (frontFaceName !== fullName && !map.has(frontFaceName)) {
      map.set(frontFaceName, card);
    }
  }
  return map;
}

/**
 * Gets a random element from an array.
 * @param arr - The array to pick from
 * @returns A random element, or undefined if array is empty
 */
function getRandomElement<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Gets a random printing from a CardWithPrintings entry.
 * @param entry - The card entry with printings
 * @returns A random ScryfallCard printing
 */
function getRandomPrinting(
  entry: CardWithPrintings,
): ScryfallCard {
  return getRandomElement(entry.printings) ?? entry.card;
}

/**
 * Options for relaxed card matching.
 */
export interface RelaxedMatchOptions {
  /** Maximum difference in CMC to allow (default: 0 = exact) */
  readonly maxCmcDiff?: number;
  /** Whether to allow partial type overlap (e.g., "creature" matches "creature artifact") */
  readonly allowPartialTypes?: boolean;
  /** Whether to allow partial color overlap (e.g., "W" matches "WU") */
  readonly allowPartialColors?: boolean;
}

/**
 * Checks if two color strings have partial overlap.
 * @param cardColors - The card's colors (e.g., "WU")
 * @param keyColors - The target colors to match against
 * @returns true if there's any color overlap
 */
function colorsOverlap(cardColors: string, keyColors: string): boolean {
  if (keyColors === "") return cardColors === "";
  if (cardColors === "") return keyColors === "";
  for (const c of keyColors) {
    if (cardColors.includes(c)) return true;
  }
  return false;
}

/**
 * Checks if the card's types include all the key's types (or partial if allowed).
 * @param cardTypes - The card's main types
 * @param keyTypes - The target types to match against
 * @param allowPartial - Whether to allow partial overlap
 * @returns true if types match
 */
function typesMatch(
  cardTypes: string,
  keyTypes: string,
  allowPartial: boolean,
): boolean {
  if (allowPartial) {
    const cardTypeSet = new Set(cardTypes.split(" "));
    const keyTypeList = keyTypes.split(" ").filter((t) => t);
    return keyTypeList.every((t) => cardTypeSet.has(t));
  }
  return cardTypes === keyTypes;
}

/**
 * Finds all mutation candidates matching with relaxed criteria.
 * Iterates through all cards in the mutation map.
 * @param cardName - The name of the card to mutate
 * @param options - Relaxed matching options
 * @returns Promise resolving to a list of matching candidates
 */
export async function findCandidatesWithRelaxedMatch(
  cardName: string,
  options: RelaxedMatchOptions = {},
): Promise<readonly CardWithPrintings[]> {
  const map = await getMutationMap();
  const nameToCard = buildNameToCardMap();

  const card = nameToCard.get(cardName.toLowerCase());
  if (!card) {
    return [];
  }

  const key = buildMutationKey(card);
  const maxCmcDiff = options.maxCmcDiff ?? 0;
  const allowPartialTypes = options.allowPartialTypes ?? false;
  const allowPartialColors = options.allowPartialColors ?? false;

  const results: CardWithPrintings[] = [];

  for (const [, colorsMap] of map) {
    for (const [, typesMap] of colorsMap) {
      for (const [typesKey, cmcMap] of typesMap) {
        if (!typesMatch(typesKey, key.types, allowPartialTypes)) {
          continue;
        }

        for (const [, entries] of cmcMap) {
          for (const entry of entries) {
            const entryCard = entry.card;

            if (entryCard.rarity !== key.rarity) continue;

            const entryColors = (entryCard.color_identity ?? []).slice().sort().join("");
            if (!allowPartialColors && entryColors !== key.colors) continue;
            if (allowPartialColors && !colorsOverlap(entryColors, key.colors)) continue;

            const cmcDiff = Math.abs(entryCard.cmc - key.cmc);
            if (cmcDiff > maxCmcDiff) continue;

            results.push(entry);
          }
        }
      }
    }
  }

  return results;
}

const DEFAULT_MIN_CANDIDATES = 5;

/**
 * Gets all potential mutation targets for a card given its name.
 * Uses progressive widening: starts with strict match, then relaxes criteria
 * until at least minCandidates are found (default 5).
 * @param cardName - The name of the card to mutate
 * @param minCandidates - Minimum number of candidates to find (default 5)
 * @returns Promise resolving to a list of mutation candidates
 */
export async function getMutationCandidates(
  cardName: string,
  minCandidates: number = DEFAULT_MIN_CANDIDATES,
): Promise<readonly CardWithPrintings[]> {
  for (const allowPartialTypes of [false, true]) {
    for (const allowPartialColors of [false, true]) {
      for (let maxCmcDiff = 0; maxCmcDiff <= 5; maxCmcDiff++) {
        const candidates = await findCandidatesWithRelaxedMatch(cardName, {
          maxCmcDiff,
          allowPartialTypes,
          allowPartialColors,
        });

        if (candidates.length >= minCandidates) {
          return candidates;
        }
      }
    }
  }

  return [];
}

/**
 * Checks if a card's rarity matches the target rarity slot.
 * @param rarity - The card's rarity
 * @param targetSlot - The target rarity slot
 * @returns true if the rarity matches the slot
 */
function rarityMatchesSlot(
  rarity: string,
  targetSlot: RaritySlot,
): boolean {
  const r = rarity.toLowerCase();
  switch (targetSlot) {
    case "common":
      return r === "common";
    case "uncommon":
      return r === "uncommon";
    case "rare+mythic":
      return r === "rare" || r === "mythic" || r === "special" || r === "bonus";
    default:
      return false;
  }
}

/**
 * Mutates all cards of a specific rarity slot in a sealed deck pool.
 * Each card matching the rarity is replaced with a random printing of a random card
 * that shares the same mutation key (rarity|colors|types|cmc).
 *
 * @param pool - The sealed deck pool to mutate
 * @param raritySlot - The rarity slot to mutate ("common", "uncommon", or "rare+mythic")
 * @returns Promise resolving to the new pool ID with mutated cards
 */
export async function mutatePoolByRarity(
  pool: SealedDeckPool,
  raritySlot: RaritySlot,
): Promise<string> {
  const { poolId } = await mutatePoolInternal(
    pool,
    (card) => rarityMatchesSlot(card.rarity, raritySlot),
  );
  return poolId;
}

/**
 * Mutates all cards in a sealed deck pool.
 * Each card is replaced with a random printing of a random card
 * that shares the same mutation key (rarity|colors|types|cmc).
 *
 * @param pool - The sealed deck pool to mutate
 * @returns Promise resolving to an object containing the new pool ID and the list of mutated ScryfallCards
 */
export async function mutateWholePool(pool: SealedDeckPool): Promise<{
  poolId: string;
  mutatedCards: ScryfallCard[];
}> {
  return await mutatePoolInternal(pool, () => true);
}

/**
 * Internal helper for mutating cards in a pool based on a predicate.
 */
async function mutatePoolInternal(
  pool: SealedDeckPool,
  predicate: (card: ScryfallCard) => boolean,
): Promise<{ poolId: string; mutatedCards: ScryfallCard[] }> {
  const nameToCard = buildNameToCardMap();

  const mutatedCards: ScryfallCard[] = [];

  // Helper to mutate a single card copy
  const mutateCard = async (cardName: string): Promise<SealedDeckEntry> => {
    // Look up the card by name
    const card = nameToCard.get(cardName.toLowerCase());
    if (!card) {
      // Card not found in our cache, return unchanged
      return { name: cardName, count: 1 };
    }

    // Check if this card should be mutated
    if (!predicate(card)) {
      return { name: cardName, count: 1, set: card.set };
    }

    // Get all cards that share the same mutation pool
    const candidates = await getMutationCandidates(cardName);
    if (candidates.length === 0) {
      // No candidates for mutation, return unchanged
      mutatedCards.push(card);
      return { name: cardName, count: 1, set: card.set };
    }

    // Pick a random card from the candidates
    const chosenEntry = getRandomElement(candidates);
    if (!chosenEntry) {
      mutatedCards.push(card);
      return { name: cardName, count: 1, set: card.set };
    }

    // Pick a random printing of that card
    const chosenPrinting = getRandomPrinting(chosenEntry);
    mutatedCards.push(chosenPrinting);

    // Return the mutated entry (count 1 for individual copy)
    return {
      name: chosenPrinting.name,
      count: 1,
      set: chosenPrinting.set,
    };
  };

  // Helper to expand entries and mutate each copy independently
  const mutateEntryIndependently = async (
    entry: SealedDeckEntry,
  ): Promise<SealedDeckEntry[]> => {
    const mutatedCopies: SealedDeckEntry[] = [];
    for (let i = 0; i < entry.count; i++) {
      mutatedCopies.push(await mutateCard(entry.name));
    }
    return mutatedCopies;
  };

  // Mutate all sections of the pool, with each copy mutated independently
  // Order matters for the returned mutatedCards array
  const mutatedSideboard = (await Promise.all(
    pool.sideboard.map(mutateEntryIndependently),
  )).flat();
  const mutatedHidden = (await Promise.all(
    (pool.hidden ?? []).map(mutateEntryIndependently),
  )).flat();
  const mutatedDeck = (await Promise.all(
    (pool.deck ?? []).map(mutateEntryIndependently),
  )).flat();

  // Create the pool request
  const poolRequest: SealedDeckPoolRequest = {
    sideboard: mutatedSideboard,
    hidden: mutatedHidden,
    deck: mutatedDeck,
  };

  // Create the new pool and return its ID
  const poolId = await makeSealedDeck(poolRequest);
  return { poolId, mutatedCards };
}

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: () => Promise.resolve(),
    messageHandlers: [],
    interactionHandlers: [],
  });
}
