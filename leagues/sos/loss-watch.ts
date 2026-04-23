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
import { validateElectivesSheet } from "./electives-watch.ts";
import {
  electiveRowTierFromLosses,
  getComebackElectiveScryfallQueries,
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
): Promise<void> {
  const { rows: records } = await getAllMatches();
  const { rows: players } = await getPlayers();

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

    const losses = Number(loser.Losses);
    const electiveQueries = await getComebackElectiveScryfallQueries(
      loser.Identification,
      Number.isFinite(losses) ? losses : 0,
    );
    if (electiveQueries === null) {
      console.log(
        `[SOS comeback] Waiting: no valid Electives row (ERROR clear) for ${loser.Identification} at elective tier ${
          electiveRowTierFromLosses(Number.isFinite(losses) ? losses : 0)
        } (matches row ${record[ROWNUM]}).`,
      );
      continue;
    }

    const sheetRow = record[ROWNUM];
    const cellRef = record[MATCHTYPE] === "entropy"
      ? `Entropy!${ENTROPY_BOT_MESSAGED_COL}${sheetRow}`
      : `Matches!${MATCH_BOT_MESSAGED_COL}${sheetRow}`;

    try {
      await generateAndSendComebackPack(
        client,
        {
          identification: loser.Identification,
          discordId: loser["Discord ID"],
          losses: Number.isFinite(losses) ? losses : 0,
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
    const results = await Promise.allSettled([
      checkSosComebackPacksOnLoss(client),
      validateElectivesSheet(),
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[SOS periodic] task error:", r.reason);
      }
    }
    await delay(60_000);
  }
}
