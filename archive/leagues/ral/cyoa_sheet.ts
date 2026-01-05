// Functions to read/write CYOA player state from Google Sheets
import { CONFIG } from "../../config.ts";
import { sheets, sheetsRead, sheetsAppend, sheetsWrite } from "../../sheets.ts";

export interface PlayerCyoaState {
  timestamp: string;
  name: string;
  discordId: string;
  matchResult: string; // "win" or "loss"
  wins: number;
  losses: number;
  playerMessaged: string; // "yes" or "no"
  event: string; // Column F: The event ID that was triggered
  eventChosen: string; // Column G: The next event ID (Next Event)
  rowNum: number;
}

/**
 * Get all CYOA entries for a player by Discord ID
 */
export async function getPlayerCyoaHistory(
  discordId: string,
): Promise<PlayerCyoaState[]> {
  if (!CONFIG.LIVE_SHEET_ID) {
    console.warn("LIVE_SHEET_ID not configured");
    return [];
  }

  try {
    // Read raw data to handle missing columns gracefully
    const data = await sheetsRead(sheets, CONFIG.LIVE_SHEET_ID, "CYOA!A:G", "UNFORMATTED_VALUE");
    
    if (!data.values || data.values.length < 2) {
      // Empty sheet or only headers
      return [];
    }

    const headers = (data.values[0] as string[]).map(h => String(h || "").trim());
    const rows = data.values.slice(1);

    // Find column indices
    const colIdx = {
      timestamp: headers.indexOf("Timestamp"),
      name: headers.indexOf("Your Name"),
      discordId: headers.indexOf("Discord ID"),
      matchResult: headers.indexOf("Match Result"),
      playerMessaged: headers.indexOf("Player Messaged"),
      event: headers.indexOf("Event"),
      eventChosen: headers.indexOf("Next Event"),
    };

    return rows
      .map((row, idx) => {
        const rowArray = row as string[];
        const discordIdValue = colIdx.discordId >= 0 ? String(rowArray[colIdx.discordId] || "") : "";
        
        if (discordIdValue !== discordId) {
          return null; // Filter out rows that don't match
        }

        const matchResult = colIdx.matchResult >= 0 ? String(rowArray[colIdx.matchResult] || "") : "";
        
        return {
          timestamp: colIdx.timestamp >= 0 ? String(rowArray[colIdx.timestamp] || "") : "",
          name: colIdx.name >= 0 ? String(rowArray[colIdx.name] || "") : "",
          discordId: discordIdValue,
          matchResult: matchResult,
          wins: matchResult === "win" ? 1 : 0,
          losses: matchResult === "loss" ? 1 : 0,
          playerMessaged: colIdx.playerMessaged >= 0 ? String(rowArray[colIdx.playerMessaged] || "no") : "no",
          event: colIdx.event >= 0 ? String(rowArray[colIdx.event] || "") : "", // Column F: Event that was triggered
          eventChosen: colIdx.eventChosen >= 0 ? String(rowArray[colIdx.eventChosen] || "") : "", // Column G: Next Event
          rowNum: idx + 2, // +2 because row 1 is headers, and arrays are 0-indexed
        };
      })
      .filter((entry): entry is PlayerCyoaState => entry !== null);
  } catch (error) {
    console.error("Error reading CYOA sheet:", error);
    return [];
  }
}

/**
 * Get all events chosen by a player (for checking requiredSelections)
 */
export async function getPlayerChosenEvents(
  discordId: string,
): Promise<string[]> {
  const history = await getPlayerCyoaHistory(discordId);
  return history
    .filter((entry) => entry.eventChosen)
    .map((entry) => entry.eventChosen);
}

/**
 * Get the most recently sent event that doesn't have a choice yet
 * Returns the row number if found, null otherwise
 */
export async function getMostRecentEventSentWithoutChoice(
  discordId: string,
): Promise<{ eventId: string; rowNum: number } | null> {
  const history = await getPlayerCyoaHistory(discordId);
  // Sort by timestamp (most recent first) and find the first entry with an event but no eventChosen
  const sortedHistory = [...history].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA; // Most recent first
  });
  
  const mostRecent = sortedHistory.find((entry) => entry.event && !entry.eventChosen);
  if (mostRecent) {
    return { eventId: mostRecent.event, rowNum: mostRecent.rowNum };
  }
  return null;
}

/**
 * Get the most recently chosen event for a player
 */
export async function getMostRecentChosenEvent(
  discordId: string,
): Promise<string | null> {
  const history = await getPlayerCyoaHistory(discordId);
  console.log(`[CYOA] History for ${discordId}:`, history);
  // Sort by timestamp (most recent first) and find the first entry with an eventChosen
  const sortedHistory = [...history].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA; // Most recent first
  });
  
  const mostRecent = sortedHistory.find((entry) => entry.eventChosen);
  return mostRecent?.eventChosen || null;
}

/**
 * Get the most recent loss event's Next Event value
 * This is used when a win event has no nextEvent to determine what to send on the next loss
 */
export async function getMostRecentLossEventChosen(
  discordId: string,
): Promise<string | null> {
  const history = await getPlayerCyoaHistory(discordId);
  // Sort by timestamp (most recent first) and find the first entry with matchResult="loss" and eventChosen
  const sortedHistory = [...history].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return timeB - timeA; // Most recent first
  });
  
  const mostRecentLoss = sortedHistory.find((entry) => entry.matchResult === "loss" && entry.eventChosen);
  return mostRecentLoss?.eventChosen || null;
}

/**
 * Check if a DM has already been sent to a player for a specific event
 */
export async function hasEventBeenSent(
  discordId: string,
  eventId: string,
): Promise<boolean> {
  const history = await getPlayerCyoaHistory(discordId);
  // Check if there's an entry where playerMessaged="yes" and eventChosen matches the eventId
  return history.some(
    (entry) => entry.playerMessaged === "yes" && entry.eventChosen === eventId
  );
}

/**
 * Record when a DM is sent to a player (event presented)
 */
export async function recordCyoaMessageSent(
  name: string,
  discordId: string,
  eventId: string,
): Promise<void> {
  if (!CONFIG.LIVE_SHEET_ID) {
    console.warn("LIVE_SHEET_ID not configured, cannot record CYOA message");
    return;
  }

  const timestamp = new Date().toISOString();

  await sheetsAppend(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "CYOA!A:G", // Write to columns A-G
    [[
      timestamp,
      name,
      discordId,
      "", // Match Result - empty when just sending message
      "yes", // Player Messaged
      eventId, // Column F: Event - the event that was triggered/presented
      "", // Column G: Next Event - empty when just sending message
    ]],
  );
}

/**
 * Update an existing CYOA entry with the player's choice
 * Updates the Match Result (column D) and Next Event (column G) columns
 */
export async function updateCyoaEntryChoice(
  rowNum: number,
  matchResult: "win" | "loss",
  eventChosen: string, // Column G: The next event ID (Next Event)
): Promise<void> {
  if (!CONFIG.LIVE_SHEET_ID) {
    console.warn("LIVE_SHEET_ID not configured, cannot update CYOA entry");
    return;
  }

  // Update Match Result (column D) and Next Event (column G) separately
  // Using two separate writes to avoid overwriting columns E (Player Messaged) and F (Event)
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    `CYOA!D${rowNum}`,
    [[matchResult]],
  );
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    `CYOA!G${rowNum}`,
    [[eventChosen]],
  );
}

