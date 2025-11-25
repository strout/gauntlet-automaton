// SPM Starting Pool Generation

import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { choice, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import { CONFIG } from "../../config.ts";
import { addPoolChange, getPlayers } from "../../standings.ts";
import { makeSealedDeck } from "../../sealeddeck.ts";

const SPM_BASE_POOL_SEARCH = "set:om1";

/**
 * Rolls a starting SPM pool for a new player
 * @returns The starting pool cards
 */
export async function rollStartingPool(): Promise<ScryfallCard[]> {
  const pool: ScryfallCard[] = [];

  try {
    // Get all SPM cards by rarity
    const [rares, mythics, uncommons, commons] = await Promise.all([
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:rare`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:common`, {
        unique: "cards",
      }),
    ]);

    // Pre-calculate weight mappings for rare/mythic (rares appear twice as often as mythics)
    const rareMythicWeights: [ScryfallCard, number][] = [
      ...rares.map((card): [ScryfallCard, number] => [card, 2]),
      ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
    ];

    // Roll 6 rare/mythic
    for (let i = 0; i < 6; i++) {
      const randomCard = weightedChoice(rareMythicWeights);
      if (randomCard) pool.push(randomCard);
    }

    // Roll 20 uncommons in 5 batches of 4 with no duplicates per batch
    for (let batch = 0; batch < 5; batch++) {
      const batchUncommons: ScryfallCard[] = [];
      const usedInBatch = new Set<string>();

      for (let i = 0; i < 4; i++) {
        let randomCard: ScryfallCard | undefined;
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops

        do {
          randomCard = choice(uncommons);
          attempts++;
        } while (
          randomCard && usedInBatch.has(randomCard.name) &&
          attempts < maxAttempts
        );

        if (randomCard) {
          batchUncommons.push(randomCard);
          usedInBatch.add(randomCard.name);
        }
      }

      pool.push(...batchUncommons);
    }

    // Roll 50 commons with deduplication logic and color requirements
    // Roll 5 batches of 10, no replacement within a batch, yes replacement between batches
    // Each batch must have at least 1 of each color (W, U, B, R, G)
    for (let batch = 0; batch < 5; batch++) {
      const batchCommons: ScryfallCard[] = [];
      const usedInBatch = new Set<string>();
      const colorsInBatch = new Set<string>();

      for (let i = 0; i < 10; i++) {
        let randomCard: ScryfallCard | undefined;
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops

        do {
          randomCard = choice(commons);
          attempts++;
        } while (
          randomCard && usedInBatch.has(randomCard.name) &&
          attempts < maxAttempts
        );

        if (randomCard) {
          batchCommons.push(randomCard);
          usedInBatch.add(randomCard.name);
          for (const color of randomCard.colors || []) {
            colorsInBatch.add(color);
          }
        }
      }

      if (colorsInBatch.size < 5) {
        // If we're missing a color, abandon the batch
        batch--;
        continue;
      }

      pool.push(...batchCommons);
    }

    // Add one spider card from the special query
    try {
      const spiderCards = await searchCards(
        "in:arena in:paper -s:spm -s:om1 t:spider r<r",
        {
          unique: "cards",
        },
      );
      const spiderCard = choice(spiderCards);
      if (spiderCard) {
        pool.push(spiderCard);
      }
    } catch (error) {
      console.error("Error fetching spider card:", error);
      // Continue without spider card if it fails
    }

    return pool;
  } catch (error) {
    console.error("Error rolling initial SPM pool:", error);
    return [];
  }
}

/**
 * Gets the most common WUBRG color in a pool of cards
 * @param pool - Array of ScryfallCard objects
 * @returns Hex color code for the most common color
 */
export function getPoolAccentColor(pool: ScryfallCard[]): number {
  const colorCounts: Record<string, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  // Count colors in the pool
  for (const card of pool) {
    if (card.colors) {
      for (const color of card.colors) {
        if (color in colorCounts) {
          colorCounts[color]++;
        }
      }
    }
  }

  // Find the most common color, or 'M' if there are multiples
  const mostCommonColor = Object.entries(colorCounts)
    .reduce((a, b) =>
      colorCounts[a[0]] > colorCounts[b[0]]
        ? a
        : colorCounts[a[0]] < colorCounts[b[0]]
        ? b
        : ["M", a[1]]
    )[0];

  // Return hex colors for each WUBRG color
  const colorHex: Record<string, number> = {
    W: 0xFFF9E3, // Brighter white/yellow
    U: 0x0E68AB, // Blue
    B: 0x7C3AED, // Lighter purple for black
    R: 0xD3202A, // Red
    G: 0x00733E, // Green
  };

  return colorHex[mostCommonColor] || 0xE87800; // Default orange if no color is most common
}

/**
 * Generates and posts a starting SPM pool for a user
 * @param user - Discord User object
 * @param channel - Discord TextChannel to post in
 */
