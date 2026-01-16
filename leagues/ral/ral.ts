import {
  Client,
  Interaction,
  Message,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  MessageFlags,
  TextChannel,
  GuildMember,
  DiscordAPIError,
  AttachmentBuilder,
} from "discord.js";
import { Buffer } from "node:buffer";
import { Handler } from "../../dispatch.ts";
import { CONFIG } from "../../config.ts";
import { searchCards, fetchCardImage } from "../../scryfall.ts";
import { getAllMatches, getPlayers, ROWNUM, addPoolChange, getPoolChanges, MATCHTYPE } from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  getPlayerChosenEvents,
  getMostRecentChosenEvent,
  getMostRecentEventSentWithoutChoice,
  getMostRecentLossEventChosen,
  recordCyoaMessageSent,
  updateCyoaEntryChoice,
  getPlayerCyoaHistory,
} from "./cyoa_sheet.ts";
import { Event, EventId, START_EVENT, COMPLETED_EVENT } from "./cyoa_types.ts";
import { onLossEvents, onWinEvents } from "./cyoa_data.ts";
import { z } from "zod";
import { makeSealedDeck, fetchSealedDeck, SealedDeckEntry, SealedDeckPool } from "../../sealeddeck.ts";
import { waitForBoosterTutor } from "../../pending.ts";

import { delay } from "@std/async";

// Helper to extract query from Scryfall URL or handle card URLs
function extractQueryFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    
    // Check if it's a direct card URL (e.g., /card/rna/257/...)
    const pathMatch = urlObj.pathname.match(/\/card\/([a-z0-9]+)\/(\d+)/);
    if (pathMatch) {
      const set = pathMatch[1];
      const number = pathMatch[2];
      // Return a search query for this specific card
      return `set:${set} number:${number}`;
    }
    
    // Otherwise, extract the q parameter from search URLs
    const query = urlObj.searchParams.get("q");
    return query || null;
  } catch {
    // If it's not a full URL, assume it's already a query
    return url;
  }
}

// Get event by ID
function getEventById(eventId: EventId, isWin: boolean): Event | undefined {
  const events = isWin ? onWinEvents : onLossEvents;
  return events.find((e) => e.id === eventId);
}

// Select an appropriate win event based on player's loss count, excluding events they've already received
async function selectWinEvent(lossCount: number, discordId: string): Promise<EventId | null> {
  // Get the player's CYOA history to find which win events they've already received
  const history = await getPlayerCyoaHistory(discordId);
  const receivedWinEvents = new Set(
    history
      .filter((entry) => entry.matchResult === "win" && entry.event)
      .map((entry) => entry.event)
  );

  // If player has 0-2 losses, randomly select from guild bonus events
  if (lossCount >= 0 && lossCount <= 2) {
    const guildBonusEvents = [
      "ON_WIN_EVENTS.SIMIC_BONUS",
      "ON_WIN_EVENTS.AZORIUS_BONUS",
      "ON_WIN_EVENTS.IZZET_BONUS",
      "ON_WIN_EVENTS.DIMIR_BONUS",
      "ON_WIN_EVENTS.GRUUL_BONUS",
      "ON_WIN_EVENTS.GOLGARI_BONUS",
      "ON_WIN_EVENTS.SELESNYA_BONUS",
      "ON_WIN_EVENTS.BOROS_BONUS",
      "ON_WIN_EVENTS.RAKDOS_BONUS",
      "ON_WIN_EVENTS.ORZHOV_BONUS",
    ];
    
    // Filter out events the player has already received
    const availableEvents = guildBonusEvents.filter((eventId) => !receivedWinEvents.has(eventId));
    
    if (availableEvents.length === 0) {
      console.warn(`[CYOA] Player ${discordId} has received all guild bonus events, no more available`);
      return null;
    }
    
    return availableEvents[Math.floor(Math.random() * availableEvents.length)];
  }

  // If player has 3-5 losses, randomly select from RAV_* or BOLAS_* events
  if (lossCount >= 3 && lossCount <= 5) {
    const ravBolasEvents = [
      "ON_WIN_EVENTS.RAV_FLY_TRAMPLE",
      "ON_WIN_EVENTS.RAV_COUNTER_PROLIF",
      "ON_WIN_EVENTS.RAV_HASTE_VIG",
      "ON_WIN_EVENTS.RAV_SMALL_LARGE",
      "ON_WIN_EVENTS.RAV_ARTIFACT_ENCHANTMENT",
      "ON_WIN_EVENTS.BOLAS_CHEAP_EXPENSIVE",
      "ON_WIN_EVENTS.BOLAS_ZOMBIE_AMASS",
      "ON_WIN_EVENTS.BOLAS_HUMAN_NONHUMAN",
      "ON_WIN_EVENTS.BOLAS_HIGH_LOW_POWER",
      "ON_WIN_EVENTS.BOLAS_INSTANT_SORCERY",
    ];
    
    // Filter out events the player has already received
    const availableEvents = ravBolasEvents.filter((eventId) => !receivedWinEvents.has(eventId));
    
    if (availableEvents.length === 0) {
      console.warn(`[CYOA] Player ${discordId} has received all RAV/BOLAS events, no more available`);
      return null;
    }
    
    return availableEvents[Math.floor(Math.random() * availableEvents.length)];
  }

  return null;
}

// Filter options based on requiredSelections
function filterOptions(
  options: Event["options"],
  playerChosenEvents: string[],
): Event["options"] {
  return options.filter((option) => {
    if (option.requiredSelections.length === 0) return true;
    return option.requiredSelections.every((req) =>
      playerChosenEvents.includes(String(req))
    );
  });
}

