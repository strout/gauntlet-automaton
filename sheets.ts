import { load } from "@std/dotenv";
import { auth, Sheets } from "sheets";
import { withRetry } from "./retry.ts";
import { GoogleApiError } from "googleapis";

export const env = await load({ export: true });

function withSmartRetry<T>(
  operation: (disable: () => void) => Promise<T>,
): Promise<T> {
  return withRetry(async (disable) => {
    try {
      return await operation(disable);
    } catch (e) {
      if (e instanceof GoogleApiError && e.code === 400) {
        // This won't succeed on a retry, so disable retries
        disable();
      }
      throw e;
    }
  });
}

/**
 * Reads values from a Google Sheets range with retry logic.
 *
 * @param sheets - Authenticated Sheets client instance
 * @param sheetId - The Google Sheets document ID
 * @param range - The range to read in A1 notation (e.g., "Sheet1!A1:C10") or R1C1 notation
 * @param valueRenderOption - How values should be rendered (default: "FORMATTED_VALUE")
 * @returns Promise that resolves to the spreadsheet values response
 */
export function sheetsRead(
  sheets: Sheets,
  sheetId: string,
  range: string,
  valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA" =
    "FORMATTED_VALUE",
) {
  return withSmartRetry(() =>
    sheets.spreadsheetsValuesGet(
      range,
      sheetId,
      { valueRenderOption },
    )
  );
}

/**
 * Writes values to a Google Sheets range with retry logic.
 *
 * @param sheets - Authenticated Sheets client instance
 * @param sheetId - The Google Sheets document ID
 * @param range - The range to write to in A1 notation (e.g., "Sheet1!A1:C10") or R1C1 notation
 * @param values - 2D array of string(?) values to write
 * @param valueInputOption - RAW strings or USER_ENTERED; RAW is default here (not sure what underlying default is)
 * @returns Promise that resolves to the update response
 */
export function sheetsWrite(
  sheets: Sheets,
  sheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption?: "RAW" | "USER_ENTERED"
) {
  return withSmartRetry(() =>
    sheets.spreadsheetsValuesUpdate(
      range,
      sheetId,
      { values },
      { valueInputOption: valueInputOption ?? "RAW" },
    )
  );
}

/**
 * Appends values to a Google Sheets range with retry logic.
 *
 * @param sheets - Authenticated Sheets client instance
 * @param sheetId - The Google Sheets document ID
 * @param range - The range to append to in A1 notation (e.g., "Sheet1!A:A") or R1C1 notation
 * @param values - 2D array of string values to append
 * @returns Promise that resolves to the append response
 */
export function sheetsAppend(
  sheets: Sheets,
  sheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption?: "RAW" | "USER_ENTERED"
) {
  return withSmartRetry(() =>
    sheets.spreadsheetsValuesAppend(
      range,
      sheetId,
      { values },
      { valueInputOption: valueInputOption ?? "RAW" },
    )
  );
}

/**
 * Global Sheets client instance. Must be initialized with `initSheets()` before use.
 * Will throw an error if accessed before initialization.
 */
export let sheets: Sheets;

/**
 * Initializes the global sheets client with application default credentials.
 *
 * @returns Promise that resolves when the sheets client is initialized
 */
export const initSheets = async () =>
  sheets ??= new Sheets((await auth.getApplicationDefault()).credential);

/**
 * Converts column letters to a zero-based column index.
 *
 * @param letters - Column letters (e.g., "A", "AB", "Z")
 * @param from - Optional starting column to calculate offset from
 * @returns Zero-based column index number
 */
export function columnIndex(letters: string, from?: string): number {
  if (!letters) {
    throw new Error("Column letters must be a non-empty string");
  }

  let val = -1;
  for (const c of letters.toUpperCase()) {
    if (c < "A" || c > "Z") {
      throw new Error(`Invalid column letter: ${c}`);
    }
    val = (val + 1) * 26;
    val += c.charCodeAt(0) - "A".charCodeAt(0);
  }
  return from ? val - columnIndex(from) : val;
}

const SHEET_TIME_ZONE_CACHE = new Map<string, string>();
export async function getSheetTimeZoneOffsetMs(sheetId: string) {
  let timeZone = SHEET_TIME_ZONE_CACHE.get(sheetId);
  if (!timeZone) {
    const info = await sheets.spreadsheetsGet(sheetId);
    timeZone = info.properties?.timeZone;
    if (!timeZone) return 0;
    SHEET_TIME_ZONE_CACHE.set(sheetId, timeZone);
  }
  return utcOffsetMs(timeZone);
}

export function readSheetsDate(date: number, offsetMs: number) {
  return new Date(
    date * 1000 * 24 * 60 * 60 + Date.UTC(1899, 11, 30) - offsetMs,
  );
}

export function utcOffsetMs(timeZone: string, date?: Date) {
  // TODO is it just coincidental that en-UK produces offsets of GMT or is it reliable?
  const dtf = Intl.DateTimeFormat("en-UK", { timeZoneName: "short", timeZone });
  const parts = dtf.formatToParts(date);
  const gmtOffset = parts.find(part => part.type === "timeZoneName")!.value;
  const match = gmtOffset.match(/([+-]\d+)(?::(\d+))?$/);
  if (!match) return 0;
  const hours = match[1];
  const minutes = match[2] ?? "0";
  return ((+hours) * 60 + (+minutes)) * 60_000;
}

/**
 * Cache for spreadsheet ID -> sheet name -> sheet GID.
 */
const SHEET_ID_CACHE = new Map<string, Map<string, number>>();

/**
 * Gets the numeric GID of a sheet by its name.
 * @param spreadsheetId The ID of the spreadsheet.
 * @param sheetName The title of the sheet.
 * @returns The numeric GID of the sheet, or undefined if not found.
 */
async function getSheetIdByName(spreadsheetId: string, sheetName: string): Promise<number | undefined> {
  let spreadsheetCache = SHEET_ID_CACHE.get(spreadsheetId);
  if (spreadsheetCache?.has(sheetName)) {
    return spreadsheetCache.get(sheetName);
  }

  const res = await withSmartRetry(() => sheets.spreadsheetsGet(spreadsheetId));
  
  if (!spreadsheetCache) {
    spreadsheetCache = new Map<string, number>();
    SHEET_ID_CACHE.set(spreadsheetId, spreadsheetCache);
  }

  for (const sheet of res.sheets ?? []) {
    if (sheet.properties?.title && sheet.properties?.sheetId != null) {
      spreadsheetCache.set(sheet.properties.title, sheet.properties.sheetId);
    }
  }

  return spreadsheetCache.get(sheetName);
}


/**
 * Deletes a row from a Google Sheet.
 *
 * @param sheets - Authenticated Sheets client instance
 * @param spreadsheetId - The Google Sheets document ID
 * @param sheetName - The name of the sheet to modify
 * @param rowIndex - The 1-based index of the row to delete
 * @returns Promise that resolves to the batch update response
 */
export function sheetsDeleteRow(
  sheets: Sheets,
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number,
) {
  return withSmartRetry(async (disable) => {
    const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
    if (sheetId === undefined) {
      const error = new Error(`Sheet with name "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
      // This is a permanent error, don't retry
      disable();
      throw error;
    }

    return sheets.spreadsheetsBatchUpdate(spreadsheetId, {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowIndex - 1, // API is 0-indexed
            endIndex: rowIndex,
          },
        },
      }],
    });
  });
}
