import { type LeagueSheet, liveSheet, upcomingSheet } from "../../standings.ts";

/** Cube code for The Hobbit on Booster Tutor. */
export const HOBBIT_CUBE = "HOBX";

/** Starting pool: six packs from the Hobbit cube. */
export const HOBBIT_STARTING_POOL_CMD = `!cube ${HOBBIT_CUBE} 6`;

/** Comeback / loss pack: one pack from the Hobbit cube. */
export const HOBBIT_COMEBACK_PACK_CMD = `!cube ${HOBBIT_CUBE}`;

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";
export const COMPANY_REWARD_PROCESSED_COLUMN = "Company Reward Processed";

/** Prefer upcoming sheet while Hobbit is not yet the live league. */
export function hobbitSheet(): LeagueSheet {
  return upcomingSheet ?? liveSheet;
}
