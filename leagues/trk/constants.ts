import { type LeagueSheet, liveSheet } from "../../standings.ts";

/** Column on the Matches tab set once a row has been announced. */
export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/** Column on the Matches tab set once the planet menu DM has been delivered. */
export const DM_SENT_COLUMN = "DM Sent";

/** TRK's spreadsheet. TRK is the live league. */
export function trkSheet(): LeagueSheet {
  return liveSheet;
}
