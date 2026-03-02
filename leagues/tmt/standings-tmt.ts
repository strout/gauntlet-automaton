/**
 * TMT-specific sheet operations for Standings, MUTAGEN TOKENS, and Pool Pending.
 */
import { CONFIG } from "../../config.ts";
import { readTable, ROW, ROWNUM } from "../../standings.ts";
import {
  sheets,
  sheetsAppend,
  sheetsDeleteRow,
  sheetsWrite,
} from "../../sheets.ts";

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

/**
 * Retrieves Pool Pending rows for a player.
 * Columns: A=Timestamp, B=Name, C=Type ('starting pool'|'add pack'), D=Value (sealeddeck.tech pool ID)
 */
export async function getPoolPendingRows(
  playerName: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const table = await readTable(`${POOL_PENDING_SHEET_NAME}!A:D`, 1, sheetId);
  return table.rows
    .filter((r) =>
      String((r[ROW] as unknown[])?.[1] ?? "").trim() === playerName
    )
    .map((r) => {
      const raw = r[ROW] as unknown[];
      return {
        ...r,
        Timestamp: raw[0],
        Name: String(raw[1] ?? "").trim(),
        Type: String(raw[2] ?? "").trim(),
        Value: String(raw[3] ?? "").trim(),
      };
    })
    .filter((r) => r.Value.length > 0);
}

/**
 * Deletes a single row from Pool Pending.
 */
export async function deletePoolPendingRow(
  rowNum: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await sheetsDeleteRow(
    sheets,
    sheetId,
    POOL_PENDING_SHEET_NAME,
    rowNum,
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
