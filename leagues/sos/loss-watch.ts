import * as djs from "discord.js";
import { delay } from "@std/async";
import { CONFIG } from "../../config.ts";
import {
  getAllMatches,
  getPlayers,
  MATCHTYPE,
  type Player,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  electiveRowTierFromLosses,
  getComebackElectiveCoursesFromValidated,
  type IllegalReason,
  type NewlyIllegalRow,
  resolveCoursesToScryfallQueries,
  validateElectivesSheet,
  type ValidElectiveRow,
} from "./electives-watch.ts";
import { generateAndSendComebackPack } from "./comeback-pack.ts";
import { z } from "zod";

const MATCH_BOT_MESSAGED_COL = "G";
const ENTROPY_BOT_MESSAGED_COL = "J";

/**
 * Sends an elective reminder DM to a player and updates their "Reminder at Loss" cell.
 */
async function sendElectiveReminder(
  client: djs.Client,
  player: Player,
  rowNum: number,
  reminderAtLossColIndex: number,
): Promise<void> {
  const discordId = player["Discord ID"];
  if (!discordId) {
    console.warn(
      `[SOS reminder] No Discord ID for ${player.Identification}`,
    );
    return;
  }

  try {
    const user = await client.users.fetch(discordId);
    const dmChannel = await user.createDM();
    await dmChannel.send(
      "📜 **Elective Reminder**\n\nIt seems you haven't submitted your elective courses yet. Please submit your courses for the current term (see #rules-and-registration) to receive your comeback pack.",
    );
    console.log(
      `[SOS reminder] Sent elective reminder to ${player.Identification}`,
    );
  } catch (error) {
    console.error(
      `[SOS reminder] Failed to send DM to ${player.Identification}:`,
      error,
    );
  } finally {
    // Update the "Reminder at Loss" cell to mark that we've sent the reminder
    // Column "Reminder at Loss" is where we track this
    try {
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `Player Database!R${rowNum}C${reminderAtLossColIndex + 1}`,
        [[player.Losses]],
      );
      console.log(
        `[SOS reminder] Updated Reminder at Loss for ${player.Identification} to ${player.Losses}`,
      );
    } catch (error) {
      console.error(
        `[SOS reminder] Failed to update Reminder at Loss for ${player.Identification}:`,
        error,
      );
    }
  }
}

/** Human-readable explanation of why a course selection was rejected. */
function illegalReasonToMessage(row: NewlyIllegalRow): string {
  const courses = row.courses.filter((c) => c).join(", ");
  switch (row.reason) {
    case "excess":
      return `You've already submitted the maximum number of elective batches allowed at your current loss count.\n\nYour submission: ${courses}`;
    case "missing-courses":
      return `Your submission is missing one or more course selections.\n\nYour submission: ${
        courses || "(empty)"
      }`;
    case "duplicate-within-row": {
      const dups = row.duplicates?.join(", ") ?? "unknown";
      return `Your submission contains duplicate courses within the same batch.\n\nDuplicate(s): ${dups}\nYour submission: ${courses}`;
    }
    case "duplicate-across-submissions": {
      const dups = row.duplicates?.join(", ") ?? "unknown";
      return `One or more of your selected courses have already been taken in a prior submission.\n\nDuplicate(s): ${dups}\nYour submission: ${courses}`;
    }
    case "unknown-player":
      return `I couldn't match your name to a player in the roster.\n\nYour submission: ${courses}`;
    case "no-name":
      return `Your submission is missing a player name.\n\nYour submission: ${
        courses || "(empty)"
      }`;
  }
}

/**
 * Sends a non-blocking DM to a player whose elective course selection was rejected.
 * Failed DMs are logged but have no consequence.
 */
function sendElectiveRejectionDM(
  client: djs.Client,
  row: NewlyIllegalRow,
  players: readonly Player[],
): void {
  const player = players.find((p) =>
    normalizeKey(p.Identification) === normalizeKey(row.rawName) ||
    normalizeKey(p.Name) === normalizeKey(row.rawName)
  );
  const discordId = player?.["Discord ID"];
  if (!discordId) {
    console.warn(
      `[SOS rejection] No Discord ID for rejected row ${row.rowNum} (${row.rawName})`,
    );
    return;
  }

  // Fire-and-forget: failed DMs are logged but have no consequence
  (async () => {
    try {
      const user = await client.users.fetch(discordId);
      const dmChannel = await user.createDM();
      await dmChannel.send(
        `📜 **Course Selection Rejected**\n\n` +
          `Your elective course submission (row ${row.rowNum}) was rejected:\n\n` +
          `${illegalReasonToMessage(row)}\n\n` +
          `Please fix and resubmit your courses.`,
      );
      console.log(
        `[SOS rejection] Sent rejection DM to ${
          player?.Identification ?? row.rawName
        } (row ${row.rowNum})`,
      );
    } catch (error) {
      console.error(
        `[SOS rejection] Failed to send DM to ${discordId} (row ${row.rowNum}):`,
        error,
      );
    }
  })();
}

