import { searchCards } from "./scryfall.ts";
import {
  getCitizenHeroBoosterSlots,
  getCitizenVillainBoosterSlots,
} from "./leagues/spm/packs.ts";

interface CardSlotInfo {
  cardName: string;
  slots: string[];
}

async function main() {
  const heroSlots = getCitizenHeroBoosterSlots();
  const villainSlots = getCitizenVillainBoosterSlots();
  const allSlots = [...heroSlots, ...villainSlots].filter((slot) =>
    slot.balanceGroup
  );

  const cardSlotMap = new Map<string, string[]>();

  for (const slot of allSlots) {
    const query = slot.scryfall || "set:om1";
    try {
      const cards = await searchCards(query, { unique: "cards" });
      for (const card of cards) {
        const existingSlots = cardSlotMap.get(card.name) || [];
        cardSlotMap.set(card.name, [...existingSlots, query]);
      }
    } catch (e) {
      console.error(`Error for query: ${query}`, e);
    }
  }

  const multiSlotCards: CardSlotInfo[] = [];
  for (const [cardName, slots] of cardSlotMap.entries()) {
    if (slots.length > 1) {
      multiSlotCards.push({ cardName, slots });
    }
  }

  if (multiSlotCards.length > 0) {
    console.log("Cards that can be in multiple slots (from balanced groups):");
    for (const cardInfo of multiSlotCards) {
      console.log(`- ${cardInfo.cardName}: ${cardInfo.slots.join(", ")}`);
    }
  } else {
    console.log("No cards found in multiple slots from balanced groups.");
  }
}

if (import.meta.main) {
  main();
}
