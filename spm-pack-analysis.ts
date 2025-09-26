import {
  BoosterSlot,
  generatePackFromSlots,
  getHeroBoosterSlots,
  getVillainBoosterSlots,
} from "./leagues/spm/packs.ts";
import { ScryfallCard } from "./scryfall.ts";

async function generatePacks(
  slotProvider: () => BoosterSlot[],
  count: number,
): Promise<ScryfallCard[][]> {
  const packs: ScryfallCard[][] = [];
  for (let i = 0; i < count; i++) {
    console.error(`Generating pack ${i + 1}/${count}...`);
    const slots = slotProvider().filter((s) => s.balanceGroup !== undefined);
    const pack = await generatePackFromSlots(slots);
    packs.push(pack);
  }
  return packs;
}

async function main() {
  const numPacks = +Deno.args[0] || 1000;
  console.error("Generating hero packs...");
  const heroPacks = await generatePacks(getHeroBoosterSlots, numPacks);
  console.error("Generating villain packs...");
  const villainPacks = await generatePacks(getVillainBoosterSlots, numPacks);

  const allPacks = [...heroPacks.map(cs => ({ cs, type: 'hero' })), ...villainPacks.map(cs => ({ cs, type: 'villain' }))];
  const cardCounts: Record<string, { count: number; rarity: string }> = {};

  for (const pack of allPacks) {
    let i = 0;
    for (const card of pack.cs) {
      const key = pack.type + /* "-" + (++i) + */ ":" + card.name;
      const entry = cardCounts[key] || { count: 0, rarity: card.rarity };
      entry.count++;
      cardCounts[key] = entry;
    }
  }

  const sortedCounts = Object.entries(cardCounts).sort(([, a], [, b]) => b.count - a.count);

  console.log("Card Name,Rarity,Count");
  for (const [name, { rarity, count }] of sortedCounts) {
    console.log(`"${name}",${rarity},${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  Deno.exit(1);
});
