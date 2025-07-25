import * as djs from "discord.js";
import { ScryfallCard, searchCards, tileRareImages } from "../scryfall.ts";
import { makeSealedDeck } from "../sealeddeck.ts";
import { addPoolChange, getPlayers } from "../standings.ts";
import { Buffer } from "node:buffer";
import { choice, weightedChoice } from "../random.ts";
import { CONFIG } from "../main.ts";

const BASE_POOL_SEARCH =
  'in:paper in:arena is:booster set:FIN (-is:meld or fo:"melds with") -type:basic';

/**
 * Rolls a starting FIN pool for a new player
 * @returns The starting pool cards
 */
export async function rollStartingPool(): Promise<ScryfallCard[]> {
  const pool: ScryfallCard[] = [];

  try {
    // Get all FIN cards by rarity
    const [rares, mythics, uncommons, commons] = await Promise.all([
      searchCards(`${BASE_POOL_SEARCH} rarity:rare`, {
        unique: "cards",
      }),
      searchCards(`${BASE_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${BASE_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${BASE_POOL_SEARCH} rarity:common`, {
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

    // Roll 18 uncommons
    for (let i = 0; i < 18; i++) {
      const randomCard = choice(uncommons);
      if (randomCard) pool.push(randomCard);
    }

    // Separate commons by color for validation
    const colors = ["W", "U", "B", "R", "G"] as const;

    // Pre-calculate weight mappings for commons (Town subtype gets reduced weight)
    const commonWeights: [ScryfallCard, number][] = commons.map((
      card,
    ): [ScryfallCard, number] => [
      card,
      card.type_line?.match(/\bTown\b/) ? 0.595 : 1,
    ]);

    // Generate 60 commons with color requirements
    let poolCommons: ScryfallCard[];
    let meetsRequirement: boolean;

    do {
      poolCommons = [];

      // Roll 60 commons randomly with Town subtype weighting
      for (let i = 0; i < 60; i++) {
        const randomCard = weightedChoice(commonWeights);
        if (randomCard) poolCommons.push(randomCard);
      }

      // Check if we have at least 6 of each WUBRG color
      const colorCounts: Record<string, number> = {
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
      };

      for (const card of poolCommons) {
        if (card.colors) {
          for (const color of card.colors) {
            if (color in colorCounts) {
              colorCounts[color]++;
            }
          }
        }
      }

      // Check if all colors have at least 6 cards
      meetsRequirement = colors.every((color) => colorCounts[color] >= 6);
    } while (!meetsRequirement);

    pool.push(...poolCommons);

    return pool;
  } catch (error) {
    console.error("Error rolling initial FIN pool:", error);
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
 * Generates and posts a starting FIN pool for a user
 * @param user - Discord User object
 * @param channel - Discord TextChannel to post in
 */
export async function generateAndPostStartingPool(
  user: djs.User | djs.GuildMember,
  channel: djs.TextChannel,
  replyTo?: djs.Message,
): Promise<void> {
  try {
    console.log(`Generating starting FIN pool for user ${user.id}...`);

    // Show typing indicator
    await channel.sendTyping();

    // Roll the starting pool
    const pool = await rollStartingPool();
    if (pool.length === 0) {
      throw new Error("Failed to generate starting pool");
    }

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
      description: "Complete FIN starting pool card list",
    });

    // Try to get a guild display name if there is one
    if (!(user instanceof djs.GuildMember)) {
      user = await channel.guild.members.fetch(user.id).catch(() => user);
    }

    // Post initial message with placeholder content
    const initialEmbed = new djs.EmbedBuilder()
      .setTitle(
        `<:FIN:1379544128852983910> FIN Starting Pool - ${user.displayName}`,
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

    // Generate SealedDeck and rare card image in background
    console.log("Creating SealedDeck.tech pool and rare card image...");
    const [sealedDeckResult, rareImageResult] = await Promise.allSettled([
      makeSealedDeck({
        sideboard: pool.map((card) => ({
          name: card.name,
          count: 1,
          set: card.set,
        })),
      }),
      tileRareImages(pool, "small"),
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
        `<:FIN:1379544128852983910> FIN Starting Pool - ${user.displayName}`,
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

    const finalFiles = [poolAttachment];
    if (rareImageAttachment) {
      finalFiles.push(rareImageAttachment);
    }

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
        const player = players.find((p) => p.id === user.id);
        if (player && poolId !== "Error") {
          await addPoolChange(
            player.name,
            "starting pool",
            poolId,
            "FIN starting pool",
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
