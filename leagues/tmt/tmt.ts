import { delay } from "@std/async";
import { Client, Interaction, Message } from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { mutex } from "../../mutex.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import {
  getAllMatches,
  getPlayers,
  MATCHTYPE,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  genPoolHandler,
  matchpackHandler,
  processMatchPack,
} from "./pool-gen.ts";
import {
  handleMatchPackNo,
  handleMatchPackYes,
  handleMutateButton,
  handleMutateSelect,
  handleMutationChannelMessage,
} from "./pool-dm.ts";
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
 * Checks if a card is from the TMT or PZA set
 * @param card - The Scryfall card to check
 * @returns true if the card is from TMT or PZA
 */
function isCardFromTMT(card: ScryfallCard): boolean {
  const set = card.set?.toLowerCase();
  return set === "tmt" || set === "pza";
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
 * A few exceptions are made for TMC cards on Arena but not in timeless and ANB cards not in vintage.
 * @param card - The Scryfall card to check
 * @returns true if the card is legal or restricted in both Vintage and Timeless
 */
function isCardLegalInVintageAndTimeless(card: ScryfallCard): boolean {
  const v = card.legalities["vintage"];
  const t = card.legalities["timeless"];
  return (v === "legal" || v === "restricted" ||
    card.set.toLowerCase() === "anb") &&
    (t === "legal" || t === "restricted" ||
      (card.set.toLowerCase() === "tmc" &&
        [ // regrettably, there's no real pattern for which TMC cards were put on Arena or not, and Scryfall has them all tagged as game:arena regardless
          1,
          9,
          2,
          12,
          14,
          10,
          13,
          15,
          3,
          19,
          20,
          27,
          28,
          22,
          4,
          5,
          133,
          33,
          30,
          6,
          135,
          136,
        ].map((x) => x.toString()).includes(card.collector_number)));
}

/**
 * Loads cards from the local bulk data file if it exists.
 * Populates both allCardsCache (mutation targets) and allArenaCardsCache (lookup).
 * Falls back to null if the file doesn't exist or can't be read.
 * @returns Array of filtered Scryfall cards (non-TMT/PZA) or null if file not available
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

    // Load ALL Arena cards (including TMT and PZA) for lookup purposes
    // Include rebalanced and token cards so we can identify them
    const allArenaCards = allCards.filter((card) => isCardOnArena(card));
    allArenaCardsCache = allArenaCards;
    console.log(
      `Loaded ${allArenaCards.length} total Arena cards for lookup`,
    );

    // Filter for Arena cards that are:
    // - NOT TMT or PZA
    // - NOT tokens
    // - Legal in both Vintage and Timeless (real cards on Arena)
    // These are the cards that TMT/PZA cards can be mutated into
    const filtered = allCards.filter((card) =>
      !isCardFromTMT(card) && !isCardToken(card) &&
      isCardLegalInVintageAndTimeless(card) && isCardOnArena(card)
    );

    console.log(
      `Loaded ${filtered.length} non-TMT/PZA Arena cards from local file`,
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
    // Fetch non-TMT/PZA cards for mutation targets
    cards = await searchCards(
      "-e:tmt -e:pza (f:vintage or set:anb) game:arena (f:timeless or (set:tmc (cn:1 or or cn:9 or cn:2 or cn:12 or cn:14 or cn:10 or cn:13 or cn:15 or cn:3 or cn:19 or cn:20 or cn:27 or cn:28 or cn:22 or cn:4 or cn:5 or cn:133 or cn:33 or cn:30 or cn:6 or cn:135 or cn:136)))",
      {
        unique: "prints", // Search by unique printings
      },
    );

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
  const rarityMap = new Map<
    MutationKeyRarity,
    Map<
      MutationKeyColors,
      Map<MutationKeyTypes, Map<MutationKeyCmc, CardWithPrintings[]>>
    >
  >();

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
  const readonlyRarityMap = new Map<
    MutationKeyRarity,
    ReadonlyMap<
      MutationKeyColors,
      ReadonlyMap<
        MutationKeyTypes,
        ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>
      >
    >
  >();

  for (const [rarity, colorsMap] of rarityMap) {
    const readonlyColorsMap = new Map<
      MutationKeyColors,
      ReadonlyMap<
        MutationKeyTypes,
        ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>
      >
    >();
    for (const [colors, typesMap] of colorsMap) {
      const readonlyTypesMap = new Map<
        MutationKeyTypes,
        ReadonlyMap<MutationKeyCmc, readonly CardWithPrintings[]>
      >();
      for (const [types, cmcMap] of typesMap) {
        const readonlyCmcMap = new Map<
          MutationKeyCmc,
          readonly CardWithPrintings[]
        >();
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
    // Prefer tmt or pza so they get correct rarity
    if (!map.has(fullName) || ["tmt","pza"].includes(card.set.toLowerCase())) {
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
  /** Number of colors to REMOVE from the target card's colors (candidate has fewer colors) */
  readonly removeColors?: number;
  /** Number of colors to ADD to the target card's colors (candidate has more colors) */
  readonly addColors?: number;
  /** Number of types to REMOVE from the target card's types (candidate has fewer type words) */
  readonly removeTypes?: number;
  /** Number of types to ADD to the target card's types (candidate has more type words) */
  readonly addTypes?: number;
}

