import { type LeagueSheet, liveSheet, upcomingSheet } from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/** Prefer upcoming sheet while NXT is not yet the live league. */
export function nxtSheet(): LeagueSheet {
  return upcomingSheet ?? liveSheet;
}
