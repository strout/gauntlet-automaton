import { CONFIG } from "./main.ts";
import { fetchSealedDeck, makeSealedDeck, splitCardNames } from "./sealeddeck.ts";
import { columnIndex, sheets, sheetsAppend, sheetsRead } from "./sheets.ts";

// TODO read column names from the header row instead of hardcoding

export const ROW = Symbol("ROW");
export const ROWNUM = Symbol("ROWNUM");

// TODO use this & something to assert particular columns exist, rather than relying on changing column indices over and over.
export async function readTable(range: string, headerRowNum = 1, sheetId = CONFIG.LIVE_SHEET_ID) {
  const data = await sheetsRead(sheets, sheetId, range);
  const [headerRow, ...rows] = data.values!.slice(headerRowNum - 1);
  const parsedRows = rows.map((r, rowOffset) => {
    const ret: { [key: string]: unknown, [ROW]: unknown[], [ROWNUM]: number } = {
      [ROW]: r,
      [ROWNUM]: rowOffset + 1 + headerRowNum,
    };
    for (let i = 0; i < r.length && i < headerRow.length; i++) {
      ret[headerRow[i]] ??= r[i];
    }
    return ret;
  });
  // headers maps names to their lowest index and all indices to names
  const headers = headerRow;
  const headerColumns: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    headerColumns[headerRow[i]] ??= i;
  }
  return { rows: parsedRows, headers, headerColumns };
}

/**
 * Gets the current week number from the spreadsheet.
 * @returns The current week number
 */
export async function getCurrentWeek() {
  return +(await sheetsRead(sheets, CONFIG.LIVE_SHEET_ID, "Quotas!B2"))
    .values![0][0];
}

/**
 * Adds a single pool change to the spreadsheet.
 * @param name - Player name
 * @param type - Type of change (e.g., "add pack", "remove card")
 * @param value - Value of the change (pack ID, card name, etc.)
 * @param comment - Comment explaining the change
 * @param newPoolId - Optional new pool ID
 */
export const addPoolChange = (
  name: string,
  type: string,
  value: string,
  comment: string,
  newPoolId?: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
) => addPoolChanges([[name, type, value, comment, ...[newPoolId].filter(Boolean) as [newPoolId?: string]]], sheetId);

/**
 * Adds multiple pool changes to the spreadsheet with timestamps.
 * @param changes - Array of pool changes to add
 */
export async function addPoolChanges(
  changes: [name: string, type: string, value: string, comment: string, newPoolId?: string][],
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  const timestamp = new Date().toISOString();
  await sheetsAppend(
    sheets,
    sheetId,
    "Pool Changes!A1:F",
    changes.map((c) => [timestamp, ...c as string[]]),
  );
}

/**
 * Retrieves all pool changes from the spreadsheet.
 * @returns Pool change records with metadata and original row data
 */
export async function getPoolChanges(sheetId = CONFIG.LIVE_SHEET_ID) {
  return (await sheetsRead(sheets, sheetId, "Pool Changes!A2:F"))
    .values
    ?.map((
      row,
      index,
    ) => ({
      rowNum: index + 2,
      timestamp: row[0] as string | number,
      name: row[1] as string,
      type: row[2] as string,
      value: row[3] as string,
      comment: row[4] as string,
      fullPool: row[5] as string | undefined,
      row,
    })) ?? [];
}

/**
 * Rebuilds a sealed deck pool based on a series of changes and optional base pool.
 * @param entries - Timestamped pool change entries. The timestamps are for type compatibility with {@link getPoolChanges} and are ignored.
 * @param basePoolId - Optional base pool ID to start from
 * @returns The complete rebuilt SealedDeck pool with all sections
 */
export async function rebuildPool(
  entries: [timestamp: number, name: string, type: string, value: string][],
  basePoolId?: string | undefined,
) {
  const sideboard = await rebuildPoolContents(entries);
  const poolId = await makeSealedDeck({ sideboard }, basePoolId);
  return await fetchSealedDeck(poolId);
}

