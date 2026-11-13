import { sheets, sheetsTabTitles } from "../../../sheets.ts";
import { archiveSheets, type LeagueSheet } from "../../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/** FRA-only tab; its presence identifies the FRA league spreadsheet. */
export const MIRRORED_CARDS_TAB = "Mirrored Cards";

/** FRA's archived spreadsheet. */
export function fraSheet(): LeagueSheet {
  const sheet = archiveSheets[0];
  if (!sheet) {
    throw new Error("FRA spreadsheet is not in ARCHIVE_SHEET_IDS");
  }
  return sheet;
}

let verifiedFraSheet: LeagueSheet | undefined;

/**
 * {@link fraSheet}, after checking it has FRA's Mirrored Cards tab so FRA
 * never writes to another league's sheet.
 *
 * @throws if the archived sheet has no Mirrored Cards tab
 */
export async function resolveFraSheet(): Promise<LeagueSheet> {
  if (verifiedFraSheet) return verifiedFraSheet;
  const sheet = fraSheet();
  const tabs = await sheetsTabTitles(sheets, sheet.sheetId);
  if (!tabs.includes(MIRRORED_CARDS_TAB)) {
    throw new Error(
      `Archived FRA sheet ${sheet.sheetId} has no "${MIRRORED_CARDS_TAB}" tab.`,
    );
  }
  verifiedFraSheet = sheet;
  return sheet;
}