// Give rewards to player and compile query-based cards into a sealeddeck.tech link
async function giveRewards(
  client: Client,
  userId: string,
  rewards: Array<{ count: "PACK" | number; sets?: string[]; query?: string }>,
): Promise<string> {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const packgenChannel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as TextChannel | null;

  // Get player Identification for Pool Changes
  const playerIdentification = await getPlayerIdentification(userId);
  if (!playerIdentification) {
    console.warn(`Could not find player Identification for userId ${userId}`);
    return "Error: Could not find player information.";
  }

  // Get the last pool change to get the current Full Pool
  const poolChanges = await getPoolChanges();
  const lastChange = poolChanges.rows.findLast((change) =>
    change["Name"] === playerIdentification
  );
  let currentFullPoolId = lastChange?.["Full Pool"] ?? undefined;

  const allCards: Array<{ name: string; count: number; set?: string }> = [];
  const packMessages: string[] = [];

  // Process all rewards
  for (const reward of rewards) {
    if (reward.count === "PACK") {
      // Request pack generation and wait for response
      if (packgenChannel) {
        const sets = reward.sets || [];
        if (sets.length === 0) {
          console.warn("PACK reward has no sets specified");
          continue;
        }
        
        // If multiple sets are provided, randomly select one
        const selectedSet = sets.length > 1 
          ? sets[Math.floor(Math.random() * sets.length)]
          : sets[0];
        
        const packMessage = packgenChannel.send(`!${selectedSet} <@${userId}>`);
        const packResult = await waitForBoosterTutor(packMessage);
        
        if ("error" in packResult) {
          console.error(`Error generating ${selectedSet} pack: ${packResult.error}`);
          packMessages.push(`Error generating ${selectedSet} pack`);
        } else {
          const packId = packResult.success.poolId;
          packMessages.push(`Received ${selectedSet} pack: https://sealeddeck.tech/${packId}`);
          
          // Fetch pack contents and update Full Pool
          const packContents = await fetchSealedDeck(packId);
          const newFullPoolId = await makeSealedDeck(
            packContents,
            currentFullPoolId,
          );
          
          // Record pack to Pool Changes with updated Full Pool
          await addPoolChange(
            playerIdentification,
            "add pack",
            packId,
            `CYOA reward - ${selectedSet} pack`,
            newFullPoolId,
          );
          
          // Update current Full Pool for next iteration
          currentFullPoolId = newFullPoolId;
          
          // Add delay between writes to avoid overwhelming the sheet
          await delay(500);
        }
      }
    } else {
      // Query-based card reward (count is a number)
      if (typeof reward.count !== "number") {
        console.warn(`Query-based reward has invalid count type:`, reward);
        continue;
      }
      if (!reward.query) {
        console.warn(`Reward has no query:`, reward);
        continue;
      }
      // Get cards from Scryfall query
      const query = extractQueryFromUrl(reward.query);
      if (!query) {
        console.warn(`Could not extract query from URL: ${reward.query}`);
        continue;
      }
      
      try {
        const cards = await searchCards(query);
        if (cards.length === 0) {
          console.warn(`Query returned no cards: ${query}`);
          continue;
        }
        
        // Randomly select cards from the query results based on reward.count
        const selectedCards: Array<typeof cards[number]> = [];
        const availableCards = [...cards]; // Copy array for random selection
        const countToSelect = Math.min(reward.count, availableCards.length); // Don't request more than available
        
        for (let i = 0; i < countToSelect; i++) {
          const randomIndex = Math.floor(Math.random() * availableCards.length);
          selectedCards.push(availableCards[randomIndex]);
          availableCards.splice(randomIndex, 1); // Remove selected card to avoid duplicates
        }
        
        // Add selected cards to our collection
        for (const card of selectedCards) {
          const existingIndex = allCards.findIndex(c => c.name === card.name && (!card.set || c.set === card.set));
          if (existingIndex >= 0) {
            allCards[existingIndex] = {
              ...allCards[existingIndex],
              count: allCards[existingIndex].count + 1,
            };
          } else {
            allCards.push({ 
              name: card.name, 
              count: 1, 
              set: card.set || undefined 
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching cards from query ${query}:`, error);
      }
    }
  }

  // Compile all cards into a single sealeddeck.tech link and record to Pool Changes
  let cardsPoolId: string | undefined;
  if (allCards.length > 0) {
    // Create a single sealeddeck.tech link for all cards
    cardsPoolId = await makeSealedDeck({
      sideboard: allCards as SealedDeckEntry[],
    });
    const cardsPoolContents = await fetchSealedDeck(cardsPoolId);
    
    // Combine with current Full Pool
    const newFullPoolId = await makeSealedDeck(
      cardsPoolContents,
      currentFullPoolId,
    );
    
    // Record as a single entry with the pool ID (not the full URL)
    await addPoolChange(
      playerIdentification,
      "add card",
      cardsPoolId,
      "CYOA reward",
      newFullPoolId,
    );
  }

  // Build reward message
  const messages: string[] = [];
  
  // Add pack messages
  if (packMessages.length > 0) {
    messages.push(...packMessages);
  }
  
  // Add sealeddeck.tech link for query-based cards
  if (cardsPoolId) {
    const sealedDeckLink = `https://sealeddeck.tech/${cardsPoolId}`;
    messages.push(`Your card rewards: ${sealedDeckLink}`);
    
    // Also post the link in the packgen channel
    if (packgenChannel) {
      await packgenChannel.send(`<@${userId}> found something on their adventure: ${sealedDeckLink}`);
    }
  }

  return messages.length > 0 ? messages.join("\n") : "No rewards to give.";
}

// Send event message with buttons
// Returns true if message was sent successfully, false if DM failed (e.g., user has DMs disabled)
async function sendEventMessage(
  client: Client,
  userId: string,
  eventId: EventId,
  isWin: boolean,
  playerChosenEvents: string[],
): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    const dmChannel = await member.createDM();

    const event = getEventById(eventId, isWin);
    if (!event) {
      await dmChannel.send("Event not found.");
      return false;
    }

    const availableOptions = filterOptions(event.options, playerChosenEvents);

    if (availableOptions.length === 0) {
      await dmChannel.send("No options available for this event.");
      return false;
    }

    // Create buttons for each option (max 5 buttons per row, max 5 rows = 25 buttons total)
    const buttonRows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();

    for (let idx = 0; idx < availableOptions.length; idx++) {
      const option = availableOptions[idx];
      // Provide default label for empty labels (defensive fallback)
      const label = option.optionLabel || `Option ${idx + 1}`;
      
      const button = new ButtonBuilder()
        .setCustomId(`RAL_CYOA:${eventId}:${idx}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);

      currentRow.addComponents(button);

      // Discord allows max 5 buttons per row
      if (currentRow.components.length >= 5 || idx === availableOptions.length - 1) {
        buttonRows.push(currentRow);
        if (idx < availableOptions.length - 1) {
          currentRow = new ActionRowBuilder<ButtonBuilder>();
        }
      }
    }

    const content = event.mainText || "Choose your path:";
    await dmChannel.send({
      content,
      components: buttonRows,
    });

    // Record that the event was sent (Event column filled, Next Event column empty)
    const playerIdentification = await getPlayerIdentification(userId);
    if (playerIdentification) {
      await recordCyoaMessageSent(playerIdentification, userId, String(eventId));
    }
    
    return true;
  } catch (error) {
    // Handle Discord API error 50007: Cannot send messages to this user
    // This happens when the user has DMs disabled or has blocked the bot
    if (error instanceof DiscordAPIError && error.code === 50007) {
      const playerIdentification = await getPlayerIdentification(userId);
      console.warn(
        `[CYOA] Cannot send DM to user ${userId}${playerIdentification ? ` (${playerIdentification})` : ""} - user has DMs disabled or has blocked the bot`
      );
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

// Handle button interaction
async function handleCyoaButton(
  interaction: Interaction,
): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("RAL_CYOA:")) return;

  const customId = interaction.customId;
  const parts = customId.split(":");
  if (parts.length !== 3) return;

  const eventIdStr = parts[1];
  const optionIdxStr = parts[2];
  const eventId: EventId = eventIdStr;
  const optionIdx = parseInt(optionIdxStr, 10);

  if (isNaN(optionIdx)) return;

  // Disable all buttons immediately to prevent duplicate clicks
  const message = interaction.message;
  const disabledRows: ActionRowBuilder<ButtonBuilder>[] = [];
  
  if (message && "components" in message && message.components) {
    for (const row of message.components) {
      if ("components" in row && Array.isArray(row.components)) {
        const actionRow = new ActionRowBuilder<ButtonBuilder>();
        for (const component of row.components) {
          if ("type" in component && component.type === 2) {
            actionRow.addComponents(
              ButtonBuilder.from(component.toJSON()).setDisabled(true)
            );
          }
        }
        if (actionRow.components.length > 0) {
          disabledRows.push(actionRow);
        }
      }
    }
  }

  // Update the message to disable all buttons immediately and acknowledge the interaction
  if (disabledRows.length > 0) {
    try {
      await interaction.update({
        components: disabledRows,
      });
    } catch (error) {
      console.error("Error updating interaction:", error);
      // Fallback to deferUpdate if update fails
      await interaction.deferUpdate();
    }
  } else {
    // Fallback if we couldn't build disabled rows
    await interaction.deferUpdate();
  }

  const userId = interaction.user.id;
  
  // Determine if this is a win or loss event based on the event ID
  const isWin = String(eventId).startsWith("ON_WIN_EVENTS.");

  // Get player's chosen events to filter options correctly
  const playerChosenEvents = await getPlayerChosenEvents(userId);

  const event = getEventById(eventId, isWin);
  if (!event) {
    await interaction.followUp({ content: "Event not found.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Filter options the same way we did when sending the message
  const availableOptions = filterOptions(event.options, playerChosenEvents);

  if (optionIdx < 0 || optionIdx >= availableOptions.length) {
    await interaction.followUp({ content: "Invalid option selected.", flags: MessageFlags.Ephemeral });
    return;
  }

  const option = availableOptions[optionIdx];
  const guild = await interaction.client.guilds.fetch(CONFIG.GUILD_ID);
  const member = await guild.members.fetch(userId);

  if (!member) {
    await interaction.followUp({ content: "Could not find your user information.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    // Get player Identification from Player Database
    const playerIdentification = await getPlayerIdentification(userId);
    if (!playerIdentification) {
      await interaction.followUp({ content: "Could not find your player information in the database.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Find the most recent event that was sent but doesn't have a choice yet
    const eventSent = await getMostRecentEventSentWithoutChoice(userId);
    if (!eventSent) {
      await interaction.followUp({ content: "Could not find the event entry to update. Please contact an administrator.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Verify that the event ID matches what we expect
    if (eventSent.eventId !== String(eventId)) {
      console.warn(`[CYOA] Event ID mismatch: expected ${eventId}, found ${eventSent.eventId} for user ${userId}`);
      await interaction.followUp({ content: "Event ID mismatch. Please contact an administrator.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Update the existing row with the player's choice
    // Column D (Match Result): win or loss
    // Column G (Next Event): The next event ID
    // For win events with no nextEvent, use the most recent loss event's Next Event
    // If player has 5 losses, use COMPLETED_EVENT as terminal event
    // If no previous loss events, use START_EVENT
    let eventChosen = String(option.nextEvent || "");
    
    if (isWin && !option.nextEvent) {
      // Get player's loss count to check if they have 5 losses
      const playersData = await getRalPlayers();
      const player = playersData.rows.find((p) => p["Discord ID"] === userId);
      const lossCount = player?.Losses ?? 0;
      
      if (lossCount >= 5) {
        // Player has 5 losses - use COMPLETED_EVENT as terminal event
        eventChosen = String(COMPLETED_EVENT);
      } else {
        // Win event with no nextEvent - use the most recent loss event's Next Event
        const mostRecentLossEventChosen = await getMostRecentLossEventChosen(userId);
        if (mostRecentLossEventChosen) {
          eventChosen = mostRecentLossEventChosen;
        } else {
          // If no recent loss event found, use START_EVENT
          eventChosen = String(START_EVENT);
        }
      }
    }
    await updateCyoaEntryChoice(
      eventSent.rowNum,
      isWin ? "win" : "loss", // Match result based on event type
      eventChosen, // Column G: Next Event - the next event ID (or most recent loss event for win events with no nextEvent)
    );

    // Separate PACK_CHOICE rewards from regular rewards
    const packChoiceRewards = option.rewards.filter((r) => r.count === "PACK_CHOICE");
    const regularRewards = option.rewards.filter((r) => r.count !== "PACK_CHOICE") as Array<{ count: "PACK" | number; sets?: string[]; query?: string }>;

    let rewardMessage = "";
    
    // Give regular rewards (cards, regular packs, etc.)
    if (regularRewards.length > 0) {
      rewardMessage = await giveRewards(
        interaction.client,
        userId,
        regularRewards,
      );
    }

    // Handle pack choice rewards (pick 1 of 2 packs)
    if (packChoiceRewards.length > 0) {
      // There should only be one PACK_CHOICE reward
      const packChoice = packChoiceRewards[0];
      const sets = packChoice.sets || ["RNA", "GRN"]; // Default to RNA/GRN if not specified
      
      // Build the reward message for the pack choice
      const rewardText = regularRewards.length > 0 ? `\n\n${rewardMessage}` : "";
      await initiatePackChoice(interaction.client, userId, member, `${option.postSelectionText}${rewardText}`, sets);
    } else if (regularRewards.length > 0) {
      // No pack choice, just send regular rewards
      try {
        const dmChannel = await member.createDM();
        await dmChannel.send(`${option.postSelectionText}\n\n${rewardMessage}`);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50007) {
          console.warn(`[CYOA] Cannot send DM to user ${userId} - user has DMs disabled or has blocked the bot`);
          await interaction.followUp({ 
            content: "I tried to send you a DM with your rewards, but I couldn't reach you. Please check your Discord privacy settings to allow DMs from server members.", 
            flags: MessageFlags.Ephemeral 
          });
        } else {
          throw error;
        }
      }
    } else {
      // No rewards at all, just send postSelectionText
      try {
        const dmChannel = await member.createDM();
        await dmChannel.send(option.postSelectionText);
      } catch (error) {
        if (error instanceof DiscordAPIError && error.code === 50007) {
          console.warn(`[CYOA] Cannot send DM to user ${userId} - user has DMs disabled or has blocked the bot`);
          await interaction.followUp({ 
            content: "I tried to send you a DM, but I couldn't reach you. Please check your Discord privacy settings to allow DMs from server members.", 
            flags: MessageFlags.Ephemeral 
          });
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    console.error("Error processing CYOA choice:", error);
    try {
      await interaction.followUp({ content: "An error occurred processing your choice.", flags: MessageFlags.Ephemeral });
    } catch (followUpError) {
      console.error("Error sending error message:", followUpError);
    }
  }
}

// Store pending pack choices (userId -> { set1Pack, set2Pack, set1, set2, messageId })
const pendingPackChoices = new Map<string, { set1Pack: SealedDeckPool; set2Pack: SealedDeckPool; set1: string; set2: string; messageId: string }>();

// Initiate pack choice (pick 1 of 2 packs from the provided sets)
async function initiatePackChoice(
  client: Client,
  userId: string,
  member: GuildMember,
  postSelectionText: string,
  sets: string[] = ["RNA", "GRN"],
): Promise<void> {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const packgenChannel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as TextChannel | null;
  const botBunkerChannel = await guild.channels.fetch(CONFIG.BOT_BUNKER_CHANNEL_ID) as TextChannel | null;

  if (!packgenChannel || !botBunkerChannel) {
    const error = new Error(`Packgen or bot bunker channel not found. Packgen: ${!!packgenChannel}, BotBunker: ${!!botBunkerChannel}`);
    console.error(`[CYOA] ${error.message}`);
    throw error;
  }

  if (sets.length !== 2) {
    const error = new Error(`Pack choice requires exactly 2 sets, got ${sets.length}`);
    console.error(`[CYOA] ${error.message}`);
    throw error;
  }

  const [set1, set2] = sets;

  try {
    // Generate first pack
    const pack1Message = botBunkerChannel.send(`!${set1} - pack choice for <@${userId}>`);
    const pack1Result = await waitForBoosterTutor(pack1Message);
    
    if ("error" in pack1Result) {
      throw new Error(`Error generating ${set1} pack: ${pack1Result.error}`);
    }

    // Generate second pack
    const pack2Message = botBunkerChannel.send(`!${set2} - pack choice for <@${userId}>`);
    const pack2Result = await waitForBoosterTutor(pack2Message);
    
    if ("error" in pack2Result) {
      throw new Error(`Error generating ${set2} pack: ${pack2Result.error}`);
    }

    const pack1 = pack1Result.success;
    const pack2 = pack2Result.success;

    // Create buttons for pack choice
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`RAL_PACK_CHOICE:${set1}`)
          .setLabel(`Choose ${set1} Pack`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`RAL_PACK_CHOICE:${set2}`)
          .setLabel(`Choose ${set2} Pack`)
          .setStyle(ButtonStyle.Primary),
      );

    // Send DM with buttons
    try {
      const dmChannel = await member.createDM();
      const choiceMessage = await dmChannel.send({
        content: `${postSelectionText}\n\nChoose which pack you want:\n**${set1} Pack**: https://sealeddeck.tech/${pack1.poolId}\n**${set2} Pack**: https://sealeddeck.tech/${pack2.poolId}`,
        components: [row],
      });

      // Store the pending choice
      pendingPackChoices.set(userId, {
        set1Pack: pack1,
        set2Pack: pack2,
        set1,
        set2,
        messageId: choiceMessage.id,
      });
    } catch (dmError) {
      // Handle Discord API error 50007: Cannot send messages to this user
      if (dmError instanceof DiscordAPIError && dmError.code === 50007) {
        console.warn(`[CYOA] Cannot send DM to user ${userId} for pack choice - user has DMs disabled or has blocked the bot`);
        throw new Error("Cannot send DM to user - user has DMs disabled");
      }
      throw dmError;
    }
  } catch (error) {
    console.error(`[CYOA] Error initiating pack choice for user ${userId}:`, error);
    // Try to send error message via DM, but handle DM errors gracefully
    try {
      const dmChannel = await member.createDM();
      await dmChannel.send(`Error generating packs for your choice. Please contact an administrator.`);
    } catch (dmError) {
      if (dmError instanceof DiscordAPIError && dmError.code === 50007) {
        console.warn(`[CYOA] Cannot send error DM to user ${userId} - user has DMs disabled or has blocked the bot`);
      } else {
        console.error("Error sending error message via DM:", dmError);
      }
    }
    // Re-throw the error so the caller knows it failed
    throw error;
  }
}

// Handle pack choice button
async function handlePackChoiceButton(
  interaction: Interaction,
): Promise<void> {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("RAL_PACK_CHOICE:")) return;

  const userId = interaction.user.id;
  const choice = pendingPackChoices.get(userId);

  if (!choice) {
    await interaction.reply({ content: "No pending pack choice found.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Extract the set code from the customId (format: RAL_PACK_CHOICE:SETCODE)
  const chosenSet = interaction.customId.split(":")[1];
  const chosenPack = chosenSet === choice.set1 ? choice.set1Pack : choice.set2Pack;

  // Disable all buttons with the correct set codes
  const disabledRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`RAL_PACK_CHOICE:${choice.set1}`)
        .setLabel(`Choose ${choice.set1} Pack`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`RAL_PACK_CHOICE:${choice.set2}`)
        .setLabel(`Choose ${choice.set2} Pack`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );

  try {
    await interaction.update({
      components: [disabledRow],
    });
  } catch (error) {
    console.error("Error updating interaction:", error);
    await interaction.deferUpdate();
  }

  // Remove from pending choices
  pendingPackChoices.delete(userId);

  // Get player Identification for Pool Changes
  const playerIdentification = await getPlayerIdentification(userId);
  if (playerIdentification) {
    // Get the last pool change to get the current Full Pool
    const poolChanges = await getPoolChanges();
    const lastChange = poolChanges.rows.findLast((change) =>
      change["Name"] === playerIdentification
    );
    const currentFullPoolId = lastChange?.["Full Pool"] ?? undefined;
    
    // Fetch pack contents and update Full Pool
    const packContents = await fetchSealedDeck(chosenPack.poolId);
    const newFullPoolId = await makeSealedDeck(
      packContents,
      currentFullPoolId,
    );
    
    // Record the chosen pack to Pool Changes with updated Full Pool
    await addPoolChange(
      playerIdentification,
      "add pack",
      chosenPack.poolId,
      `CYOA reward - ${chosenSet} pack (chosen from pick 1 of 2)`,
      newFullPoolId,
    );
  }

  // Send the chosen pack to packgen channel
  const guild = await interaction.client.guilds.fetch(CONFIG.GUILD_ID);
  const packgenChannel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as TextChannel | null;

  if (packgenChannel) {
    await packgenChannel.send(`<@${userId}> chose the ${chosenSet} pack: https://sealeddeck.tech/${chosenPack.poolId}`);
  }

  // Send confirmation to user
  try {
    await interaction.followUp({
      content: `You chose the ${chosenSet} pack! Your pack has been sent to the pack generation channel.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error("Error sending follow-up:", error);
  }
}

// Button interaction handler
const cyoaButtonHandler: Handler<Interaction> = async (interaction, handle) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("RAL_CYOA:")) return;

  handle.claim();
  await handleCyoaButton(interaction);
};

// Pack choice button handler
const packChoiceButtonHandler: Handler<Interaction> = async (interaction, handle) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("RAL_PACK_CHOICE:")) return;

  handle.claim();
  await handlePackChoiceButton(interaction);
};

// Manual command handler for !sendEvent [DISCORD_ID] [EVENT_ID]
const sendEventCommandHandler: Handler<Message> = async (message, handle) => {
  const content = message.content.trim();
  if (!content.startsWith("!sendEvent")) return;
  
  handle.claim();
  
  // Parse command: !sendEvent [DISCORD_ID] [EVENT_ID]
  const parts = content.split(/\s+/);
  if (parts.length < 3) {
    await message.reply("Usage: `!sendEvent [DISCORD_ID] [EVENT_ID]`");
    return;
  }
  
  const discordId = parts[1];
  const eventId = parts[2];
  
  // Validate Discord ID format (should be numeric)
  if (!/^\d+$/.test(discordId)) {
    await message.reply(`Invalid Discord ID: ${discordId}`);
    return;
  }
  
  // Determine if this is a win or loss event
  const isWin = onWinEvents.some(e => e.id === eventId);
  const isLoss = onLossEvents.some(e => e.id === eventId);
  const isElimination = typeof eventId === "string" && eventId.startsWith("ELIMINATION.");
  
  if (!isWin && !isLoss) {
    await message.reply(`Event ID "${eventId}" not found in win or loss events.`);
    return;
  }
  
  try {
    let sent = false;
    
    if (isElimination) {
      // ELIMINATION events use sendEventMessageWithoutButtons (no interactive buttons)
      // These are terminal events that don't require player choice
      sent = await sendEventMessageWithoutButtons(
        message.client,
        discordId,
        eventId,
        false, // ELIMINATION events are always loss events
      );
    } else {
      // Regular events use sendEventMessage (with interactive buttons)
      const playerChosenEvents = await getPlayerChosenEvents(discordId);
      sent = await sendEventMessage(
        message.client,
        discordId,
        eventId,
        isWin,
        playerChosenEvents,
      );
    }
    
    if (sent) {
      // Event is already recorded in CYOA sheet by sendEventMessage/sendEventMessageWithoutButtons
      await message.reply(`✅ Successfully sent event ${eventId} to <@${discordId}> and recorded in CYOA sheet.`);
    } else {
      await message.reply(`❌ Failed to send event ${eventId} to <@${discordId}>. The user may have DMs disabled.`);
    }
  } catch (error) {
    console.error(`[CYOA] Error in sendEvent command:`, error);
    await message.reply(`❌ Error sending event: ${error instanceof Error ? error.message : String(error)}`);
  }
};

// Get RAL matches from the Matches sheet
async function getRalMatches() {
  return await getAllMatches({ 
    "Bot Messaged": z.coerce.boolean().optional(),
    "Bot Messaged Winner": z.coerce.boolean().optional(),
  }, {
    "Bot Messaged": z.coerce.boolean().optional(),
  });
}

// Get RAL players
async function getRalPlayers() {
  return await getPlayers(undefined, { "Discord ID": z.string() });
}

// Get player Identification by Discord ID
async function getPlayerIdentification(discordId: string): Promise<string | null> {
  const players = await getRalPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  return player?.Identification || null;
}

// Convert column index (0-based) to column letter (A, B, ..., Z, AA, AB, ...)
function columnIndexToLetter(index: number): string {
  let result = "";
  index++; // Convert to 1-based
  while (index > 0) {
    index--; // Make it 0-based for the modulo operation
    result = String.fromCharCode(65 + (index % 26)) + result;
    index = Math.floor(index / 26);
  }
  return result;
}

// Check if all previous matches for a player have been messaged
// This checks both wins and losses - if the player was a loser, check "Bot Messaged"
// If the player was a winner, check "Bot Messaged Winner"
function allPreviousMatchesMessaged(
  matchesData: Awaited<ReturnType<typeof getRalMatches>>,
  playerIdentification: string,
  currentMatch: Awaited<ReturnType<typeof getRalMatches>>["rows"][number],
  isLossEvent: boolean = false,
): boolean {
  // Find the index of the current match in the sorted (by timestamp) array
  // Matches are already sorted chronologically by getAllMatches, ensuring we process oldest first
  const currentMatchIndex = matchesData.rows.findIndex((m) => 
    m[ROWNUM] === currentMatch[ROWNUM] && 
    m["Your Name"] === currentMatch["Your Name"] && 
    m["Loser Name"] === currentMatch["Loser Name"] &&
    m[MATCHTYPE] === currentMatch[MATCHTYPE]
  );
  
  if (currentMatchIndex === -1) {
    // Match not found - this shouldn't happen, but be safe
    console.warn(`[CYOA] Could not find current match in matchesData for ${playerIdentification}`);
    return false;
  }
  
  // Get all matches that come before the current match (matches are sorted by timestamp)
  // This ensures we process the oldest unprocessed match first
  const previousMatches = matchesData.rows.slice(0, currentMatchIndex);
  
  // Find all matches where this player participated
  // For loss events: only check previous LOSS matches (where player was the loser)
  //   - This includes both regular match losses and entropy losses
  //   - A player might have 2 losses in Matches sheet but 4 losses total (2 from entropy)
  //   - We need to ensure all previous loss matches (including entropy) have been messaged
  //   - Win matches don't block loss event processing
  // For win events: check all previous matches (both wins and losses)
  const playerPreviousMatches = previousMatches.filter((m) => {
    if (!m["Script Handled"]) return false;
    if (isLossEvent) {
      // For loss events, only check previous losses (where player was the loser)
      // This includes both regular matches and entropy (entropy always has PLAYER 2 as loser)
      return m["Loser Name"] === playerIdentification;
    } else {
      // For win events, check all previous matches (both wins and losses)
      return m["Loser Name"] === playerIdentification || m["Your Name"] === playerIdentification;
    }
  });

  // Check if all previous matches have been messaged appropriately:
<<<<<<< Updated upstream
  // - If player was the loser, "Bot Messaged" must be set (applies to both regular matches and entropy)
  // - If player was the winner, "Bot Messaged Winner" must be set
=======
  // - If player was the loser, "Bot Messaged" must be set
  // - If player was the winner, "Bot Messaged Winner" must be set (only for regular matches, not entropy)
  // - For entropy matches, only check "Bot Messaged" since there's no winner
>>>>>>> Stashed changes
  return playerPreviousMatches.every((m) => {
    const isEntropy = m[MATCHTYPE] === "entropy";
    if (m["Loser Name"] === playerIdentification) {
      // Player was the loser - check "Bot Messaged"
      // This applies to both regular match losses and entropy losses
      return m["Bot Messaged"] === true;
    } else {
      // Player was the winner - check "Bot Messaged Winner" (only for regular matches)
      // Entropy matches don't have winners, so if we get here for entropy, something is wrong
      if (isEntropy) {
        // Entropy matches don't have winners, so if the player is not the loser, they shouldn't be in this match
        return true; // This shouldn't happen, but return true to avoid blocking
      }
      const botMessagedWinner = (m as Record<string, unknown>)["Bot Messaged Winner"] as boolean | undefined;
      return botMessagedWinner === true;
    }
  });
}

// Send an event message without interactive buttons (for terminal events like elimination)
async function sendEventMessageWithoutButtons(
  client: Client,
  userId: string,
  eventId: EventId,
  isWin: boolean,
): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    const dmChannel = await member.createDM();

    const event = getEventById(eventId, isWin);
    if (!event) {
      await dmChannel.send("Event not found.");
      return false;
    }

    // Send the main text
    if (event.mainText) {
      await dmChannel.send(event.mainText);
    }

    // If there's an option with postSelectionText, extract card URL and send image
    if (event.options && event.options.length > 0 && event.options[0].postSelectionText) {
      const postSelectionText = event.options[0].postSelectionText;
      
      // Extract card URL from postSelectionText (format: https://scryfall.com/card/...)
      const cardUrlMatch = postSelectionText.match(/https:\/\/scryfall\.com\/card\/[^\s\n]+/);
      
      if (cardUrlMatch) {
        const cardUrl = cardUrlMatch[0];
        
        try {
          // Extract query from card URL
          const query = extractQueryFromUrl(cardUrl);
          if (query) {
            // Search for the card
            const cards = await searchCards(query);
            if (cards.length > 0) {
              const card = cards[0];
              
              // Fetch the card image
              const imageBlob = await fetchCardImage(card, "normal");
              
              // Convert blob to buffer for Discord attachment
              const arrayBuffer = await imageBlob.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              
              // Create attachment and send the card image
              const attachment = new AttachmentBuilder(buffer, {
                name: `${card.name.replace(/[^a-z0-9]/gi, "_")}.png`,
              });
              
              await dmChannel.send({
                files: [attachment],
              });
            }
          }
        } catch (error) {
          console.error(`Error fetching card image for ${cardUrl}:`, error);
          // Fallback to sending the URL if image fetch fails
          await dmChannel.send(cardUrl);
        }
      }
      
      // Extract and send the closing message (everything after the card URL)
      const closingMessage = postSelectionText.replace(/https:\/\/scryfall\.com\/card\/[^\s\n]+[\s\n]*/, "").trim();
      if (closingMessage) {
        await dmChannel.send(closingMessage);
      }
    }

    // Record that the event was sent (Event column filled, Next Event column empty)
    const playerIdentification = await getPlayerIdentification(userId);
    if (playerIdentification) {
      await recordCyoaMessageSent(playerIdentification, userId, String(eventId));
    }

    return true;
  } catch (error) {
    // Handle Discord API error 50007: Cannot send messages to this user
    if (error instanceof DiscordAPIError && error.code === 50007) {
      const playerIdentification = await getPlayerIdentification(userId);
      console.warn(
        `[CYOA] Cannot send DM to user ${userId}${playerIdentification ? ` (${playerIdentification})` : ""} - user has DMs disabled or has blocked the bot`
      );
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

// Check for matches and send CYOA events
async function checkForMatches(client: Client<boolean>) {
  let matchesData;
  let players;
  
  try {
    matchesData = await getRalMatches();
  } catch (error) {
    console.error("[CYOA] Error reading Matches sheet:", error);
    return; // Gracefully exit if we can't read matches
  }
  
  try {
    players = await getRalPlayers();
  } catch (error) {
    console.error("[CYOA] Error reading Player Database sheet:", error);
    return; // Gracefully exit if we can't read players
  }

  // Get the column indices for "Bot Messaged" and "Bot Messaged Winner" in the Matches sheet
  const botMessagedColIndex = matchesData.headerColumns.match["Bot Messaged"];
  const botMessagedWinnerColIndex = matchesData.headerColumns.match["Bot Messaged Winner"];
  const botMessagedEntropyColIndex = matchesData.headerColumns.entropy["Bot Messaged"];
  if (botMessagedColIndex === undefined) {
    console.warn("Bot Messaged column not found in Matches sheet headers");
    return;
  }
  if (botMessagedWinnerColIndex === undefined) {
    console.warn("Bot Messaged Winner column not found in Matches sheet headers");
    return;
  }
  if (botMessagedEntropyColIndex === undefined) {
    console.warn("Bot Messaged column not found in Entropy sheet headers");
    return;
  }
  const botMessagedColLetter = columnIndexToLetter(botMessagedColIndex);
  const botMessagedWinnerColLetter = columnIndexToLetter(botMessagedWinnerColIndex);
  const botMessagedEntropyColLetter = columnIndexToLetter(botMessagedEntropyColIndex);

  for (const match of matchesData.rows) {
    // Only process matches that have been script handled
    if (!match["Script Handled"]) continue;

    // Find the winner and loser players
    const _winner = players.rows.find(
      (p) => p.Identification === match["Your Name"]
    );
    if (match["Loser Name"] === "Entropy") continue;
    const loser = players.rows.find(
      (p) => p.Identification === match["Loser Name"]
    );


    console.log(`[CYOA] Processing match ${match[ROWNUM]} - winner: ${_winner?.Identification}, loser: ${loser?.Identification}`);
    // Send CYOA event to loser (loss events)
    // Only process if the player is actually the loser in this match (not the winner)
    if (loser && loser["Discord ID"] && loser.Identification === match["Loser Name"] && !match["Bot Messaged"]) {
      // Check if all previous LOSS matches have been messaged (wins don't block loss processing)
      if (!allPreviousMatchesMessaged(matchesData, loser.Identification, match, true)) {
        console.log(`[CYOA] Skipping event for loser ${loser.Identification} - not all previous loss matches have been messaged yet`);
        continue; // Skip this match, will check again next iteration
      }

      // Process events in order - always check for pending events first (regardless of loss count)
      try {
        // Check if there's an event that was sent but doesn't have a choice yet
        const eventSentWithoutChoice = await getMostRecentEventSentWithoutChoice(loser["Discord ID"]);
        if (eventSentWithoutChoice) {
          // Check if the pending event is a win event - if so, don't send loss events
          const isPendingWinEvent = onWinEvents.some(e => e.id === eventSentWithoutChoice.eventId);
          if (isPendingWinEvent) {
            console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}) has a pending WIN event (${eventSentWithoutChoice.eventId}) that hasn't been chosen yet. Skipping loss event.`);
            // Don't mark as messaged - wait for the player to respond to the win event first
            continue;
          } else {
            console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}) has a pending event (${eventSentWithoutChoice.eventId}) that hasn't been chosen yet. Skipping new event.`);
            // Don't mark as messaged - wait for the player to make a choice
          }
        } else {
          // Get the most recently chosen event from the CYOA sheet
          // This is the nextEvent ID that was stored when they made their last choice
          const nextEventId = await getMostRecentChosenEvent(loser["Discord ID"]);
          
          console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}): most recent chosen event = ${nextEventId || "null"}`);
          
          // If no chosen event found, this is their first loss - send start event
          // Otherwise, send the event they should receive next based on their last choice
          // Skip if nextEventId is COMPLETED_EVENT (terminal event for 5 losses)
          if (nextEventId === String(COMPLETED_EVENT)) {
            // Player has 5 losses and reached terminal event - skip
            console.log(`[CYOA] Player ${loser.Identification} has reached COMPLETED_EVENT (terminal for 5 losses)`);
            const rowNum = match[ROWNUM];
            const isEntropy = match[MATCHTYPE] === "entropy";
            const sheetName = isEntropy ? "Entropy" : "Matches";
            const colLetter = isEntropy ? botMessagedEntropyColLetter : botMessagedColLetter;
            await sheetsWrite(
              sheets,
              CONFIG.LIVE_SHEET_ID!,
              `${sheetName}!${colLetter}${rowNum}`,
              [["TRUE"]],
            );
          } else if (nextEventId && nextEventId.startsWith("ELIMINATION.")) {
            // Player has an elimination event as nextEvent
            // Only send it if they have 6+ losses AND no pending events, otherwise skip (they'll get it on 6th loss)
            if (loser.Losses >= 6) {
              console.log(`[CYOA] Sending elimination DM to player ${loser.Identification} (${loser["Discord ID"]}) - reached 6 losses with ${nextEventId}`);
              
              // Send the elimination event without buttons (terminal event)
              const sent = await sendEventMessageWithoutButtons(
                client,
                loser["Discord ID"],
                nextEventId,
                false, // isWin = false, it's in onLossEvents
              );
              
              if (sent) {
                console.log(`[CYOA] Successfully sent elimination DM to ${loser.Identification}`);
              }
              
              // Mark as messaged since we sent the elimination event
              const rowNum = match[ROWNUM];
              const isEntropy = match[MATCHTYPE] === "entropy";
              const sheetName = isEntropy ? "Entropy" : "Matches";
              const colLetter = isEntropy ? botMessagedEntropyColLetter : botMessagedColLetter;
              await sheetsWrite(
                sheets,
                CONFIG.LIVE_SHEET_ID!,
                `${sheetName}!${colLetter}${rowNum}`,
                [["TRUE"]],
              );
            } else {
              // Player has elimination event as nextEvent but hasn't reached 6 losses yet
              // Skip sending it, they'll get it on 6th loss
              console.log(`[CYOA] Player ${loser.Identification} has ${nextEventId} as nextEvent (has taken a WAR_END event) - skipping event, will get elimination DM on 6th loss`);
              const rowNum = match[ROWNUM];
              const isEntropy = match[MATCHTYPE] === "entropy";
              const sheetName = isEntropy ? "Entropy" : "Matches";
              const colLetter = isEntropy ? botMessagedEntropyColLetter : botMessagedColLetter;
              await sheetsWrite(
                sheets,
                CONFIG.LIVE_SHEET_ID!,
                `${sheetName}!${colLetter}${rowNum}`,
                [["TRUE"]],
              );
            }
          } else {
            // Normal event processing - send the next event in sequence
            const eventIdToSend: EventId = nextEventId || START_EVENT;
            
            // Get the player's chosen events (for filtering options that require previous selections)
            const playerChosenEvents = await getPlayerChosenEvents(loser["Discord ID"]);
            
            console.log(`[CYOA] Sending event ${eventIdToSend} to player ${loser.Identification}`);

            // Send the event as a DM to the losing player
            await sendEventMessage(
              client,
              loser["Discord ID"],
              eventIdToSend,
              false, // isWin = false for losses
              playerChosenEvents,
            );
          
            // Mark as messaged even if DM failed (so we don't keep retrying)
            // The sendEventMessage function handles logging for DM failures
            const rowNum = match[ROWNUM];
            const isEntropy = match[MATCHTYPE] === "entropy";
            const sheetName = isEntropy ? "Entropy" : "Matches";
            const colLetter = isEntropy ? botMessagedEntropyColLetter : botMessagedColLetter;
            await sheetsWrite(
              sheets,
              CONFIG.LIVE_SHEET_ID!,
              `${sheetName}!${colLetter}${rowNum}`,
              [["TRUE"]],
            );
          }
        }
      } catch (error) {
        console.error(
          `Error sending CYOA event to loser ${loser.Identification} (${loser["Discord ID"]}) for match ${match[ROWNUM]}:`,
          error,
        );
      }
    }

    // Send CYOA event to winner (win events)
<<<<<<< Updated upstream
    // Only process if the player is actually the winner in this match (not the loser)
    const botMessagedWinner = (match as Record<string, unknown>)["Bot Messaged Winner"] as boolean | undefined;
    if (_winner && _winner["Discord ID"] && _winner.Identification === match["Your Name"] && !botMessagedWinner) {
=======
    // Skip winner handling for entropy matches - they don't have winners
    const isEntropy = match[MATCHTYPE] === "entropy";
    const botMessagedWinner = (match as Record<string, unknown>)["Bot Messaged Winner"] as boolean | undefined;
    if (!isEntropy && _winner && _winner["Discord ID"] && !botMessagedWinner) {
>>>>>>> Stashed changes
      // Check if all previous matches (both wins and losses) have been messaged
      if (!allPreviousMatchesMessaged(matchesData, _winner.Identification, match)) {
        console.log(`[CYOA] Skipping win event for winner ${_winner.Identification} - not all previous matches have been messaged yet`);
        continue; // Skip this match, will check again next iteration
      }

      // Process win events normally - check for pending events first (regardless of loss count)
      try {
        // Check if there's an event that was sent but doesn't have a choice yet
        const eventSentWithoutChoice = await getMostRecentEventSentWithoutChoice(_winner["Discord ID"]);
        if (eventSentWithoutChoice) {
          console.log(`[CYOA] Player ${_winner.Identification} (${_winner["Discord ID"]}) has a pending event (${eventSentWithoutChoice.eventId}) that hasn't been chosen yet. Skipping new win event.`);
          // Don't mark as messaged - wait for the player to make a choice
        } else {
          // Get the loss count from the Player Database
          const lossCount = _winner.Losses;
          
          // Get the player's chosen events (for filtering options that require previous selections)
          const playerChosenEvents = await getPlayerChosenEvents(_winner["Discord ID"]);
          
          // Select an appropriate win event based on player's loss count, excluding events they've already received
          const winEventId = await selectWinEvent(lossCount, _winner["Discord ID"]);
          
          if (!winEventId) {
            console.warn(`No win event found for winner ${_winner.Identification}, skipping`);
            // Mark as messaged since no event to send
            const rowNum = match[ROWNUM];
            await sheetsWrite(
              sheets,
              CONFIG.LIVE_SHEET_ID!,
              `Matches!${botMessagedWinnerColLetter}${rowNum}`,
              [["TRUE"]],
            );
          } else {
            console.log(`[CYOA] Sending win event ${winEventId} to winner ${_winner.Identification} (${lossCount} losses)`);
            
            // Send the win event as a DM to the winning player
            // The requiredSelections in the event options will automatically filter available options
            await sendEventMessage(
              client,
              _winner["Discord ID"],
              winEventId,
              true, // isWin = true for wins
              playerChosenEvents,
            );
            
            // Mark as messaged even if DM failed (so we don't keep retrying)
            // The sendEventMessage function handles logging for DM failures
            const rowNum = match[ROWNUM];
            await sheetsWrite(
              sheets,
              CONFIG.LIVE_SHEET_ID!,
              `Matches!${botMessagedWinnerColLetter}${rowNum}`,
              [["TRUE"]],
            );
          }
        }
      } catch (error) {
        console.error(
          `Error sending CYOA event to winner ${_winner.Identification} (${_winner["Discord ID"]}) for match ${match[ROWNUM]}:`,
          error,
        );
      }
    }
  }
}

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: async (client: Client) => {
      console.log("[CYOA] Watch function started");
      while (true) {
        try {
          await checkForMatches(client);
        } catch (error) {
          console.error("[CYOA] Error in checkForMatches loop:", error);
          // Continue the loop even if there's an error
        }
        await delay(60_000); // Check every minute
      }
    },
    messageHandlers: [sendEventCommandHandler],
    interactionHandlers: [cyoaButtonHandler, packChoiceButtonHandler],
  });
}
