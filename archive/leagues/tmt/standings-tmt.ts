/**
 * TMT-specific sheet operations for Standings, MUTAGEN TOKENS, and Pool Pending.
 */
import { CONFIG } from "../../../config.ts";
import { readTable, ROW, ROWNUM } from "../../../standings.ts";
import { sheets, sheetsAppend, sheetsWrite } from "../../../sheets.ts";

const POOL_PENDING_SHEET_NAME = "Pool Pending";
const PLAYER_DATABASE_SHEET_NAME = "Player Database";

/** Finds the MUTAGEN TOKENS column index by header name (exact or flexible match). */
function findMutagenTokensColumn(headers: string[]): number | undefined {
  const exact = headers.indexOf("MUTAGEN TOKENS");
  if (exact >= 0) return exact;
  const lower = "mutagen tokens";
  const idx = headers.findIndex((h) =>
    String(h ?? "").trim().toLowerCase() === lower
  );
  return idx >= 0 ? idx : undefined;
}

function columnIndexToLetter(idx: number): string {
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Gets the MUTAGEN TOKENS count for a player from the Player Database sheet.
 * Looks up the column by header name and the row by Identification/Name.
 * Returns 0 if the column or player is not found.
 */
export async function getMutagenTokens(
  playerName: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
): Promise<number> {
  const table = await readTable(
    `${PLAYER_DATABASE_SHEET_NAME}!A:AZ`,
    1,
    sheetId,
  );
  const nameCol = table.headerColumns["Identification"] ??
    table.headerColumns["Name"];
  const tokensCol = findMutagenTokensColumn(table.headers);
  if (nameCol === undefined || tokensCol === undefined) return 0;

  const normalizedPlayer = playerName.trim();
  const row = table.rows.find((r) => {
    const cellVal = String((r[ROW] as unknown[])?.[nameCol] ?? "").trim();
    return cellVal === normalizedPlayer;
  });
  if (!row) return 0;

  const raw = row[ROW] as unknown[];
  const val = raw[tokensCol];
  const n = typeof val === "number" ? val : parseInt(String(val ?? "0"), 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Decrements MUTAGEN TOKENS by 1 for a player in the Player Database sheet.
 */
export async function decrementMutagenTokens(
  playerName: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
): Promise<void> {
  const table = await readTable(
    `${PLAYER_DATABASE_SHEET_NAME}!A:AZ`,
    1,
    sheetId,
  );
  const nameCol = table.headerColumns["Identification"] ??
    table.headerColumns["Name"];
  const tokensCol = findMutagenTokensColumn(table.headers);
  if (nameCol === undefined || tokensCol === undefined) return;

  const normalizedPlayer = playerName.trim();
  const row = table.rows.find((r) => {
    const cellVal = String((r[ROW] as unknown[])?.[nameCol] ?? "").trim();
    return cellVal === normalizedPlayer;
  });
  if (!row) return;

  const raw = row[ROW] as unknown[];
  const val = raw[tokensCol];
  const n = typeof val === "number" ? val : parseInt(String(val ?? "0"), 10);
  const next = Math.max(0, (isNaN(n) ? 0 : n) - 1);

  const colLetter = columnIndexToLetter(tokensCol);
  const range = `${PLAYER_DATABASE_SHEET_NAME}!${colLetter}${row[ROWNUM]}`;
  await sheetsWrite(sheets, sheetId, range, [[next]]);
}

/** Column indices for Pool Pending: A=0 Timestamp, B=1 Name, C=2 Type, D=3 Value, F=5 DMed, G=6 Completed */
const POOL_PENDING_DMED_COL = 5;
const POOL_PENDING_COMPLETED_COL = 6;

function parseBool(val: unknown): boolean {
  if (val === true || val === "TRUE" || val === "true" || val === 1) return true;
  const s = String(val ?? "").trim().toUpperCase();
  return s === "TRUE" || s === "YES" || s === "1";
}

/**
 * Retrieves all Pool Pending rows (excludes Completed=TRUE rows).
 * Use this to fetch once and filter by player in memory to reduce API calls.
 * Columns: A=Timestamp, B=Name, C=Type, D=Value, F=DMed, G=Completed
 */
export async function getAllPoolPendingRows(
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const table = await readTable(`${POOL_PENDING_SHEET_NAME}!A:G`, 1, sheetId);
  return table.rows
    .filter((r) => {
      const raw = r[ROW] as unknown[];
      if (!String(raw[3] ?? "").trim()) return false;
      if (parseBool(raw[POOL_PENDING_COMPLETED_COL])) return false;
      return true;
    })
    .map((r) => {
      const raw = r[ROW] as unknown[];
      return {
        ...r,
        Timestamp: raw[0],
        Name: String(raw[1] ?? "").trim(),
        Type: String(raw[2] ?? "").trim(),
        Value: String(raw[3] ?? "").trim(),
        DMed: parseBool(raw[POOL_PENDING_DMED_COL]),
        Completed: parseBool(raw[POOL_PENDING_COMPLETED_COL]),
      };
    });
}

/**
 * Retrieves Pool Pending rows for a player (excludes Completed=TRUE rows).
 * Columns: A=Timestamp, B=Name, C=Type, D=Value, F=DMed, G=Completed
 */
export async function getPoolPendingRows(
  playerName: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const allRows = await getAllPoolPendingRows(sheetId);
  const normalized = playerName.trim();
  return allRows.filter((r) => r.Name === normalized);
}

/**
 * Returns Pool Pending rows where both DMed and Completed are empty/false.
 * Used by the minute listener to find rows that need DMs sent.
 */
export async function getUnaddressedPoolPendingRows(
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const table = await readTable(`${POOL_PENDING_SHEET_NAME}!A:G`, 1, sheetId);
  return table.rows
    .filter((r) => {
      const raw = r[ROW] as unknown[];
      if (!String(raw[3] ?? "").trim()) return false;
      if (parseBool(raw[POOL_PENDING_COMPLETED_COL])) return false;
      if (parseBool(raw[POOL_PENDING_DMED_COL])) return false;
      return true;
    })
    .map((r) => {
      const raw = r[ROW] as unknown[];
      return {
        ...r,
        Timestamp: raw[0],
        Name: String(raw[1] ?? "").trim(),
        Type: String(raw[2] ?? "").trim(),
        Value: String(raw[3] ?? "").trim(),
      };
    });
}

/**
 * Marks the DMed column (F) as TRUE for a Pool Pending row.
 */
export async function markPoolPendingDMed(
  rowNum: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const colLetter = columnIndexToLetter(POOL_PENDING_DMED_COL);
  await sheetsWrite(
    sheets,
    sheetId,
    `${POOL_PENDING_SHEET_NAME}!${colLetter}${rowNum}`,
    [[true]],
  );
}

/**
 * Marks the DMed column (F) as TRUE for rows matching the given pool IDs for a player.
 */
export async function markPoolPendingDMedForPacks(
  playerName: string,
  poolIds: string[],
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const table = await readTable(`${POOL_PENDING_SHEET_NAME}!A:G`, 1, sheetId);
  const normalized = playerName.trim();
  const colLetter = columnIndexToLetter(POOL_PENDING_DMED_COL);
  for (const row of table.rows) {
    const raw = row[ROW] as unknown[];
    if (String(raw[1] ?? "").trim() !== normalized) continue;
    const val = String(raw[3] ?? "").trim();
    if (!poolIds.includes(val)) continue;
    await sheetsWrite(
      sheets,
      sheetId,
      `${POOL_PENDING_SHEET_NAME}!${colLetter}${row[ROWNUM]}`,
      [[true]],
    );
  }
}

/**
 * Marks the Completed column (G) as TRUE for a Pool Pending row.
 */
export async function markPoolPendingCompleted(
  rowNum: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const colLetter = columnIndexToLetter(POOL_PENDING_COMPLETED_COL);
  await sheetsWrite(
    sheets,
    sheetId,
    `${POOL_PENDING_SHEET_NAME}!${colLetter}${rowNum}`,
    [[true]],
  );
}

/**
 * Appends rows to Pool Pending.
 * Columns: A=Timestamp, B=Name, C=Type, D=Value (sealeddeck.tech pool ID)
 */
export async function appendToPoolPending(
  values: unknown[][],
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await sheetsAppend(
    sheets,
    sheetId,
    `${POOL_PENDING_SHEET_NAME}!A:D`,
    values,
  );
}
