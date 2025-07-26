import * as djs from "discord.js";
import { BoosterSlot, FINPlayerState } from "./state.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../scryfall.ts";
import { formatPool, makeSealedDeck } from "../sealeddeck.ts";
import { addPoolChange, getPoolChanges } from "../standings.ts";
import { choice, weightedChoice } from "../random.ts";
import { CONFIG } from "../main.ts";
import { Buffer } from "node:buffer";

const BASE_SEARCH = 'in:paper game:arena (-is:meld or fo:"melds with") -t:basic';

export async function generateAndSendPack(
  client: djs.Client,
  state: FINPlayerState,
  levelUpData: { stat: string; level: number },
) {
  try {
    console.log(
      `Generating pack for ${state.playerName}: ${levelUpData.stat} Level ${levelUpData.level}`,
    );

    // Generate cards based on booster slots
    const packCards: ScryfallCard[] = [];
    const sealedDeckCards: Array<{ name: string; count: number }> = [];

    for (const slot of state.boosterSlots) {
      const cardResult = await generateCardForSlot(slot);
      if (cardResult) {
        packCards.push(cardResult.card);
        sealedDeckCards.push({ name: cardResult.name, count: 1 });
        console.log(`${state.playerName} generated card for slot:`, slot, `-> ${cardResult.name}`);
      } else {
        console.warn(`${state.playerName} failed to generate card for slot:`, slot);
      }
    }

    console.log(`Total cards generated: ${sealedDeckCards.length}`);

    // Get player's current pool ID from pool changes
    const poolChanges = await getPoolChanges();
    const playerChanges = poolChanges.filter((change) =>
      change.name === state.playerName
    );
    const currentPoolId = playerChanges.findLast((change) => change.fullPool)
      ?.fullPool;

    // Create new combined pool by adding pack to current pool
    const newPoolId = await makeSealedDeck(
      { sideboard: sealedDeckCards },
      currentPoolId,
    );
    console.log(`Created new combined pool: ${newPoolId}`);

    // Create pack-only pool for tracking
    const packPoolId = await makeSealedDeck({ sideboard: sealedDeckCards });
    console.log(`Created pack SealedDeck: ${packPoolId}`);

    // Add pool change record
    await addPoolChange(
      state.playerName,
      "add pack",
      packPoolId,
      `${levelUpData.stat}: ${levelUpData.level}`,
      newPoolId, // The new combined pool ID
    );
    console.log(`Added pool change record`);

    // Generate pack card image
    let packImageAttachment: djs.AttachmentBuilder | undefined;
    try {
      const packImageBlob = await tileCardImages(packCards, "small");
      const packImageBuffer = Buffer.from(await packImageBlob.arrayBuffer());
      packImageAttachment = new djs.AttachmentBuilder(packImageBuffer, {
        name: "pack.png",
        description: "Cards from the FIN pack",
      });
    } catch (error) {
      console.error("Failed to generate pack image:", error);
    }

    // Create embed with player stats and pack info
    const embed = new djs.EmbedBuilder()
      .setTitle(`<:FIN:1379544128852983910> Level Up - ${state.playerName}`)
      .setDescription(formatPool({ sideboard: sealedDeckCards }))
      .setColor(0xFF6B35)
      .addFields([
        {
          name: "📊 Current Stats",
          value: Object.entries(state.stats)
            .map(([stat, level]) =>
              `${getStatEmoji(stat)} ${stat}: ${level}${
                stat === levelUpData.stat ? " ⬆️" : ""
              }`
            )
            .join("\n"),
          inline: false,
        },
        {
          name: "🔗 New Pool",
          value: `[Combined Pool](https://sealeddeck.tech/${newPoolId})`,
          inline: true,
        },
        {
          name: "✨ New Cards",
          value: `[Pack Contents](https://sealeddeck.tech/${packPoolId})`,
          inline: true,
        },
      ])
      .setTimestamp();

    // Set pack image if available
    if (packImageAttachment) {
      embed.setImage("attachment://pack.png");
    }

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);

    const channel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel;

    const files = packImageAttachment ? [packImageAttachment] : [];

    await channel.send({
      content: `<@${state.userId}> Leveled Up!`,
      embeds: [embed],
      files,
    });
    console.log(`Sent pack announcement to pack generation channel`);
  } catch (error) {
    console.error("Error generating FIN pack:", error);
    throw error; // Re-throw so the caller knows it failed
  }
}

