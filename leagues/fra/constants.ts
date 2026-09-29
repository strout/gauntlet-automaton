import { sheets, sheetsTabTitles } from "../../sheets.ts";
import { type LeagueSheet, liveSheet, upcomingSheet } from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/** FRA-only tab; its presence identifies the FRA league spreadsheet. */
export const MIRRORED_CARDS_TAB = "Mirrored Cards";

/**
 * Best guess at FRA's spreadsheet without a network call, for startup
 * wiring. Commands should use {@link resolveFraSheet}.
 */
export function fraSheet(): LeagueSheet {
  return upcomingSheet ?? liveSheet;
}

let resolvedFraSheet: LeagueSheet | undefined;

/**
 * FRA's league spreadsheet: whichever of UPCOMING_SHEET_ID / LIVE_SHEET_ID
 * (checked in that order) has a Mirrored Cards tab. Works both while FRA is
 * upcoming and after it goes live, even if UPCOMING_SHEET_ID is left set or
 * points at a later league.
 *
 * @throws if neither spreadsheet has the tab
 */
export async function resolveFraSheet(): Promise<LeagueSheet> {
  if (resolvedFraSheet) return resolvedFraSheet;
  const candidates =
    upcomingSheet && upcomingSheet.sheetId !== liveSheet.sheetId
      ? [upcomingSheet, liveSheet]
      : [liveSheet];
  for (const sheet of candidates) {
    const tabs = await sheetsTabTitles(sheets, sheet.sheetId);
    if (tabs.includes(MIRRORED_CARDS_TAB)) {
      console.log(`[fra] Using FRA spreadsheet ${sheet.sheetId}`);
      resolvedFraSheet = sheet;
      return sheet;
    }
  }
  throw new Error(
    `No FRA spreadsheet found: neither UPCOMING_SHEET_ID nor LIVE_SHEET_ID ` +
      `has a "${MIRRORED_CARDS_TAB}" tab`,
  );
}