/**
 * Rebuilds pool contents (sideboard) based on a series of changes.
 * Processes pack additions/removals and individual card changes.
 * @param entries - Array of timestamped pool change entries
 * @returns Cards with their counts for the sideboard
 */
export async function rebuildPoolContents(
  entries: [
    timestamp: number | string,
    name: string,
    type: string,
    value: string,
  ][],
) {
  const packs: string[] = [];
  const removedPacks: string[] = [];
  const cards = new Map<string, number>();
  for (const e of entries) {
    switch (e[2]) {
      case "starting pool":
      case "add pack": {
        packs.push(e[3]);
        break;
      }
      case "remove pack": {
        const idx = packs.indexOf(e[3]);
        if (idx >= 0) packs.splice(idx, 1);
        else removedPacks.push(e[3]);
        break;
      }
      case "add card": {
        const name = splitCardNames.has(e[3].split(" //")[0]) ? e[3] : e[3].split(" //")[0];
        cards.set(name, (cards.get(name) ?? 0) + 1);
        break;
      }
      case "remove card": {
        const name = splitCardNames.has(e[3].split(" //")[0]) ? e[3] : e[3].split(" //")[0];
        cards.set(name, (cards.get(name) ?? 0) - 1);
        break;
      }
    }
  }
  for (const p of packs) {
    const contents = await fetchSealedDeck(p);
    for (
      const card of [
        ...contents.deck,
        ...contents.sideboard,
        ...contents.hidden,
      ]
    ) {
      cards.set(card.name, (cards.get(card.name) ?? 0) + card.count);
    }
  }
  for (const p of removedPacks) {
    const contents = await fetchSealedDeck(p);
    for (
      const card of [
        ...contents.deck,
        ...contents.sideboard,
        ...contents.hidden,
      ]
    ) {
      cards.set(card.name, (cards.get(card.name) ?? 0) - card.count);
    }
  }
  const sideboard = [...cards.entries()].filter((x) => x[1] > 0).map((
    [name, count],
  ) => ({
    name,
    count,
  }));
  return sideboard;
}

/**
 * Gets all players from the Player Database sheet.
 * @returns Player records with stats and metadata
 */
export async function getPlayers(sheetId = CONFIG.LIVE_SHEET_ID) {
  const LAST_COLUMN = "AI";
  const range = await sheetsRead(
    sheets,
    sheetId,
    "Player Database!A2:" + LAST_COLUMN,
  );
  return range.values?.map((row, i) => ({
    rowNum: i + 2,
    name: row[columnIndex("B")] as string,
    id: row[columnIndex("D")] as string,
    matchesPlayed: +row[columnIndex("G")],
    wins: +row[columnIndex("H")],
    losses: +row[columnIndex("I")],
    matchesToPlay: row[columnIndex("W")] as string,
    status: row[columnIndex("V")] as string,
    surveySent: !!+row[columnIndex("Z")],
    row,
  })).filter((x) => x.id) ?? [];
}

let quotas: undefined | {
  matchesMin: number;
  matchesMax: number;
  week: number;
  fromDate: number;
  toDate: number;
}[] = undefined;

/**
 * Gets quota information for different weeks.
 * @returns Weekly quota configurations with match requirements and date ranges
 */
export async function getQuotas() {
  return quotas ??= (await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Quotas!A9:E14",
    "UNFORMATTED_VALUE",
  )).values?.map(
    (x) => ({
      week: +x[columnIndex("A")],
      fromDate: x[columnIndex("B")],
      toDate: x[columnIndex("C")],
      matchesMin: +x[columnIndex("D")],
      matchesMax: +x[columnIndex("E")],
    }),
  ) ?? [];
}

/**
 * Gets all match results from the Matches sheet.
 * @returns Match records with results and metadata
 */