async function generateCardForSlot(
  slot: BoosterSlot,
): Promise<{ card: ScryfallCard; name: string } | null> {
  try {
    const queryParts = [BASE_SEARCH];

    if (!slot.special) {
      queryParts.push("is:booster");
    }

    // Build Scryfall query based on slot
    if (slot.set) {
      queryParts.push(`set:${slot.set}`, `is:booster`);
    }

    // Filter by color (color:C is valid for colorless)
    if (slot.color) {
      queryParts.push(`color:${slot.color}`);
    }

    // Special handling for Level 3 special slots
    if (slot.special) {
      switch (slot.special) {
        case "HP":
          // SAGA slot
          queryParts.push("type:saga", "rarity<rare", "-set:FIN");
          break;
        case "Magic":
          // BIG SPELL slot
          queryParts.push(
            "legal:standard",
            "-is:permanent",
            "-is:split",
            "mv>3",
            "rarity<rare",
            "-set:FIN",
          );
          break;
        case "Evasion":
          // SURVEIL slot
          queryParts.push(
            "legal:standard",
            "keyword:surveil",
            "rarity<rare",
            "-set:FIN",
          );
          break;
        case "Speed":
          // EQUIPMENT slot
          queryParts.push(
            "legal:standard",
            "type:equipment",
            "-type:battle",
            "rarity:uncommon",
            "-set:FIN",
          );
          break;
        case "Strength":
          // TOWN slot
          queryParts.push("rarity<rare", "type:town");
          break;
        default:
          slot.special satisfies never;
      }
    }

    if (slot.rarity === "rare/mythic") {
      // Handle rare/mythic slots with proper weighting
      const rareQuery = [...queryParts, "rarity:rare"].join(" ");
      const mythicQuery = [...queryParts, "rarity:mythic"].join(" ");

      const [rares, mythics] = await Promise.all([
        searchCards(rareQuery, { unique: "cards" }),
        searchCards(mythicQuery, { unique: "cards" }),
      ]);

      // Weight rares 2:1 over mythics to mimic print runs
      const weightedCards = [
        ...rares.map((card): [ScryfallCard, number] => [card, 2]),
        ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
      ];

      const selectedCard = weightedChoice(weightedCards);
      return selectedCard
        ? { card: selectedCard, name: selectedCard.name }
        : null;
    } else {
      if (slot.rarity) {
        queryParts.push(`rarity:${slot.rarity}`);
      }
      const query = queryParts.join(" ");

      const cards = await searchCards(query, { unique: "cards" });

      console.log(cards.length, "cards found for query:", query);
      
      // Apply color weighting if this is a color-locked slot
      if (slot.color) {
        const weightedCards = cards.map((card): [ScryfallCard, number] => {
          const colorCount = card.card_faces?.[0]?.colors?.length ?? card.colors?.length ?? 0;
          if (!card.colors && !card.card_faces?.[0]?.colors) {
            console.log(
              `Card ${card.name} has no colors, treating as colorless`,);
          }
          // Single-color or colorless cards get full weight, multicolor cards get 1/colorCount weight
          const weight = colorCount <= 1 ? 1 : 1 / colorCount;
          return [card, weight];
        });
        
        const selectedCard = weightedChoice(weightedCards);
        return selectedCard
          ? { card: selectedCard, name: selectedCard.name }
          : null;
      } else {
        const selectedCard = choice(cards);
        return selectedCard
          ? { card: selectedCard, name: selectedCard.name }
          : null;
      }
    }
  } catch (error) {
    console.error("Error fetching card for slot:", slot, error);
    return null;
  }
}

// Helper function to get stat emojis (moved from upgrades.ts for reuse)
function getStatEmoji(stat: string): string {
  const STAT_EMOJIS: Record<string, string> = {
    "HP": "❤️",
    "Magic": "🔮",
    "Evasion": "💨",
    "Speed": "⚡",
    "Strength": "💪",
  };
  return STAT_EMOJIS[stat] || "⭐";
}
