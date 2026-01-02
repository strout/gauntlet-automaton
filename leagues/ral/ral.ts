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
} from "discord.js";
import { Handler } from "../../dispatch.ts";
import { CONFIG } from "../../config.ts";
import { searchCards } from "../../scryfall.ts";
import { getAllMatches, getPlayers, ROWNUM, addPoolChange, getPoolChanges } from "../../standings.ts";
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
      // Query-based card reward
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
        const selectedCards = cards.slice(0, reward.count);
        
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
async function sendEventMessage(
  client: Client,
  userId: string,
  eventId: EventId,
  isWin: boolean,
  playerChosenEvents: string[],
): Promise<void> {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const member = await guild.members.fetch(userId);
  const dmChannel = await member.createDM();

  const event = getEventById(eventId, isWin);
  if (!event) {
    await dmChannel.send("Event not found.");
    return;
  }

  const availableOptions = filterOptions(event.options, playerChosenEvents);

  if (availableOptions.length === 0) {
    await dmChannel.send("No options available for this event.");
    return;
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
        }
        // If no recent loss event found, eventChosen remains empty string
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
      const dmChannel = await member.createDM();
      await dmChannel.send(`${option.postSelectionText}\n\n${rewardMessage}`);
    } else {
      // No rewards at all, just send postSelectionText
      const dmChannel = await member.createDM();
      await dmChannel.send(option.postSelectionText);
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
    console.error("Packgen or bot bunker channel not found");
    return;
  }

  if (sets.length !== 2) {
    console.error(`Pack choice requires exactly 2 sets, got ${sets.length}`);
    return;
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
  } catch (error) {
    console.error("Error initiating pack choice:", error);
    const dmChannel = await member.createDM();
    await dmChannel.send(`Error generating packs for your choice. Please contact an administrator.`);
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

// Get RAL matches from the Matches sheet
async function getRalMatches() {
  return await getAllMatches({ "Bot Messaged": z.coerce.boolean().optional() }, {});
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

  // Get the column index for "Bot Messaged" in the Matches sheet
  const botMessagedColIndex = matchesData.headerColumns.match["Bot Messaged"];
  if (botMessagedColIndex === undefined) {
    console.warn("Bot Messaged column not found in Matches sheet headers");
    return;
  }
  const botMessagedColLetter = columnIndexToLetter(botMessagedColIndex);

  for (const match of matchesData.rows) {
    // Only process matches that have been script handled
    if (!match["Script Handled"]) continue;
    
    // Skip if already messaged
    if (match["Bot Messaged"]) continue;

    // Find the winner and loser players
    const _winner = players.rows.find(
      (p) => p.Identification === match["Your Name"]
    );
    const loser = players.rows.find(
      (p) => p.Identification === match["Loser Name"]
    );

    let loserProcessed = false;
    let winnerProcessed = false;

    // Send CYOA event to loser (loss events)
    if (loser && loser["Discord ID"]) {
      // Skip if player has 6 or more losses (eliminated)
      if (loser.Losses >= 6) {
        console.log(`[CYOA] Skipping event for eliminated player ${loser.Identification} (${loser.Losses} losses)`);
        loserProcessed = true; // Mark as processed (skipped for valid reason)
      } else {
        try {
          // Check if there's an event that was sent but doesn't have a choice yet
          const eventSentWithoutChoice = await getMostRecentEventSentWithoutChoice(loser["Discord ID"]);
          if (eventSentWithoutChoice) {
            console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}) has a pending event (${eventSentWithoutChoice.eventId}) that hasn't been chosen yet. Skipping new event.`);
            // Don't mark as processed - wait for the player to make a choice
          } else {
            // Get the most recently chosen event from the CYOA sheet
            // This is the nextEvent ID that was stored when they made their last choice
            const nextEventId = await getMostRecentChosenEvent(loser["Discord ID"]);
            
            console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}): most recent chosen event = ${nextEventId || "null"}`);
            
            // If no chosen event found, this is their first loss - send start event
            // Otherwise, send the event they should receive next based on their last choice
            // Skip if nextEventId is COMPLETED_EVENT (terminal event for 5 losses)
            const eventIdToSend: EventId = (nextEventId && nextEventId !== String(COMPLETED_EVENT)) ? nextEventId : START_EVENT;
            
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
            loserProcessed = true;
          }
        } catch (error) {
          console.error(
            `Error sending CYOA event to loser ${loser.Identification} (${loser["Discord ID"]}) for match ${match[ROWNUM]}:`,
            error,
          );
        }
      }
    } else {
      loserProcessed = true; // No loser to process
    }

    // Send CYOA event to winner (win events)
    if (_winner && _winner["Discord ID"]) {
      // Skip if player has 6 or more losses (eliminated)
      if (_winner.Losses >= 6) {
        console.log(`[CYOA] Skipping win event for eliminated player ${_winner.Identification} (${_winner.Losses} losses)`);
        winnerProcessed = true; // Mark as processed (skipped for valid reason)
      } else {
        try {
          // Check if there's an event that was sent but doesn't have a choice yet
          const eventSentWithoutChoice = await getMostRecentEventSentWithoutChoice(_winner["Discord ID"]);
          if (eventSentWithoutChoice) {
            console.log(`[CYOA] Player ${_winner.Identification} (${_winner["Discord ID"]}) has a pending event (${eventSentWithoutChoice.eventId}) that hasn't been chosen yet. Skipping new win event.`);
            // Don't mark as processed - wait for the player to make a choice
          } else {
            // Get the loss count from the Player Database
            const lossCount = _winner.Losses;
            
            // Get the player's chosen events (for filtering options that require previous selections)
            const playerChosenEvents = await getPlayerChosenEvents(_winner["Discord ID"]);
            
            // Select an appropriate win event based on player's loss count, excluding events they've already received
            const winEventId = await selectWinEvent(lossCount, _winner["Discord ID"]);
            
            if (!winEventId) {
              console.warn(`No win event found for winner ${_winner.Identification}, skipping`);
              winnerProcessed = true; // Mark as processed (no event found)
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
              winnerProcessed = true;
            }
          }
        } catch (error) {
          console.error(
            `Error sending CYOA event to winner ${_winner.Identification} (${_winner["Discord ID"]}) for match ${match[ROWNUM]}:`,
            error,
          );
        }
      }
    } else {
      winnerProcessed = true; // No winner to process
    }

    // Mark the match as "Bot Messaged" only if both players have been processed (or skipped for valid reasons)
    // If either player has a pending event, don't mark as messaged so we check again later
    if (loserProcessed && winnerProcessed) {
      const rowNum = match[ROWNUM];
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID!,
        `Matches!${botMessagedColLetter}${rowNum}`,
        [["TRUE"]],
      );
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
    messageHandlers: [],
    interactionHandlers: [cyoaButtonHandler, packChoiceButtonHandler],
  });
}
