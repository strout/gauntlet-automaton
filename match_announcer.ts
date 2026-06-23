import { LeagueSheet } from "./standings.ts";
import { sheets, sheetsWrite } from "./sheets.ts";

const announcerCache = new Map<string, MatchAnnouncer>();

/** Per-league spreadsheet helper for match rows (parameterized by {@link LeagueSheet}). */
export class MatchAnnouncer {
  constructor(
    readonly sheet: LeagueSheet,
    readonly label: string = sheet.sheetId,
  ) {}

  async markMatchHandled(
    rowNum: number,
    columnIndex: number,
    status: string | boolean = true,
  ) {
    const col = columnIndex + 1;
    await sheetsWrite(
      sheets,
      this.sheet.sheetId,
      `Matches!R${rowNum}C${col}`,
      [[status]],
      "RAW",
    );
  }
}

/** Returns a cached {@link MatchAnnouncer} for the given spreadsheet. */
export function getMatchAnnouncer(
  sheet: LeagueSheet,
  label?: string,
): MatchAnnouncer {
  const key = label ?? sheet.sheetId;
  let announcer = announcerCache.get(key);
  if (!announcer) {
    announcer = new MatchAnnouncer(sheet, key);
    announcerCache.set(key, announcer);
  }
  return announcer;
}
