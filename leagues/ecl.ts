import { Client, Interaction, Message, TextChannel } from "discord.js";
import { Handler } from "../dispatch.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../scryfall.ts";
import { choice, weightedChoice } from "../random.ts";
import { Buffer } from "node:buffer";
import * as djs from "discord.js";

/**
 * ECL (Lorwyn Eclipsed) League Setup
 */

// Pack structure: 1 rare/mythic (8:1), 3 uncommon, 11 common
async function generateTestPack(setCode: string): Promise<ScryfallCard[] | null> {
  const setCodeLower = setCode.toLowerCase();
  const baseQuery = `s:${setCodeLower} is:booster -t:basic`;
  
  const packCards: ScryfallCard[] = [];
  
  try {
    // Generate rare/mythic slot (8:1 ratio)
    const rareQuery = `${baseQuery} rarity:rare`;
    const mythicQuery = `${baseQuery} rarity:mythic`;
    
    let rares: ScryfallCard[];
    let mythics: ScryfallCard[];
    
    try {
      [rares, mythics] = await Promise.all([
        searchCards(rareQuery, { unique: "cards" }),
        searchCards(mythicQuery, { unique: "cards" }),
      ]);
    } catch (error) {
      // Check if it's a 404 (invalid set code) or empty result
      if (error instanceof Error && error.message.includes("404")) {
        throw new Error(`Invalid set code: ${setCode}. Please check the set code and try again.`);
      }
      throw error;
    }
    
    // Weight rares 8:1 over mythics
    const weightedRareMythic = [
      ...rares.map((card): [ScryfallCard, number] => [card, 8]),
      ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
    ];
    
    const rareMythicCard = weightedChoice(weightedRareMythic);
    if (!rareMythicCard) {
      console.error(`No rare/mythic cards found for set ${setCode}`);
      return null;
    }
    packCards.push(rareMythicCard);
    
    // Generate 3 uncommon slots
    const uncommonQuery = `${baseQuery} rarity:uncommon`;
    let uncommons: ScryfallCard[];
    try {
      uncommons = await searchCards(uncommonQuery, { unique: "cards" });
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        throw new Error(`Invalid set code: ${setCode}. Please check the set code and try again.`);
      }
      throw error;
    }
    
    for (let i = 0; i < 3; i++) {
      const uncommonCard = choice(uncommons);
      if (!uncommonCard) {
        console.error(`Not enough uncommon cards found for set ${setCode}`);
        return null;
      }
      packCards.push(uncommonCard);
    }
    
    // Generate 11 common slots
    const commonQuery = `${baseQuery} rarity:common`;
    let commons: ScryfallCard[];
    try {
      commons = await searchCards(commonQuery, { unique: "cards" });
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        throw new Error(`Invalid set code: ${setCode}. Please check the set code and try again.`);
      }
      throw error;
    }
    
    for (let i = 0; i < 11; i++) {
      const commonCard = choice(commons);
      if (!commonCard) {
        console.error(`Not enough common cards found for set ${setCode}`);
        return null;
      }
      packCards.push(commonCard);
    }
    
    return packCards;
  } catch (error) {
    console.error(`Error generating pack for set ${setCode}:`, error);
    // Re-throw error so caller can handle it appropriately
    throw error;
  }
}

const packCommandHandler: Handler<Message> = async (message, handle) => {
  // Only handle messages in guild channels
  if (!message.guild || !message.member) return;
  
  // Only handle text channels
  if (!message.channel.isTextBased() || message.channel.isDMBased()) return;
  const channel = message.channel as TextChannel;
  
  // Check for !pack command
  const content = message.content.trim();
  const packMatch = content.match(/^!pack\s+(\w+)$/i);
  if (!packMatch) return;
  
  handle.claim();
  
  const setCode = packMatch[1];
  
  // Show typing indicator
  await channel.sendTyping();
  
  try {
    const packCards = await generateTestPack(setCode);
    
    if (!packCards || packCards.length === 0) {
      await message.reply(`❌ Failed to generate pack for set \`${setCode}\`. Make sure the set code is valid and the set has booster cards.`);
      return;
    }
    
    // Generate pack image
    let packImageAttachment: djs.AttachmentBuilder | undefined;
    try {
      const packImageBlob = await tileCardImages(packCards, "small");
      const packImageBuffer = Buffer.from(await packImageBlob.arrayBuffer());
      packImageAttachment = new djs.AttachmentBuilder(packImageBuffer, {
        name: "pack.png",
        description: `Test pack from ${setCode}`,
      });
    } catch (error) {
      console.error("Failed to generate pack image:", error);
    }
    
    // Create embed
    const embed = new djs.EmbedBuilder()
      .setTitle(`📦 Test Pack - ${setCode.toUpperCase()}`)
      .setDescription(`Pack contents: ${packCards.length} cards`)
      .setColor(0x4A90E2)
      .addFields([
        {
          name: "📊 Breakdown",
          value: `1 Rare/Mythic (8:1 ratio)\n3 Uncommon\n11 Common`,
          inline: false,
        },
        {
          name: "🃏 Cards",
          value: packCards
            .map((card, index) => {
              const rarity = card.rarity === "mythic" ? "⭐" : card.rarity === "rare" ? "💎" : card.rarity === "uncommon" ? "🔷" : "⚪";
              return `${index + 1}. ${rarity} ${card.name}`;
            })
            .join("\n")
            .slice(0, 1024), // Discord field limit
          inline: false,
        },
      ])
      .setTimestamp();
    
    if (packImageAttachment) {
      embed.setImage("attachment://pack.png");
    }
    
    const files = packImageAttachment ? [packImageAttachment] : [];
    
    await message.reply({
      embeds: [embed],
      files,
    });
  } catch (error) {
    console.error("Error handling !pack command:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Provide user-friendly error messages
    if (errorMessage.includes("Invalid set code")) {
      await message.reply(`❌ ${errorMessage}`);
    } else if (errorMessage.includes("404")) {
      await message.reply(`❌ Invalid set code: \`${setCode}\`. Please check the set code and try again.`);
    } else {
      await message.reply(`❌ An error occurred while generating the pack: ${errorMessage}`);
    }
  }
};

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: () => Promise.resolve(),
    messageHandlers: [packCommandHandler],
    interactionHandlers: [],
  });
}
