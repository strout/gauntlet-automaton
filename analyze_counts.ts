import { readFileSync } from "node:fs";

interface CardCount {
  type: string;
  name: string;
  rarity: string;
  count: number;
}

function calculateStats(counts: number[]): { mean: number; stddev: number } {
  if (counts.length === 0) {
    return { mean: 0, stddev: 0 };
  }

  const sum = counts.reduce((a, b) => a + b, 0);
  const mean = sum / counts.length;

  const variance =
    counts.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) /
    counts.length;
  const stddev = Math.sqrt(variance);

  return { mean, stddev };
}

function analyze(data: string) {
  const lines = data.split("\n").slice(1);
  const cards: CardCount[] = [];
  const groups: Record<string, number[]> = {};

  for (const line of lines) {
    if (!line) continue;
    const match = line.match(/"(.*?)",(.*?),(.*)/);
    if (match) {
      let [, name, rarity, countStr] = match;
      if (name && rarity && countStr) {
        const [type, ...nameParts] = name.split(":");
        name = nameParts.join(":");
        const count = parseInt(countStr, 10);
        cards.push({ name, type, rarity, count });

        if (!groups[type + ":" + rarity]) {
          groups[type + ":" + rarity] = [];
        }
        groups[type + ":" + rarity].push(count);
      }
    }
  }

  for (const rarity in groups) {
    const counts = groups[rarity];
    const { mean, stddev } = calculateStats(counts);

    console.log(`### ${rarity}`);
    console.log(`- **Mean:** ${mean.toFixed(2)}`);
    console.log(`- **Standard Deviation:** ${stddev.toFixed(2)}`);

    const cardsInRarity = cards.filter((card) =>
      card.type + ":" + card.rarity === rarity
    );
    cardsInRarity.sort((a, b) => b.count - a.count);

    const top10 = cardsInRarity.slice(0, 10);
    const bottom10 = cardsInRarity.slice(-10).reverse();

    console.log(`- **Top 10 Most Frequent:**`);
    if (top10.length === 0) {
      console.log("  - None");
    } else {
      for (const card of top10) {
        console.log(`  - "${card.name}": ${card.count}`);
      }
    }

    console.log(`- **Bottom 10 Least Frequent:**`);
    if (bottom10.length === 0) {
      console.log("  - None");
    } else {
      for (const card of bottom10) {
        console.log(`  - "${card.name}": ${card.count}`);
      }
    }
    console.log("");
  }
}

function main() {
  const filename = Deno.args[0] || "card_counts_with_rarity.csv";
  try {
    const data = readFileSync(filename, "utf-8");
    analyze(data);
  } catch (error) {
    console.error(`Error reading or analyzing file: ${filename}`, error);
    Deno.exit(1);
  }
}

main();