function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Polls Matches + Entropy for handled losses that have not been "bot messaged",
 * grants a comeback pack like FIN's post-loss automation (without FIN upgrades).
 */
export async function checkSosComebackPacksOnLoss(
  client: djs.Client,
  validSubmissions: Map<string, ValidElectiveRow[]>,
): Promise<void> {
  const { rows: records, sheetName, headerColumns: matchHeaderColumns } =
    await getAllMatches();
  const { rows: players, headerColumns: playerHeaderColumns } =
    await getPlayers(
      CONFIG.LIVE_SHEET_ID,
      { "Reminder at Loss": z.number().optional() },
    );

  // Group records by loser name for efficient lookup
  const recordsByLoser = Object.groupBy(records, (r) => r["Loser Name"]);
  const reminded = new Set<string>();

  for (const record of records) {
    if (record["Bot Messaged"] || !record["Script Handled"]) continue;

    const loserName = record["Loser Name"];
    const loser = players.find((p) => p.Identification === loserName);
    if (!loser) {
      console.warn(
        `[SOS comeback] Unidentified loser "${loserName}" (${
          record[MATCHTYPE] === "match" ? "match" : "entropy"
        } row ${record[ROWNUM]})`,
      );
      continue;
    }

    if (loser["TOURNAMENT STATUS"] === "Eliminated") continue;

    // Determine which loss number this match represents
    // (records is already sorted by timestamp from getAllMatches)
    const loserRecords = recordsByLoser[loserName]!;
    const lossNumber = loserRecords.indexOf(record) + 1;

    const electiveCourses = getComebackElectiveCoursesFromValidated(
      loser.Identification,
      lossNumber,
      validSubmissions,
    );
    if (electiveCourses === null) {
      const tier = electiveRowTierFromLosses(lossNumber);

      // Send reminder if losses > last reminder (blank = 0, so first loss triggers)
      const reminderAtLoss = loser["Reminder at Loss"] ?? 0;
      if (
        loser.Losses > reminderAtLoss &&
        !reminded.has(loser.Identification)
      ) {
        reminded.add(loser.Identification);
        console.log(
          `[SOS comeback] Waiting: ${loser.Identification} needs ${tier} valid Electives submission(s) for comeback pack at loss #${lossNumber} (matches row ${
            record[ROWNUM]
          }).`,
        );
        await sendElectiveReminder(
          client,
          loser,
          loser[ROWNUM],
          playerHeaderColumns["Reminder at Loss"],
        );
      }
      continue;
    }

    const electiveQueries = await resolveCoursesToScryfallQueries(
      electiveCourses,
    );
    if (electiveQueries === null) {
      console.warn(
        `[SOS comeback] Could not resolve courses to Scryfall queries for ${loser.Identification} at loss #${lossNumber}.`,
      );
      continue;
    }

    const sheetRow = record[ROWNUM];
    const cellRef = record[MATCHTYPE] === "match"
      ? `Matches!G${sheetRow}`
      : `Entropy!J${sheetRow}`;

    try {
      await generateAndSendComebackPack(
        client,
        {
          identification: loser.Identification,
          discordId: loser["Discord ID"],
          losses: lossNumber,
        },
        electiveQueries,
      );

      await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, cellRef, [["1"]]);
    } catch (error) {
      console.error(
        `[SOS comeback] Failed for ${loser.Identification} (${cellRef}):`,
        error,
      );
    }
  }
}

/** FIN-style polling interval for comeback processing. */
export async function watchSosComebackPacks(client: djs.Client): Promise<void> {
  while (true) {
    // Validate electives FIRST, then process matches with validated data (avoid race condition)
    const validationResult = await validateElectivesSheet();

    // DM players whose course selections were newly rejected (non-blocking)
    let players: readonly Player[] = [];
    try {
      const { rows } = await getPlayers();
      players = rows as unknown as readonly Player[];
    } catch (e) {
      console.error("[SOS rejection] getPlayers failed:", e);
    }
    for (const row of validationResult.newlyIllegal) {
      sendElectiveRejectionDM(client, row, players);
    }

    try {
      await checkSosComebackPacksOnLoss(
        client,
        validationResult.validSubmissions,
      );
    } catch (error) {
      console.error("[SOS periodic] checkSosComebackPacksOnLoss error:", error);
    }

    await delay(60_000);
  }
}