/**
 * Checks if candidate colors match the target colors with the given add/remove constraints.
 * Uses widening: the numbers represent maximum colors to add/remove.
 * @param candidateColors - The candidate card's colors (e.g., "WU")
 * @param targetColors - The target card's colors to match against
 * @param removeColors - Maximum number of colors to remove from target
 * @param addColors - Maximum number of colors to add to target
 * @returns true if colors match the constraints
 */
function colorsMatch(
  candidateColors: string,
  targetColors: string,
  removeColors: number,
  addColors: number,
): boolean {
  const targetSet = new Set(targetColors);
  const candidateSet = new Set(candidateColors);

  const colorsInTargetNotInCandidate: string[] = [];
  for (const c of targetColors) {
    if (!candidateSet.has(c)) {
      colorsInTargetNotInCandidate.push(c);
    }
  }

  const colorsInCandidateNotInTarget: string[] = [];
  for (const c of candidateColors) {
    if (!targetSet.has(c)) {
      colorsInCandidateNotInTarget.push(c);
    }
  }

  const removed = colorsInTargetNotInCandidate.length;
  const added = colorsInCandidateNotInTarget.length;

  if (removed > removeColors) return false;
  if (added > addColors) return false;

  return true;
}

/**
 * Checks if candidate types match the target types with the given add/remove constraints.
 * Uses widening: the numbers represent maximum types to add/remove.
 * @param candidateTypes - The candidate card's main types
 * @param targetTypes - The target card's main types
 * @param removeTypes - Maximum number of type words to remove from target
 * @param addTypes - Maximum number of type words to add to target
 * @returns true if types match the constraints
 */
