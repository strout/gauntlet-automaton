import * as djs from "discord.js";
import { delay } from "@std/async";
import { CONFIG } from "../../config.ts";
import {
  getAllMatches,
  getPlayers,
  MATCHTYPE,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  electiveRowTierFromLosses,
  getComebackElectiveCoursesFromValidated,
  resolveCoursesToScryfallQueries,
  validateElectivesSheet,
  type ValidElectiveRow,
} from "./electives-watch.ts";
import { generateAndSendComebackPack } from "./comeback-pack.ts";

const MATCH_BOT_MESSAGED_COL = "G";
const ENTROPY_BOT_MESSAGED_COL = "J";

/**
 * Polls Matches + Entropy for handled losses that have not been “bot messaged”,
 * grants a comeback pack like FIN’s post-loss automation (without FIN upgrades).
 */
export async function checkSosComebackPacksOnLoss(
  client: djs.Client,
  validSubmissions: Map<string, ValidElectiveRow[]>,
): Promise<void> {
  const { rows: records, sheetName, headerColumns } = await getAllMatches();
  const { rows: players } = await getPlayers();

  // Group records by loser name for efficient lookup
  const recordsByLoser = Object.groupBy(records, (r) => r["Loser Name"]);

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
      console.log(
        `[SOS comeback] Waiting: ${loser.Identification} needs ${tier} valid Electives submission(s) for comeback pack at loss #${lossNumber} (matches row ${
          record[ROWNUM]
        }).`,
      );
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
