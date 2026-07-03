import { LeagueSheet, ROWNUM } from "./standings.ts";
import { sheets, sheetsWrite } from "./sheets.ts";

const announcerCache = new Map<string, MatchAnnouncer>();

/** Per-league spreadsheet helper for match rows (parameterized by {@link LeagueSheet}). */
export class MatchAnnouncer {
  constructor(
    readonly sheet: LeagueSheet,
    readonly label: string = sheet.sheetId,
  ) {}

  async markMatchHandled<
    T extends Awaited<ReturnType<LeagueSheet["getAllMatches"]>>,
    R extends T["rows"][number],
  >(
    allMatches: T,
    row: R,
    columnName: string,
    value: string | boolean = true,
  ) {
    const type = row.MATCHTYPE;
    const sheetName = allMatches.sheetName[type];
    const colIndex = allMatches.headerColumns[type][columnName];
    if (colIndex === undefined) {
      throw new Error(`Column ${columnName} not found for ${type} matches`);
    }
    const col = colIndex + 1;
    await sheetsWrite(
      sheets,
      this.sheet.sheetId,
      `${sheetName}!R${row[ROWNUM]}C${col}`,
      [[value]],
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