function typesMatch(
  candidateTypes: string,
  targetTypes: string,
  removeTypes: number,
  addTypes: number,
): boolean {
  const targetTypeList = targetTypes.split(" ").filter((t) => t);
  const candidateTypeList = candidateTypes.split(" ").filter((t) => t);

  const targetLen = targetTypeList.length;
  const candidateLen = candidateTypeList.length;

  if (targetLen === 0) {
    return candidateLen === 0;
  }

  const targetSet = new Set(targetTypeList);
  const candidateSet = new Set(candidateTypeList);

  const typesInTargetNotInCandidate: string[] = [];
  for (const t of targetTypeList) {
    if (!candidateSet.has(t)) {
      typesInTargetNotInCandidate.push(t);
    }
  }

  const typesInCandidateNotInTarget: string[] = [];
  for (const t of candidateTypeList) {
    if (!targetSet.has(t)) {
      typesInCandidateNotInTarget.push(t);
    }
  }

  const removed = typesInTargetNotInCandidate.length;
  const added = typesInCandidateNotInTarget.length;

  if (removed > removeTypes) return false;
  if (added > addTypes) return false;

  return true;
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
  const removeColors = options.removeColors ?? 0;
  const addColors = options.addColors ?? 0;
  const removeTypes = options.removeTypes ?? 0;
  const addTypes = options.addTypes ?? 0;

  const results: CardWithPrintings[] = [];

  for (const [, colorsMap] of map) {
    for (const [, typesMap] of colorsMap) {
      for (const [typesKey, cmcMap] of typesMap) {
        if (!typesMatch(typesKey, key.types, removeTypes, addTypes)) {
          continue;
        }

        for (const [, entries] of cmcMap) {
          for (const entry of entries) {
            const entryCard = entry.card;

            if (entry.card.oracle_id === card.oracle_id) continue;

            if (entryCard.rarity !== key.rarity) continue;

            const entryColors = (entryCard.color_identity ?? []).slice().sort()
              .join("");
            if (
              !colorsMatch(entryColors, key.colors, removeColors, addColors)
            ) {
              continue;
            }

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

export interface MutationCandidateResult {
  readonly candidates: readonly CardWithPrintings[];
  readonly relaxationUsed: {
    readonly removeTypes: number;
    readonly addTypes: number;
    readonly addColors: number;
    readonly removeColors: number;
    readonly maxCmcDiff: number;
  };
}

const DEFAULT_MIN_CANDIDATES = 5;

/**
 * Gets all potential mutation targets for a card given its name.
 * Uses progressive widening: starts with strict match, then relaxes criteria
 * until at least minCandidates are found (default 5).
 * @param cardName - The name of the card to mutate
 * @param minCandidates - Minimum number of candidates to find (default 5)
 * @returns Promise resolving to a MutationCandidateResult with candidates and relaxation level
 */
export async function getMutationCandidates(
  cardName: string,
  minCandidates: number = DEFAULT_MIN_CANDIDATES,
): Promise<MutationCandidateResult> {
  for (let removeTypes = 0; removeTypes <= 2; removeTypes++) {
    for (let addColors = 0; addColors <= 1; addColors++) {
      for (let removeColors = 0; removeColors <= 1; removeColors++) {
        for (let addTypes = 0; addTypes <= 2; addTypes++) {
          for (let maxCmcDiff = 0; maxCmcDiff <= 5; maxCmcDiff++) {
            const candidates = await findCandidatesWithRelaxedMatch(cardName, {
              maxCmcDiff,
              removeColors,
              addColors,
              removeTypes,
              addTypes,
            });

            if (candidates.length >= minCandidates) {
              return {
                candidates,
                relaxationUsed: {
                  removeTypes,
                  addTypes,
                  addColors,
                  removeColors,
                  maxCmcDiff,
                },
              };
            }
          }
        }
      }
    }
  }

  return {
    candidates: [],
    relaxationUsed: {
      removeTypes: 2,
      addTypes: 2,
      addColors: 2,
      removeColors: 2,
      maxCmcDiff: 5,
    },
  };
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
    const result = await getMutationCandidates(cardName);
    if (result.candidates.length === 0) {
      // No candidates for mutation, return unchanged
      mutatedCards.push(card);
      return { name: cardName, count: 1, set: card.set };
    }

    // Pick a random card from the candidates
    const chosenEntry = getRandomElement(result.candidates);
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

const pollingLock = mutex();

async function checkForMatches(client: Client<true>) {
  using _ = await pollingLock();

  const [allMatchesData, players] = await Promise.all([
    getAllMatches(),
    getPlayers(),
  ]);

  const allMatches = allMatchesData.rows;

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    if (!m["Script Handled"] || m["Bot Messaged"]) continue;

    const playerName = m["Loser Name"];
    const player = players.rows.find((p) => p.Identification === playerName);
    if (!player) {
      console.error(`[TMT] Could not find loser "${playerName}"`);
      continue;
    }

    const discordId = player["Discord ID"];
    if (!discordId) {
      console.error(`[TMT] No Discord ID for "${playerName}"`);
      continue;
    }

    try {
      const result = await processMatchPack(client, discordId, playerName);

      if (!result.ok) {
        console.error(
          `[TMT] Match pack failed for ${playerName}:`,
          result.error,
        );
        continue;
      }

      const type = m[MATCHTYPE] as "match" | "entropy";
      const sheetName = allMatchesData.sheetName[type];
      const colIndex = allMatchesData.headerColumns[type]["Bot Messaged"];

      if (colIndex === undefined) {
        throw new Error(`Could not find "Bot Messaged" column in ${sheetName}`);
      }

      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `${sheetName}!R${m[ROWNUM]}C${colIndex + 1}`,
        [[true]],
      );
    } catch (error) {
      console.error(
        `[TMT] Error processing match pack for ${playerName}:`,
        error,
      );
    }
  }
}

const mutationChannelHandler: Handler<Message> = async (message, handle) => {
  const handled = await handleMutationChannelMessage(message);
  if (handled) handle.claim();
};

const mutateSelectHandler: Handler<Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu()) return;
  const handled = await handleMutateSelect(interaction);
  if (handled) handle.claim();
};

const mutateButtonHandler: Handler<Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton()) return;
  const mutationChannelId = CONFIG.TMT?.MUTATION_CHANNEL_ID;
  if (!mutationChannelId) return;
  const handled = await handleMutateButton(interaction, mutationChannelId) ||
    await handleMatchPackYes(interaction, mutationChannelId) ||
    await handleMatchPackNo(interaction);
  if (handled) handle.claim();
};

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: async (client: Client) => {
      if (!client.readyAt) {
        await new Promise((resolve) => client.once("ready", resolve));
      }
      const readyClient = client as Client<true>;

      console.log("[TMT] Starting match pack polling loop...");
      while (true) {
        try {
          await checkForMatches(readyClient);
        } catch (error) {
          console.error("[TMT] Error in match pack polling loop:", error);
        }
        await delay(30_000);
      }
    },
    messageHandlers: [genPoolHandler, matchpackHandler, mutationChannelHandler],
    interactionHandlers: [mutateSelectHandler, mutateButtonHandler],
  });
}
