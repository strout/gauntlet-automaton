import { CONFIG } from "../../config.ts";
import {
  getLeagueSheet,
  type LeagueSheet,
  upcomingSheet,
} from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

/**
 * Reality Fracture spreadsheet when available; otherwise the registration
 * workbook so FRA scaffolding can run before a standings sheet exists.
 */
export function fraSheet(): LeagueSheet {
  if (upcomingSheet) return upcomingSheet;
  return getLeagueSheet(CONFIG.REGISTRATION_SHEET_ID);
}