export async function generateAndPostStartingPool(
  user: djs.User | djs.GuildMember,
  channel: djs.TextChannel,
  replyTo?: djs.Message,
): Promise<void> {
  try {
    console.log(`Generating starting SPM pool for user ${user.id}...`);

    // Show typing indicator
    await channel.sendTyping();

    // Roll the starting pool
    const pool = await rollStartingPool();

    // Create pool content text
    const poolContent = pool
      .map((card) =>
        `${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`
      )
      .join("\n");

    // Create attachment for pool list
    const poolBuffer = Buffer.from(poolContent, "utf-8");
    const poolAttachment = new djs.AttachmentBuilder(poolBuffer, {
      name: "pool.txt",
      description: "Complete SPM starting pool card list",
    });

    // Try to get a guild display name if there is one
    if (!(user instanceof djs.GuildMember)) {
      user = await channel.guild.members.fetch(user.id).catch(() => user);
    }

    // Post initial message with placeholder content
    const initialEmbed = new djs.EmbedBuilder()
      .setTitle(
        `🕷️ SPM Starting Pool - ${user.displayName}`,
      )
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: "⏳ Generating...",
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: "⏳ Generating...",
          inline: true,
        },
        {
          name: "📊 Total Cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    const message =
      await (replyTo?.reply.bind(replyTo) ?? channel.send.bind(channel))({
        embeds: [initialEmbed],
        files: [poolAttachment],
      });

    // Generate SealedDeck and rare+spider card image in background (concurrent)
    console.log("Creating SealedDeck.tech pool and rare+spider card image...");
    // Find rare/mythic cards and the extra spider card (last card in pool)
    const rareMythicCards = pool.filter(
      (card) => card.rarity === "rare" || card.rarity === "mythic",
    );
    let spiderCard: ScryfallCard | undefined = undefined;
    if (pool.length > 0) {
      const lastCard = pool[pool.length - 1];
      // Heuristic: the spider card is the last card and not from OM1
      spiderCard = lastCard;
    }
    const rareImageCards = spiderCard
      ? [...rareMythicCards, spiderCard]
      : rareMythicCards;
    const [sealedDeckResult, rareImageResult] = await Promise.allSettled([
      makeSealedDeck({
        sideboard: pool.map((card) => ({
          name: card.name,
          count: 1,
          set: card.set,
        })),
      }),
      tileCardImages(rareImageCards, "small"),
    ]);

    // Handle SealedDeck result
    let poolId: string;
    let sealedDeckLink: string;
    if (sealedDeckResult.status === "fulfilled") {
      poolId = sealedDeckResult.value;
      sealedDeckLink = `https://sealeddeck.tech/${poolId}`;
    } else {
      console.error("SealedDeck generation failed:", sealedDeckResult.reason);
      poolId = "Error";
      sealedDeckLink = "Failed to generate";
    }

    // Handle rare image result
    let rareImageAttachment: djs.AttachmentBuilder | undefined;
    if (rareImageResult.status === "fulfilled") {
      const rareImageBuffer = Buffer.from(
        await rareImageResult.value.arrayBuffer(),
      );
      rareImageAttachment = new djs.AttachmentBuilder(rareImageBuffer, {
        name: "rares.png",
        description: "Rare and mythic cards from starting pool",
      });
    } else {
      console.error("Rare image generation failed:", rareImageResult.reason);
    }

    // Update message with final content
    const finalEmbed = new djs.EmbedBuilder()
      .setTitle(
        `🕷️ SPM Starting Pool - ${user.displayName}`,
      )
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: sealedDeckLink,
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: `\`${poolId}\``,
          inline: true,
        },
        {
          name: "📊 Total Cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    // Only set image if we have the attachment
    if (rareImageAttachment) {
      finalEmbed.setImage("attachment://rares.png");
    }

    const finalFiles = rareImageAttachment
      ? [poolAttachment, rareImageAttachment]
      : [poolAttachment];

    try {
      await message.edit({
        embeds: [finalEmbed],
        files: finalFiles,
      });
    } catch (editError) {
      console.error("Failed to edit starting pool message:", editError);
      // Swallow error, do not throw
    }

    console.log(`Successfully posted starting pool for user ${user.id}`);

    // Add pool change record if player found in database, but only if in the starting pool channel
    try {
      if (channel.id === CONFIG.STARTING_POOL_CHANNEL_ID) {
        const players = await getPlayers();
        const player = players.rows.find((p) => p.id === user.id);
        if (player && poolId !== "Error") {
          await addPoolChange(
            player.name,
            "starting pool",
            poolId,
            "SPM starting pool",
            poolId,
          );
          console.log(
            `Added starting pool record for ${player.name} (${poolId})`,
          );
        }
      }
    } catch (error) {
      console.error("Error adding pool change record:", error);
      // Don't throw - this shouldn't break the user experience
    }
  } catch (error) {
    console.error("Error generating and posting starting pool:", error);
    throw error;
  }
}
