import { type LeagueSheet, upcomingSheet } from "../../standings.ts";

/** Column on the Matches tab set once a row has been announced. */
export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/**
 * TRK's spreadsheet. The upcoming sheet until TRK replaces the live league,
 * so this never writes to the league that is already running.
 */
export function trkSheet(): LeagueSheet | undefined {
  return upcomingSheet;
}
