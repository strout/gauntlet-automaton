import {
  Client,
  Interaction,
  Message,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  MessageFlags,
  TextChannel,
} from "discord.js";
import { Handler } from "../../dispatch.ts";
import { CONFIG } from "../../config.ts";
import { searchCards } from "../../scryfall.ts";
import { getAllMatches, getPlayers, ROWNUM } from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  getPlayerChosenEvents,
  getMostRecentChosenEvent,
  recordCyoaEntry,
} from "./cyoa_sheet.ts";
import { Event, EventId, START_EVENT } from "./cyoa_types.ts";
import { onLossEvents, onWinEvents } from "./cyoa_data.ts";
import { z } from "zod";
import { makeSealedDeck, SealedDeckEntry } from "../../sealeddeck.ts";

// Helper to delay execution
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Select an appropriate win event based on player's loss count
function selectWinEvent(lossCount: number): EventId | null {
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
    return guildBonusEvents[Math.floor(Math.random() * guildBonusEvents.length)];
  }

  // If player has 3-5 losses, randomly select from RAV_* or BOLAS_* events
  if (lossCount >= 3 && lossCount <= 5) {
    const ravBolasEvents = [
      "ON_WIN_EVENTS.RAV_FLY_TRAMPLE",
      "ON_WIN_EVENTS.RAV_COUNTER_PROLIF",
      "ON_WIN_EVENTS.RAV_HASTE_VIG",
      "ON_WIN_EVENTS.RAV_SMALL_LARGE",
      "ON_WIN_EVENTS.BOLAS_CHEAP_EXPENSIVE",
      "ON_WIN_EVENTS.BOLAS_ZOMBIE_AMASS",
      "ON_WIN_EVENTS.BOLAS_HUMAN_NONHUMAN",
      "ON_WIN_EVENTS.BOLAS_HIGH_LOW_POWER",
      "ON_WIN_EVENTS.BOLAS_INSTANT_SORCERY",
    ];
    return ravBolasEvents[Math.floor(Math.random() * ravBolasEvents.length)];
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

  const allCards: Array<{ name: string; count: number; set?: string }> = [];
  const packMessages: string[] = [];

  // Process all rewards
  for (const reward of rewards) {
    if (reward.count === "PACK") {
      // Request pack generation (Booster Tutor will handle independently)
      if (packgenChannel) {
        const sets = reward.sets || [];
        for (const set of sets) {
          await packgenChannel.send(`!${set} <@${userId}>`);
          packMessages.push(`Requested ${set} pack`);
        }
      }
    } else if (reward.query) {
      // Get cards from Scryfall query and compile into sealeddeck.tech link
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

  // Build reward message
  const messages: string[] = [];
  
  // Add pack messages
  if (packMessages.length > 0) {
    messages.push(...packMessages);
  }
  
  // Add sealeddeck.tech link for query-based cards
  if (allCards.length > 0) {
    const poolId = await makeSealedDeck({
      sideboard: allCards as SealedDeckEntry[],
    });
    const sealedDeckLink = `https://sealeddeck.tech/${poolId}`;
    messages.push(`Your card rewards: ${sealedDeckLink}`);
    
    // Also post the link in the packgen channel
    if (packgenChannel) {
      await packgenChannel.send(`<@${userId}> got CYOA card rewards: ${sealedDeckLink}`);
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

    // Record the choice (store the nextEvent ID in the Event column)
    // For win events, nextEvent is empty string (terminal), so we record the event ID itself
    // For loss events, we record the nextEvent ID
    const eventChosen = String(option.nextEvent || eventId);
    await recordCyoaEntry(
      playerIdentification,
      userId,
      isWin ? "win" : "loss", // Match result based on event type
      eventChosen, // Store the nextEvent ID (or event ID for terminal events) in the Event column (F)
    );

    // Give rewards
    const rewardMessage = await giveRewards(
      interaction.client,
      userId,
      option.rewards,
    );

    // Send a new DM with the response text and rewards
    const dmChannel = await member.createDM();
    await dmChannel.send(`${option.postSelectionText}\n\n${rewardMessage}`);
  } catch (error) {
    console.error("Error processing CYOA choice:", error);
    try {
      await interaction.followUp({ content: "An error occurred processing your choice.", flags: MessageFlags.Ephemeral });
    } catch (followUpError) {
      console.error("Error sending error message:", followUpError);
    }
  }
}

// Button interaction handler
const cyoaButtonHandler: Handler<Interaction> = async (interaction, handle) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith("RAL_CYOA:")) return;

  handle.claim();
  await handleCyoaButton(interaction);
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
  const matchesData = await getRalMatches();
  const players = await getRalPlayers();

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

    let shouldMarkAsMessaged = false;

    // Send CYOA event to loser (loss events)
    if (loser && loser["Discord ID"]) {
      // Skip if player has 6 or more losses (eliminated)
      if (loser.Losses >= 6) {
        console.log(`[CYOA] Skipping event for eliminated player ${loser.Identification} (${loser.Losses} losses)`);
        shouldMarkAsMessaged = true; // Still mark as processed even if we skip
      } else {
        try {
          // Get the most recently chosen event from the CYOA sheet
          // This is the nextEvent ID that was stored when they made their last choice
          const nextEventId = await getMostRecentChosenEvent(loser["Discord ID"]);
          
          console.log(`[CYOA] Player ${loser.Identification} (${loser["Discord ID"]}): most recent chosen event = ${nextEventId || "null"}`);
          
          // If no chosen event found, this is their first loss - send start event
          // Otherwise, send the event they should receive next based on their last choice
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
          shouldMarkAsMessaged = true;
        } catch (error) {
          console.error(
            `Error sending CYOA event to loser ${loser.Identification} (${loser["Discord ID"]}) for match ${match[ROWNUM]}:`,
            error,
          );
        }
      }
    }

    // Send CYOA event to winner (win events)
    if (_winner && _winner["Discord ID"]) {
      try {
        // Get the loss count from the Player Database
        const lossCount = _winner.Losses;
        
        // Get the player's chosen events (for filtering options that require previous selections)
        const playerChosenEvents = await getPlayerChosenEvents(_winner["Discord ID"]);
        
        // Select an appropriate win event based on player's loss count
        const winEventId = selectWinEvent(lossCount);
        
        if (!winEventId) {
          console.warn(`No win event found for winner ${_winner.Identification}, skipping`);
          shouldMarkAsMessaged = true; // Still mark as processed even if no win event found
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
          shouldMarkAsMessaged = true;
        }
      } catch (error) {
        console.error(
          `Error sending CYOA event to winner ${_winner.Identification} (${_winner["Discord ID"]}) for match ${match[ROWNUM]}:`,
          error,
        );
      }
    }

    // Mark the match as "Bot Messaged" after processing both loser and winner
    if (shouldMarkAsMessaged) {
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
        await checkForMatches(client);
        await delay(60_000); // Check every minute
      }
    },
    messageHandlers: [],
    interactionHandlers: [cyoaButtonHandler],
  });
}
