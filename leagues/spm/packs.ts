import { choice, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import { SealedDeckEntry } from "../../sealeddeck.ts";

// Booster slot definition
export interface BoosterSlot {
  rarity?: "rare/mythic" | "uncommon" | "common";
  scryfall?: string;
}

// Generate pack cards from booster slots
export async function generatePackFromSlots(
  slots: BoosterSlot[],
): Promise<SealedDeckEntry[]> {
  const packCards: SealedDeckEntry[] = [];

  for (const slot of slots) {
    try {
      // Build Scryfall query
      let query = slot.scryfall || "set:om1";

      // Add rarity filter if specified
      if (slot.rarity) {
        if (slot.rarity === "rare/mythic") {
          // Handle rare/mythic with proper weighting
          const rareQuery = `${query} rarity:rare`;
          const mythicQuery = `${query} rarity:mythic`;

          const [rares, mythics] = await Promise.all([
            searchCards(rareQuery, { unique: "cards" }),
            searchCards(mythicQuery, { unique: "cards" }),
          ]);

          // Weight rares 2:1 over mythics
          const weightedCards = [
            ...rares.map((card): [ScryfallCard, number] => [card, 2]),
            ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
          ];

          const selectedCard = weightedChoice(weightedCards);
          if (selectedCard) {
            packCards.push({ name: selectedCard.name, count: 1 });
          }
        } else {
          query += ` rarity:${slot.rarity}`;
          const cards = await searchCards(query, { unique: "cards" });
          const selectedCard = choice(cards);
          if (selectedCard) {
            packCards.push({ name: selectedCard.name, count: 1 });
          }
        }
      } else {
        // No rarity specified, search all rarities
        const cards = await searchCards(query, { unique: "cards" });
        const selectedCard = choice(cards);
        if (selectedCard) {
          packCards.push({ name: selectedCard.name, count: 1 });
        }
      }
    } catch (error) {
      console.error(`Error generating card for slot:`, slot, error);
      // Add a fallback card if generation fails
      packCards.push({ name: "Unknown Card", count: 1 });
    }
  }

  return packCards;
}
// booster slots for citizens - hero pack
export function getCitizenHeroBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(-t:hero t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena -s:spm -s:om1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u",
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        'game:arena legal:standard r:c (o:"+1/+1" o:"put" -o:renew -o:exhaust)',
    },
    {
      rarity: "common",
      scryfall:
        '(o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer',
    },
    {
      rarity: "common",
      scryfall:
        'o:"when this creature enters" game:arena r:c t:creature legal:standard',
    },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
  ];
}

// booster slots for citizens - villain pack
export function getCitizenVillainBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(t:hero -t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena legal:standard r:u (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw)",
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        "legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet",
    },
    {
      rarity: "common",
      scryfall:
        "legal:pioneer game:arena r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth)",
    },
    {
      rarity: "common",
      scryfall:
        'game:arena legal:standard r:c (o:"commit a crime" OR o:"target spell" OR otag:removal)',
    },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
  ];
}
