import {
  getAllArenaCards,
  getMutationCandidates,
} from "./archive/leagues/tmt/tmt.ts";
import { makeSealedDeck, SealedDeckEntryRequest } from "./sealeddeck.ts";

interface RelaxationLevel {
  removeTypes: number;
  addTypes: number;
  addColors: number;
  removeColors: number;
  maxCmcDiff: number;
}

async function main() {
  console.log("Loading all cards...");
  const allCards = await getAllArenaCards();
  const tmtCardsRaw = allCards.filter(
    (c) => c.set?.toLowerCase() === "tmt" || c.set?.toLowerCase() === "pza",
  );

  // Only consider cards once by name
  const tmtCardsMap = new Map<string, typeof tmtCardsRaw[0]>();
  for (const card of tmtCardsRaw) {
    if (!tmtCardsMap.has(card.name)) {
      tmtCardsMap.set(card.name, card);
    }
  }
  const tmtCards = Array.from(tmtCardsMap.values());

  console.log(`Found ${tmtCards.length} unique TMT/PZA cards.`);

  const results: {
    name: string;
    rarity: string;
    count: number;
    relaxed: RelaxationLevel;
    sealedDeckUrl?: string;
  }[] = [];

  for (const card of tmtCards) {
    const result = await getMutationCandidates(card.name);

    let sealedDeckUrl: string | undefined;
    if (result.candidates.length > 0) {
      const poolId = await makeSealedDeck({
        deck: result.candidates.map((c) => ({
          name: c.card.name,
          count: 1,
          set: c.card.set,
        })) as SealedDeckEntryRequest[],
        sideboard: [{ name: card.name, count: 1, set: card.set }],
      });
      sealedDeckUrl = `https://sealeddeck.tech/${poolId}`;
    }

    results.push({
      name: card.name,
      rarity: card.rarity,
      count: result.candidates.length,
      relaxed: result.relaxationUsed,
      sealedDeckUrl,
    });
  }

  // Sort by count descending, then by name
  results.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  console.log(
    "name,rarity,count,removeTypes,addTypes,addColors,removeColors,maxCmcDiff,sealedDeckUrl",
  );
  for (const res of results) {
    const r = res.relaxed;
    console.log(
      `"${res.name}","${res.rarity}",${res.count},${r.removeTypes},${r.addTypes},${r.addColors},${r.removeColors},${r.maxCmcDiff},${
        res.sealedDeckUrl || ""
      }`,
    );
  }

  // Calculate statistics
  const counts = results.map((r) => r.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const sum = counts.reduce((a, b) => a + b, 0);
  const avg = sum / counts.length;

  console.log("\nStatistics:");
  console.log(`Min targets: ${min}`);
  console.log(`Max targets: ${max}`);
  console.log(`Avg targets: ${avg.toFixed(2)}`);
}

main().catch(console.error);
