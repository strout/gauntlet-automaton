// Functions to read/write CYOA player state from Google Sheets
import { CONFIG } from "../../config.ts";
import { sheets, sheetsRead, sheetsAppend } from "../../sheets.ts";

export interface PlayerCyoaState {
  timestamp: string;
  name: string;
  discordId: string;
  matchResult: string; // "win" or "loss"
  wins: number;
  losses: number;
  playerMessaged: string; // "yes" or "no"
  eventChosen: string; // The event ID that was chosen
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
    const data = await sheetsRead(sheets, CONFIG.LIVE_SHEET_ID, "CYOA!A:F", "UNFORMATTED_VALUE");
    
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
          eventChosen: colIdx.event >= 0 ? String(rowArray[colIdx.event] || "") : "", // Read from "Event" column (F)
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
    "CYOA!A:F", // Only write to columns A-F as per user spec
    [[
      timestamp,
      name,
      discordId,
      "", // Match Result - empty when just sending message
      "yes", // Player Messaged
      eventId, // Event Chosen - the event that was presented
    ]],
  );
}

/**
 * Record a new CYOA entry (button choice made)
 */
export async function recordCyoaEntry(
  name: string,
  discordId: string,
  matchResult: "win" | "loss",
  eventChosen: string,
  playerMessaged: "yes" | "no" = "yes",
): Promise<void> {
  if (!CONFIG.LIVE_SHEET_ID) {
    console.warn("LIVE_SHEET_ID not configured, cannot record CYOA entry");
    return;
  }

  const timestamp = new Date().toISOString();

  await sheetsAppend(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "CYOA!A:F", // Only write to columns A-F as per user spec
    [[
      timestamp,
      name,
      discordId,
      matchResult,
      playerMessaged,
      eventChosen,
    ]],
  );
}

