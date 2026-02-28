import { getAllArenaCards, getMutationCandidates } from "./leagues/tmt/tmt.ts";

async function main() {
  console.log("Loading all cards...");
  const allCards = await getAllArenaCards();
  const tmtCardsRaw = allCards.filter((c) => c.set?.toLowerCase() === "tmt");

  // Only consider cards once by name
  const tmtCardsMap = new Map<string, typeof tmtCardsRaw[0]>();
  for (const card of tmtCardsRaw) {
    if (!tmtCardsMap.has(card.name)) {
      tmtCardsMap.set(card.name, card);
    }
  }
  const tmtCards = Array.from(tmtCardsMap.values());

  console.log(`Found ${tmtCards.length} unique TMT cards.`);

  const results: { name: string; rarity: string; count: number }[] = [];

  for (const card of tmtCards) {
    const candidates = await getMutationCandidates(card.name);
    results.push({
      name: card.name,
      rarity: card.rarity,
      count: candidates.length,
    });
  }

  // Sort by count descending, then by name
  results.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  console.log("\nMutation Counts for TMT Cards (Sorted by count):");
  console.log("--------------------------------------------------");
  for (const res of results) {
    console.log(
      `${res.name.padEnd(30)} | ${
        res.rarity.padEnd(10)
      } | ${res.count} targets`,
    );
  }
  console.log("--------------------------------------------------");

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
