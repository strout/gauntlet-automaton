import { Message, TextChannel, AttachmentBuilder } from "discord.js";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import { Buffer } from "node:buffer";
import { choice, weightedChoice } from "../../random.ts";
import { makeSealedDeck } from "../../sealeddeck.ts";
import { delay } from "@std/async";

const ECL_BASE_POOL_SEARCH = "set:ecl -type:basic";

/**
 * Rolls a starting Lorwyn pool
 * @returns The starting pool cards
 */
export async function rollLorwynPool(): Promise<ScryfallCard[]> {
  const pool: ScryfallCard[] = [];

  try {
    // Get all Lorwyn cards by rarity
    const [rares, mythics, uncommons, commons] = await Promise.all([
      searchCards(`${ECL_BASE_POOL_SEARCH} rarity:rare`, {
        unique: "cards",
      }),
      searchCards(`${ECL_BASE_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${ECL_BASE_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${ECL_BASE_POOL_SEARCH} rarity:common`, {
        unique: "cards",
      }),
    ]);

    // Pre-calculate weight mappings for rare/mythic (7:1 ratio - rares appear 7 times as often as mythics)
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

    // Roll 60 commons in 6 batches of 10, ensuring no duplicates per batch
    for (let batch = 0; batch < 6; batch++) {
      const batchCommons: ScryfallCard[] = [];
      const usedInBatch = new Set<string>();

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
        }
      }

      pool.push(...batchCommons);
    }

    return pool;
  } catch (error) {
    console.error("Error rolling initial Lorwyn pool:", error);
    return [];
  }
}

/**
 * Generates and posts a Lorwyn pool to the channel
 */
export async function generateAndPostLorwynPool(
  discordId: string,
  channel: TextChannel,
  replyTo: Message,
): Promise<void> {
  try {
    console.log(`Generating Lorwyn pool for Discord ID ${discordId}...`);

    // Show typing indicator
    await channel.sendTyping();

    // Roll the starting pool
    const pool = await rollLorwynPool();
    if (pool.length === 0) {
      throw new Error("Failed to generate Lorwyn pool");
    }

    // Find rare/mythic cards for preview
    const rareMythicCards = pool.filter(
      (card) => card.rarity === "rare" || card.rarity === "mythic",
    );

    // Generate SealedDeck and rare card image in background (concurrent)
    console.log("Creating SealedDeck.tech pool and rare card image...");
    const [sealedDeckResult, rareImageResult] = await Promise.allSettled([
      makeSealedDeck({
        sideboard: pool.map((card) => ({
          name: card.name,
          count: 1,
          set: card.set,
        })),
      }),
      tileCardImages(rareMythicCards, "small"),
    ]);

    // Handle SealedDeck result
    let poolId: string;
    let poolLink: string;
    if (sealedDeckResult.status === "fulfilled") {
      poolId = sealedDeckResult.value;
      poolLink = `https://sealeddeck.tech/${poolId}`;
    } else {
      console.error("SealedDeck generation failed:", sealedDeckResult.reason);
      poolId = "Error";
      poolLink = "Failed to generate";
    }

    // Handle rare image result
    let rareImageAttachment: AttachmentBuilder | undefined;
    if (rareImageResult.status === "fulfilled") {
      const rareImageBuffer = Buffer.from(
        await rareImageResult.value.arrayBuffer(),
      );
      rareImageAttachment = new AttachmentBuilder(rareImageBuffer, {
        name: "rares.png",
        description: "Rare and mythic cards from starting pool",
      });
    } else {
      console.error("Rare image generation failed:", rareImageResult.reason);
    }

    // Create response message
    const response = `**Lorwyn Pool for <@${discordId}>**\n\n${poolLink}`;

    await replyTo.reply({
      content: response,
      files: rareImageAttachment ? [rareImageAttachment] : [],
    });

    console.log(`Successfully generated and posted Lorwyn pool for Discord ID ${discordId}`);

    // Wait 1 second, then send Booster Tutor command
    await delay(1000);
    await channel.send(`!pool TDM|EOE|DSK|BLB|FDN|DFT <@${discordId}>`);
    console.log(`Sent Booster Tutor command for Discord ID ${discordId}`);
  } catch (error) {
    console.error(`Error generating Lorwyn pool for Discord ID ${discordId}:`, error);
    throw error;
  }
}
