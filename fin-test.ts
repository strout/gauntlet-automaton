import { rollStartingPool, generateAndPostStartingPool } from "./fin/pools.ts";
import { ScryfallCard } from "./scryfall.ts";
import { CONFIG, DISCORD_TOKEN, makeClient } from "./main.ts";
import * as djs from "discord.js";

const POOL_COUNT = 1000;

interface CardStats {
  name: string;
  count: number;
  rarity: string;
  colors: readonly string[];
  cmc: number;
}

interface PoolAnalysis {
  totalCards: number;
  byRarity: Record<string, number>;
  byColor: Record<string, number>;
  cardCounts: Map<string, CardStats>;
  averageCMC: number;
}

function analyzePool(pool: ScryfallCard[]): PoolAnalysis {
  const cardCounts = new Map<string, CardStats>();
  const byRarity: Record<string, number> = {};
  const byColor: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let totalCMC = 0;

  for (const card of pool) {
    // Count individual cards
    const existing = cardCounts.get(card.name);
    if (existing) {
      existing.count++;
    } else {
      cardCounts.set(card.name, {
        name: card.name,
        count: 1,
        rarity: card.rarity,
        colors: card.colors || [],
        cmc: card.cmc || 0,
      });
    }

    // Count by rarity
    byRarity[card.rarity] = (byRarity[card.rarity] || 0) + 1;

    // Count by color
    if (card.colors && card.colors.length > 0) {
      for (const color of card.colors) {
        if (color in byColor) {
          byColor[color]++;
        }
      }
    } else {
      byColor.C++; // Colorless
    }

    // Sum CMC for average
    totalCMC += card.cmc || 0;
  }

  return {
    totalCards: pool.length,
    byRarity,
    byColor,
    cardCounts,
    averageCMC: pool.length > 0 ? totalCMC / pool.length : 0,
  };
}

const colorNames: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless"
};

function printAnalysis(analysis: PoolAnalysis) {
  console.log("=== FIN Starting Pool Analysis ===\n");
  
  console.log(`Total Cards: ${analysis.totalCards}\n`);
  
  // Rarity breakdown
  console.log("By Rarity:");
  const rarityOrder = ["mythic", "rare", "uncommon", "common"];
  for (const rarity of rarityOrder) {
    if (analysis.byRarity[rarity]) {
      console.log(`  ${rarity}: ${analysis.byRarity[rarity]}`);
    }
  }
  console.log();
  
  // Color breakdown
  console.log("By Color:");
  for (const [color, count] of Object.entries(analysis.byColor)) {
    if (count > 0) {
      console.log(`  ${colorNames[color]}: ${count}`);
    }
  }
  console.log();
  
  console.log(`Average CMC: ${analysis.averageCMC.toFixed(2)}\n`);
  
  // Cards with multiple copies
  console.log("Cards with Multiple Copies:");
  const duplicates = Array.from(analysis.cardCounts.values())
    .filter(card => card.count > 1)
    .sort((a, b) => b.count - a.count);
    
  if (duplicates.length > 0) {
    for (const card of duplicates) {
      console.log(`  ${card.name}: ${card.count}x (${card.rarity})`);
    }
  } else {
    console.log("  No duplicate cards found");
  }
  console.log();
  
  // Unique cards by rarity
  console.log("Unique Cards by Rarity:");
  for (const rarity of rarityOrder) {
    const cardsOfRarity = Array.from(analysis.cardCounts.values())
      .filter(card => card.rarity === rarity)
      .sort((a, b) => a.name.localeCompare(b.name));
    
    if (cardsOfRarity.length > 0) {
      console.log(`\n  ${rarity.toUpperCase()} (${cardsOfRarity.length} unique):`);
      for (const card of cardsOfRarity) {
        const colorStr = card.colors.length > 0 ? ` [${card.colors.join("")}]` : " [C]";
        const countStr = card.count > 1 ? ` (${card.count}x)` : "";
        console.log(`    ${card.name}${colorStr}${countStr}`);
      }
    }
  }
}

interface ColorHistogram {
  [color: string]: {
    counts: number[];
    min: number;
    max: number;
    average: number;
    median: number;
  };
}

function generateHistogram(pools: ScryfallCard[][]): ColorHistogram {
  const colorData: { [color: string]: number[] } = {
    W: [], U: [], B: [], R: [], G: [], C: []
  };

  // Collect color counts from all pools
  for (const pool of pools) {
    const analysis = analyzePool(pool);
    for (const color of Object.keys(colorData)) {
      colorData[color].push(analysis.byColor[color] || 0);
    }
  }

  // Generate histogram data
  const histogram: ColorHistogram = {};
  for (const [color, counts] of Object.entries(colorData)) {
    counts.sort((a, b) => a - b);
    histogram[color] = {
      counts,
      min: counts[0],
      max: counts[counts.length - 1],
      average: counts.reduce((a, b) => a + b, 0) / counts.length,
      median: counts[Math.floor(counts.length / 2)]
    };
  }

  return histogram;
}

