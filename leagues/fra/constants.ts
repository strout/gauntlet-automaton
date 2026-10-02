import { sheets, sheetsTabTitles } from "../../sheets.ts";
import { type LeagueSheet, liveSheet } from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/** FRA-only tab; its presence identifies the FRA league spreadsheet. */
export const MIRRORED_CARDS_TAB = "Mirrored Cards";

/** FRA's league spreadsheet (FRA is the live league). */
export function fraSheet(): LeagueSheet {
  return liveSheet;
}

let verifiedFraSheet: LeagueSheet | undefined;

/**
 * {@link fraSheet}, after checking it has FRA's Mirrored Cards tab so FRA
 * never writes to another league's sheet.
 *
 * @throws if LIVE_SHEET_ID has no Mirrored Cards tab
 */
export async function resolveFraSheet(): Promise<LeagueSheet> {
  if (verifiedFraSheet) return verifiedFraSheet;
  const sheet = fraSheet();
  const tabs = await sheetsTabTitles(sheets, sheet.sheetId);
  if (!tabs.includes(MIRRORED_CARDS_TAB)) {
    throw new Error(
      `LIVE_SHEET_ID ${sheet.sheetId} has no "${MIRRORED_CARDS_TAB}" tab; ` +
        `is it the FRA spreadsheet?`,
    );
  }
  verifiedFraSheet = sheet;
  return sheet;
}
