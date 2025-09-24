import { searchCards } from "./scryfall.ts";
import { makeSealedDeck } from "./sealeddeck.ts";
import { getCitizenHeroBoosterSlots, getCitizenVillainBoosterSlots } from "./spm.ts";

// Helper to extract all unique Scryfall queries from booster slots
function getAllScryfallQueries() {
  const heroSlots = getCitizenHeroBoosterSlots();
  const villainSlots = getCitizenVillainBoosterSlots();
  const queries = new Set<string>();
  for (const slot of [...heroSlots, ...villainSlots]) {
    if (slot.scryfall) queries.add(slot.scryfall);
    else queries.add("set:spm");
    if (slot.rarity && slot.rarity !== "rare/mythic") {
      queries.add(`${slot.scryfall || "set:spm"} rarity:${slot.rarity}`);
    }
    if (slot.rarity === "rare/mythic") {
      queries.add(`${slot.scryfall || "set:spm"} rarity:rare`);
      queries.add(`${slot.scryfall || "set:spm"} rarity:mythic`);
    }
  }
  // Add queries from rollStartingPool
  const SPM_BASE_POOL_SEARCH = "in:paper in:arena is:booster set:SPM -type:basic";
  queries.add(`${SPM_BASE_POOL_SEARCH} rarity:rare`);
  queries.add(`${SPM_BASE_POOL_SEARCH} rarity:mythic`);
  queries.add(`${SPM_BASE_POOL_SEARCH} rarity:uncommon`);
  queries.add(`${SPM_BASE_POOL_SEARCH} rarity:common`);
  queries.add("in:arena in:paper -s:spm -s:om1 t:spider r<r");
  return Array.from(queries);
}

async function main() {
  const queries = getAllScryfallQueries();
  for (const query of queries) {
    try {
      const cards = await searchCards(query, { unique: "cards" });
      if (!cards.length) {
        console.log(`Query: ${query} => No cards found.`);
        continue;
      }
      // Build a pool: 1 of each card
      const pool = cards.map(card => ({ name: card.name, count: 1, set: card.set }));
      const poolId = await makeSealedDeck({ sideboard: pool });
      const link = `https://sealeddeck.tech/${poolId}`;
      console.log(`Query: ${query}\n  Pool link: ${link}`);
    } catch (e) {
      console.error(`Error for query: ${query}`, e);
    }
  }
}

if (import.meta.main) main();