function printHistogram(histogram: ColorHistogram) {
  console.log(`=== Color Distribution Histogram (${POOL_COUNT} pools) ===\n`);
  
  for (const [colorCode, data] of Object.entries(histogram)) {
    const colorName = colorNames[colorCode];
    console.log(`${colorName} (${colorCode}):`);
    console.log(`  Range: ${data.min} - ${data.max}`);
    console.log(`  Average: ${data.average.toFixed(2)}`);
    console.log(`  Median: ${data.median}`);
    
    // Create text histogram
    const buckets = 10;
    const bucketSize = Math.ceil((data.max - data.min + 1) / buckets);
    const bucketCounts = new Array(buckets).fill(0);
    
    for (const count of data.counts) {
      const bucketIndex = Math.min(
        Math.floor((count - data.min) / bucketSize),
        buckets - 1
      );
      bucketCounts[bucketIndex]++;
    }
    
    const maxBucketCount = Math.max(...bucketCounts);
    const barWidth = 50;
    
    console.log(`  Distribution:`);
    for (let i = 0; i < buckets; i++) {
      const rangeStart = data.min + i * bucketSize;
      const rangeEnd = Math.min(rangeStart + bucketSize - 1, data.max);
      const count = bucketCounts[i];
      const barLength = Math.round((count / maxBucketCount) * barWidth);
      const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
      
      console.log(`    ${rangeStart.toString().padStart(2)}-${rangeEnd.toString().padEnd(2)}: ${bar} ${count}`);
    }
    console.log();
  }
}

function generateCSVData(histogram: ColorHistogram): string {
  const colors = Object.keys(histogram);
  const maxLength = Math.max(...colors.map(c => histogram[c].counts.length));
  
  let csv = "Pool," + colors.join(",") + "\n";
  
  for (let i = 0; i < maxLength; i++) {
    const row: (number | string)[] = [i + 1];
    for (const color of colors) {
      row.push(histogram[color].counts[i] || "");
    }
    csv += row.join(",") + "\n";
  }
  
  return csv;
}

async function testRollStartingPool() {
  console.log(`Testing rollStartingPool function with ${POOL_COUNT} pools...\n`);
  
  try {
    const pools: ScryfallCard[][] = [];
    const startTime = Date.now();
    
    // Generate pools
    for (let i = 0; i < POOL_COUNT; i++) {
      if (i % 1000 === 0) {
        console.log(`Generated ${i}/${POOL_COUNT} pools...`);
      }
      const pool = await rollStartingPool();
      if (pool.length > 0) {
        pools.push(pool);
      }
    }
    
    const endTime = Date.now();
    console.log(`\nPool generation completed in ${((endTime - startTime) / 1000).toFixed(2)}s`);
    console.log(`Successfully generated ${pools.length}/${POOL_COUNT} pools\n`);
    
    if (pools.length === 0) {
      console.log("ERROR: No pools generated!");
      return;
    }
    
    // Generate histogram - filter to only commons to match validation logic
    const commonPools = pools.map(pool => pool.filter(card => card.rarity === "common"));
    const histogram = generateHistogram(commonPools);
    printHistogram(histogram);
    
    // Validation summary
    console.log("=== Validation Summary ===");
    let failedPools = 0;
    let colorFailures: { [color: string]: number } = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    
    for (const pool of pools) {
      const analysis = analyzePool(pool);
      let poolFailed = false;
      
      for (const color of ["W", "U", "B", "R", "G"]) {
        if ((analysis.byColor[color] || 0) < 6) {
          colorFailures[color]++;
          poolFailed = true;
        }
      }
      
      if (poolFailed) failedPools++;
    }
    
    console.log(`Pools meeting color requirements: ${pools.length - failedPools}/${pools.length} (${((pools.length - failedPools) / pools.length * 100).toFixed(1)}%)`);
    
    if (failedPools > 0) {
      console.log("\nColor requirement failures:");
      for (const [color, failures] of Object.entries(colorFailures)) {
        if (failures > 0) {
          console.log(`  ${colorNames[color]}: ${failures} pools (${(failures / pools.length * 100).toFixed(1)}%)`);
        }
      }
    }
    
    // Generate CSV data for external visualization
    console.log("\n=== CSV Data for External Visualization ===");
    console.log("(Copy the following data to a .csv file for plotting)");
    console.log("```csv");
    console.log(generateCSVData(histogram));
    console.log("```");
    
  } catch (error) {
    console.error("Error testing rollStartingPool:", error);
  }
}

async function testPoolPost() {
  console.log("Testing pool post functionality...\n");
  
  try {
    // Create Discord client
    const client = makeClient();
    await client.login(DISCORD_TOKEN);
    
    console.log("Discord client logged in successfully");
    
    // Wait for client to be ready (handle race condition)
    if (!client.isReady()) {
      await new Promise<void>((resolve) => {
        client.once(djs.Events.ClientReady, () => resolve());
      });
    }
    
    console.log("Getting guild and channel...");
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels.fetch(CONFIG.BOT_BUNKER_CHANNEL_ID) as djs.TextChannel;
    const user = await client.users.fetch(CONFIG.OWNER_ID);
    
    console.log(`Found guild: ${guild.name}`);
    console.log(`Found channel: ${channel.name}`);
    console.log(`Found user: ${user.username}`);
    
    console.log("\nGenerating and posting starting pool...");
    await generateAndPostStartingPool(user, channel);
    
    console.log("Pool post completed successfully!");
    
  } catch (error) {
    console.error("Error testing pool post:", error);
  } finally {
    Deno.exit(0);
  }
}

// Run the appropriate test based on command line argument
if (import.meta.main) {
  const mode = Deno.args[0];
  
  if (mode === "post") {
    await testPoolPost();
  } else {
    await testRollStartingPool();
  }
}
