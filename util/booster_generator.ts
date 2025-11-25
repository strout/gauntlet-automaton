// Placeholder for the new reusable booster generation system
// This file will contain the core BoosterSlot interface and the generic pack generation logic.

import { ScryfallCard, searchCards } from "../scryfall.ts";
import { choice, weightedChoice } from "../random.ts";

export interface BoosterSlot {
  // A direct Scryfall search query string. This allows for highly flexible and specific card selection.
  scryfallQuery?: string;
  // An exact card name to search for. Overrides other properties if provided.
  exactName?: string;
  // Optional properties that can be used to construct a Scryfall query or filter results
  rarity?:
    | "common"
    | "uncommon"
    | "rare"
    | "mythic"
    | "special"
    | "bonus"
    | "rare/mythic";

  type?: string | string[]; // e.g., 'creature', ['basic', 'land'], or ['creature', 'artifact']
  set?: string; // e.g., 'zne' for Zendikar Rising

  // Add more properties as needed for common filtering criteria
  // e.g., legalities, keywords, power/toughness ranges, etc.

  // How many cards this slot should contribute to the pack. Defaults to 1.
  count?: number;

  // An optional balance group to ensure diversity (e.g., color balance for lands or main set cards)
  balanceGroup?: string;
}

/**
 * Constructs a Scryfall query string from a BoosterSlot object.
 * @param slot The BoosterSlot definition.
 * @returns A Scryfall query string.
 */
function generateScryfallQuery(slot: BoosterSlot): string {
  const defaultQueryParts = ["is:booster", "game:paper game:arena"]; // Base constraints for all Scryfall queries

  if (slot.scryfallQuery) {
    return `${slot.scryfallQuery} ${defaultQueryParts.join(" ")}`;
  }
  if (slot.exactName) {
    return `!"${slot.exactName}" ${defaultQueryParts.join(" ")}`;
  }

  const parts: string[] = [];

  // Rarity
  if (slot.rarity) {
    parts.push(`r:${slot.rarity}`);
  }

  // Type
  if (slot.type) {
    if (Array.isArray(slot.type)) {
      const typeParts = slot.type.map((t) => `t:${t}`);
      parts.push(...typeParts);
    } else {
      parts.push(`t:${slot.type}`);
    }
  }

  // Set
  if (slot.set) {
    parts.push(`set:${slot.set}`);
  }

  return `${parts.join(" ")} ${defaultQueryParts.join(" ")}`;
}

/**
 * Generates a booster pack based on a list of BoosterSlot definitions.
 * This is a generic function that can be used by any league or system.
 *
 * @param slots An array of BoosterSlot objects defining the contents of the pack.
 * @returns A promise that resolves to an array of ScryfallCard objects.
 */
export async function generatePackFromSlots(
  slots: BoosterSlot[],
): Promise<ScryfallCard[]> {
  const pack: ScryfallCard[] = [];


  for (const slot of slots) {
    if (slot.rarity === "rare/mythic") {
      // Create a temporary slot without rarity to generate the base query
      const tempSlot: BoosterSlot = { ...slot, rarity: undefined };
      const baseQuery = generateScryfallQuery(tempSlot);

      const rareQuery = `${baseQuery} rarity:rare`;
      const mythicQuery = `${baseQuery} rarity:mythic`;

      const [possibleRares, possibleMythics] = await Promise.all([
        searchCards(rareQuery),
        searchCards(mythicQuery),
      ]);

      const weightedCards: [ScryfallCard, number][] = [
        ...possibleRares.map((card) => [card, 2] as [ScryfallCard, number]), // Rares get 2x weight
        ...possibleMythics.map((card) => [card, 1] as [ScryfallCard, number]), // Mythics get 1x weight
      ];

      const numToSelect = slot.count || 1;
      const cardsForThisSlot: ScryfallCard[] = [];
      let attempts = 0;

      while (
        cardsForThisSlot.length < numToSelect &&
        attempts < (possibleRares.length * 2 + possibleMythics.length) * 2
      ) {
        const selectedCard = weightedChoice(weightedCards);
        if (selectedCard) {
          cardsForThisSlot.push(selectedCard);

        }
        attempts++;
      }

      if (cardsForThisSlot.length < numToSelect) {
        console.warn(
          `Could only find ${cardsForThisSlot.length} unique cards for rare/mythic slot (needed ${numToSelect}):`,
          slot,
        );
      }
      pack.push(...cardsForThisSlot);
      continue; // Move to the next slot after handling rare/mythic
    }

    // Existing logic for other rarity types or general queries
    const baseQuery = generateScryfallQuery(slot);
    if (!baseQuery.trim()) {
      console.warn("Skipping slot due to empty query:", slot);
      continue;
    }

    // Use searchCards to fetch all results for the specific query
    const possibleCards = await searchCards(baseQuery); // No SearchOptions here

    if (possibleCards.length === 0) {
      console.warn("No cards found for query:", baseQuery, "from slot:", slot);
      continue;
    }

    const numToSelect = slot.count || 1;
    const cardsForThisSlot: ScryfallCard[] = [];

    // Attempt to select unique cards for this slot
    let attempts = 0;
    while (
      cardsForThisSlot.length < numToSelect &&
      attempts < possibleCards.length * 2
    ) {
      const selectedCard = choice(possibleCards);
      if (selectedCard) {
        cardsForThisSlot.push(selectedCard);

      }
      attempts++;
    }

    if (cardsForThisSlot.length < numToSelect) {
      console.warn(
        `Could only find ${cardsForThisSlot.length} unique cards for slot (needed ${numToSelect}):`,
        slot,
      );
    }
    pack.push(...cardsForThisSlot);
  }
  return pack;
}
