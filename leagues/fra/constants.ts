import { type LeagueSheet, liveSheet, upcomingSheet } from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/**
 * FRA's league spreadsheet: UPCOMING_SHEET_ID while NXT is live, then
 * LIVE_SHEET_ID once FRA takes over. If a later league is added as upcoming
 * while FRA is live, pin this to `liveSheet`.
 */
export function fraSheet(): LeagueSheet {
  return upcomingSheet ?? liveSheet;
}