export async function getMatches() {
  const LAST_COLUMN = "L";
  return (await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Matches!A2:" + LAST_COLUMN,
    "UNFORMATTED_VALUE",
  ))
    .values?.map((row, i) => ({
      matchRowNum: i + 2,
      timestamp: +row[columnIndex("A")],
      winner: row[columnIndex("B")] as string,
      loser: row[columnIndex("C")] as string,
      result: row[columnIndex("D")] as string,
      notes: row[columnIndex("G")] as string,
      scriptHandled: row[columnIndex("F")] == "1",
      botMessaged: row[columnIndex("G")] == "1",
      matchType: 'match' as const,
      row,
    })).filter((x) => x.winner && x.loser) ?? [];
}

/**
 * Gets entropy data from the Entropy sheet.
 * @returns Entropy match records with timing and results
 */
export async function getEntropy() {
  const LAST_COLUMN = "J";
  return (await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Entropy!A5:" + LAST_COLUMN,
    "UNFORMATTED_VALUE",
  ))
    .values?.map((row, i) => ({
      entropyRowNum: i + 5,
      week: +row[columnIndex("B")],
      winner: row[columnIndex("C")] as string,
      loser: row[columnIndex("D")] as string,
      result: row[columnIndex("G")] as string,
      timestamp: +row[columnIndex("I")],
      botMessaged: row[columnIndex("J")] == "1",
      matchType: 'entropy' as const,
      scriptHandled: true,
      row,
    })).filter((x) => x.winner && x.loser) ?? [];
}

/**
 * Gets all pools from the Pools sheet.
 * @deprecated {@link getPoolChanges} now includes the pool ID with most entries and programmatic access to the Pools sheet is discouraged.
 * @returns Pool records with player associations and deck links
 */
export async function getPools() {
  const range = await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Pools!C7:H",
  );
  return range.values?.map((row, i) => ({
    rowNum: i + 7,
    name: row[columnIndex("D", "C")] as string,
    id: row[columnIndex("C", "C")] as string,
    wins: +row[columnIndex("E", "C")] as number,
    losses: +row[columnIndex("F", "C")] as number,
    currentPoolLink: row[columnIndex("H", "C")] as string,
    initialPoolLink: row[columnIndex("I", "C")] as string,
    row,
  })).filter((x) => x.id) ?? [];
}

/**
 * Gets the expected pool for a player, comparing expected vs actual pool contents.
 * If there's a mismatch, creates a new pool with the expected contents.
 * @param name - Player name
 * @param poolsSheet - Optional pre-fetched pools data
 * @param poolsChangesSheet - Optional pre-fetched pool changes data
 * @returns URL to the player's correct pool (existing or newly created)
 */
export async function getExpectedPool(
  name: string,
  poolsSheet?: Awaited<ReturnType<typeof getPools>>,
  poolsChangesSheet?: Awaited<ReturnType<typeof getPoolChanges>>,
) {
  poolsSheet ??= await getPools();
  poolsChangesSheet ??= await getPoolChanges();
  const changesForName = poolsChangesSheet.filter((x) => x.name === name);
  const currentPoolId = poolsSheet.find((row) => row.name === name)
    ?.currentPoolLink.split(".tech/")[1];
  const expected = await rebuildPoolContents(
    changesForName.map((x) => [x.timestamp, x.name, x.type, x.value]),
  );
  const actual = currentPoolId ? await fetchSealedDeck(currentPoolId) : null;
  const expectedMap = Map.groupBy(
    expected.flatMap((x) => new Array<string>(x.count).fill(x.name)),
    (x) => x,
  );
  const actualMap = actual && Map.groupBy(
    actual.sideboard.flatMap((x) => new Array<string>(x.count).fill(x.name)),
    (x) => x,
  );
  let ok = true;
  for (
    const name of new Set([...expectedMap.keys(), ...actualMap?.keys() ?? []])
  ) {
    const exp = expectedMap.get(name)?.length ?? 0;
    const act = actualMap?.get(name)?.length ?? 0;
    if (exp !== act) {
      console.log(name + ": Expected " + exp + " but got " + act);
      ok = false;
    }
  }
  const poolId = ok
    ? currentPoolId
    : (await makeSealedDeck({ sideboard: expected }));
  return "https://sealeddeck.tech/" + poolId;
}
