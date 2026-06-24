import { CONFIG } from "./config.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  splitCardNames,
} from "./sealeddeck.ts";
import {
  columnIndex,
  getSheetTimeZoneOffsetMs,
  readSheetsDate,
  sheets,
  sheetsAppend,
  sheetsDeleteRow,
  sheetsRead,
  sheetsWrite,
  writeSheetsDate,
} from "./sheets.ts";
import { z } from "zod";

// TODO read column names from the header row instead of hardcoding

// Would like these to be symbols but Zod eats them https://github.com/colinhacks/zod/issues/2734
export const ROW = "ROW";
export const ROWNUM = "ROWNUM";
export const MATCHTYPE = "MATCHTYPE";

const POOL_CHANGES_SHEET_NAME = "Pool Changes";

const playerShape = {
  Identification: z.string(),
  Name: z.string(),
  "Arena ID": z.string(),
  "Discord ID": z.coerce.string(),
  "Matches played": z.number(),
  Wins: z.number(),
  Losses: z.number(),
  "MATCHES TO PLAY STATUS": z.string(),
  "TOURNAMENT STATUS": z.string(),
  "Survey Sent": z.coerce.boolean(),
  Streak: z.coerce.number().optional(),
};

export type Player<S extends z.ZodRawShape = Record<never, never>> = z.infer<
  z.ZodObject<typeof playerShape & S>
>;
export type Table<T> = {
  rows: (T & { [ROW]: unknown[]; [ROWNUM]: number })[];
  headers: string[];
  headerColumns: Partial<Record<string, number>> & Record<keyof T, number>;
};

type QuotaInfo = {
  matchesMin: number;
  matchesMax: number;
  week: number;
  fromDate: number;
  toDate: number;
};

export function tableSchema<
  S extends z.ZodRawShape,
>(rowShape: S) {
  const keys = Object.keys(rowShape) as (keyof S & string)[];
  const schema = z.object({
    rows: z.array(
      z.object({ ...rowShape, [ROW]: z.array(z.any()), [ROWNUM]: z.number() }),
    ),
    headers: z.array(z.string()).refine((s) =>
      keys.every((k) => s.includes(k))
    ),
    headerColumns: z.object(
      Object.fromEntries(keys.map((x) => [x, z.number()])),
    ).and(
      z.partialRecord(z.string(), z.number()),
    ),
  });
  return schema;
}

export function parseTable<S extends z.ZodRawShape>(
  rowShape: S,
  table: Awaited<ReturnType<LeagueSheet["readTable"]>>,
) {
  const schema = tableSchema(rowShape);
  return schema.parse(table);
}

const sheetCache = new Map<string, LeagueSheet>();

/** Returns a cached {@link LeagueSheet} for the given spreadsheet ID. */
export function getLeagueSheet(sheetId: string): LeagueSheet {
  let sheet = sheetCache.get(sheetId);
  if (!sheet) {
    sheet = new LeagueSheet(sheetId);
    sheetCache.set(sheetId, sheet);
  }
  return sheet;
}

/** Spreadsheet operations for a single league season. */
export class LeagueSheet {
  #quotas: QuotaInfo[] | undefined;

  constructor(readonly sheetId: string) {}

  // TODO use this & something to assert particular columns exist, rather than relying on changing column indices over and over.
  async readTable(range: string, headerRowNum = 1) {
    const data = await sheetsRead(
      sheets,
      this.sheetId,
      range,
      "UNFORMATTED_VALUE",
    );
    const [headerRow, ...rows] = data.values!;
    const parsedRows = rows.map((r, rowOffset) => {
      const ret: {
        [key: string]: unknown;
        [ROW]: unknown[];
        [ROWNUM]: number;
      } = {
        [ROW]: r,
        [ROWNUM]: rowOffset + 1 + headerRowNum,
      };
      for (let i = 0; i < r.length && i < headerRow.length; i++) {
        ret[headerRow[i]] ??= r[i];
      }
      return ret;
    });
    const headers = headerRow;
    const headerColumns: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      headerColumns[headerRow[i]] ??= i;
    }
    return { rows: parsedRows, headers, headerColumns };
  }

  /** Gets the current week number from the spreadsheet. */
  async getCurrentWeek() {
    return z.tuple([z.tuple([z.coerce.number()])]).parse(
      (await sheetsRead(sheets, this.sheetId, "Quotas!B2")).values,
    )[0][0];
  }

  /** Gets the entropy week from the Quotas sheet. */
  async getEntropyWeek() {
    return z.tuple([z.tuple([z.coerce.number()])]).parse(
      (await sheetsRead(sheets, this.sheetId, "Quotas!D2")).values,
    )[0][0];
  }

  /** Sets the entropy week in the Quotas sheet. */
  async setEntropyWeek(week: number) {
    await sheetsWrite(
      sheets,
      this.sheetId,
      "Quotas!D2",
      [[week]],
      "RAW",
    );
  }

  /** Records an entropy loss in the Entropy sheet. */
  async addEntropyRow(playerName: string, week: number) {
    const offsetMs = await getSheetTimeZoneOffsetMs(this.sheetId);
    const serialDate = writeSheetsDate(new Date(), offsetMs);
    await sheetsAppend(
      sheets,
      this.sheetId,
      "Entropy!A:I",
      [[
        0, // MATCH #
        week,
        "ENTROPY",
        playerName,
        "2",
        "0",
        "", // RESULT is vestigial
        true,
        serialDate,
      ]],
      "RAW",
    );
  }

  addPoolChange(
    name: string,
    type: string,
    value: string,
    comment: string,
    newPoolId?: string,
    sheetName = POOL_CHANGES_SHEET_NAME,
  ) {
    return this.addPoolChanges(
      [[
        name,
        type,
        value,
        comment,
        ...[newPoolId].filter(Boolean) as [newPoolId?: string],
      ]],
      sheetName,
    );
  }

  async addPoolChanges(
    changes: [
      name: string,
      type: string,
      value: string,
      comment: string,
      newPoolId?: string,
    ][],
    sheetName = POOL_CHANGES_SHEET_NAME,
  ) {
    const timestamp = new Date().toISOString();
    await sheetsAppend(
      sheets,
      this.sheetId,
      `${sheetName}!A1:F`,
      changes.map((c) => [timestamp, ...c as string[]]),
    );
  }

  async deletePoolChange(
    rowNum: number,
    sheetName = POOL_CHANGES_SHEET_NAME,
  ) {
    return await sheetsDeleteRow(
      sheets,
      this.sheetId,
      sheetName,
      rowNum,
    );
  }

  async getPoolChanges<S extends z.ZodRawShape>(
    sheetName = POOL_CHANGES_SHEET_NAME,
    extras?: z.ZodObject<S>,
  ) {
    const table = await this.readTable(`${sheetName}!A:F`, 1);
    return parseTable(
      {
        Timestamp: z.union([z.string(), z.number()]),
        Name: z.string(),
        Type: z.string(), // TODO maybe enforce known types?
        Value: z.string(),
        Comment: z.string().nullable(),
        "Full Pool": z.string().nullable().optional(),
        ...extras?.shape,
      },
      table,
    );
  }

  async getPlayers<
    S extends z.ZodRawShape = Record<string, never>,
  >(
    extras?: S,
  ): Promise<Table<Player<S>>> {
    const LAST_COLUMN = "AI";
    const table = await this.readTable("Player Database!A:" + LAST_COLUMN, 1);
    const schema = tableSchema({
      ...playerShape,
      ...extras as S,
    });
    table.rows = table.rows.filter((x) =>
      typeof x.Identification === "string" &&
      typeof x["Matches Played"] !== "number" && x.Identification.length > 4
    );
    return schema.parse(table) as Table<Player<S>>;
  }

  /** Gets quota information for different weeks. */
  async getQuotas() {
    if (this.#quotas) return this.#quotas;
    const table = await this.readTable("Quotas!A7:E11", 3);
    const parsed = parseTable({
      WEEK: z.number(),
      FROM: z.union([z.number(), z.literal("Registration")]),
      TO: z.number(),
      MIN: z.number(),
      MAX: z.number(),
    }, table);
    this.#quotas = parsed.rows.filter((x) => x.WEEK > 0).map((x) => ({
      week: x.WEEK,
      fromDate: x.FROM === "Registration" ? 0 : x.FROM,
      toDate: x.TO,
      matchesMin: x.MIN,
      matchesMax: x.MAX,
    }));
    return this.#quotas;
  }

  /** Checks if the league is officially over based on the last quota's end date. */
  async isLeagueOver() {
    const allQuotas = await this.getQuotas();
    if (allQuotas.length === 0) return false;
    const lastQuota = allQuotas[allQuotas.length - 1];

    const offsetMs = await getSheetTimeZoneOffsetMs(this.sheetId);
    const endDateTime = readSheetsDate(lastQuota.toDate, offsetMs);

    return Date.now() > endDateTime.getTime();
  }

  async getMatches<S extends z.ZodRawShape>(
    extras?: S,
    quotasOverride?: QuotaInfo[],
    botColumns: z.ZodRawShape = {
      "Script Handled": z.coerce.boolean(),
      "Bot Messaged": z.coerce.boolean(),
    },
  ) {
    const quotaTask = quotasOverride ?? this.getQuotas();
    const LAST_COLUMN = "L";
    const table = await this.readTable("Matches!A:" + LAST_COLUMN);
    const parsed = parseTable({
      Timestamp: z.number(),
      "Your Name": z.string(),
      "Loser Name": z.string(),
      Result: z.string(),
      Notes: z.string().optional(),
      ...botColumns,
      ...extras,
    }, table);
    const resolvedQuotas = await quotaTask;
    return {
      ...parsed,
      rows: parsed.rows.map((r) => ({
        ...r,
        [MATCHTYPE]: "match" as const,
        WEEK: resolvedQuotas.findLast((q) => q.fromDate <= r.Timestamp)?.week ??
          0,
      })),
    };
  }

  async getEntropy<S extends z.ZodRawShape>(
    extras?: S,
  ) {
    const LAST_COLUMN = "L";
    const table = await this.readTable("Entropy!A4:" + LAST_COLUMN, 4);
    const parsed = parseTable({
      WEEK: z.number(),
      Timestamp: z.number(),
      "PLAYER 1": z.string(),
      "PLAYER 2": z.string(),
      RESULT: z.string(),
      "Bot Messaged": z.coerce.boolean(),
      ...extras,
    }, { ...table, rows: table.rows.filter((r) => r["PLAYER 2"]) });
    return {
      ...parsed,
      rows: parsed.rows.map((r) => ({
        ...r,
        "Your Name": r["PLAYER 1"],
        "Loser Name": r["PLAYER 2"],
        "Script Handled": true,
        [MATCHTYPE]: "entropy" as const,
      })),
    };
  }

  /** Get all matches and entropy, sorted by timestamp. */
  async getAllMatches<
    SM extends z.ZodRawShape,
    SE extends z.ZodRawShape,
  >(
    matchExtras?: SM,
    entropyExtras?: SE,
    quotasOverride?: QuotaInfo[],
    matchBotColumns?: z.ZodRawShape,
  ) {
    const [matches, entropy] = await Promise.all([
      this.getMatches(matchExtras, quotasOverride, matchBotColumns),
      this.getEntropy(entropyExtras),
    ]);
    const rows = [...matches.rows, ...entropy.rows].sort((a, b) =>
      a.Timestamp - b.Timestamp
    );
    return {
      rows,
      headers: {
        entropy: entropy.headers,
        match: matches.headers,
      },
      headerColumns: {
        entropy: entropy.headerColumns,
        match: matches.headerColumns,
      },
      sheetName: {
        match: "Matches",
        entropy: "Entropy",
      },
    };
  }

  /**
   * @deprecated {@link getPoolChanges} now includes the pool ID with most entries and programmatic access to the Pools sheet is discouraged.
   */
  async getPools() {
    const range = await sheetsRead(
      sheets,
      this.sheetId,
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

  /** Latest sealeddeck.tech URL recorded in the pool change log for a player. */
  getCurrentPoolLink(
    name: string,
    poolChanges: Awaited<ReturnType<LeagueSheet["getPoolChanges"]>>,
  ): string | undefined {
    const poolId = poolChanges.rows.filter((c) => c.Name === name).findLast(
      (c) => c["Full Pool"],
    )?.["Full Pool"];
    return poolId ? "https://sealeddeck.tech/" + poolId : undefined;
  }

  async getExpectedPool(
    name: string,
    poolsChangesSheet?: Awaited<ReturnType<LeagueSheet["getPoolChanges"]>>,
  ) {
    poolsChangesSheet ??= await this.getPoolChanges();
    const changesForName = poolsChangesSheet.rows.filter((x) =>
      x.Name === name
    );
    const currentPoolId = changesForName.findLast((c) => c["Full Pool"])?.[
      "Full Pool"
    ];
    const expected = await rebuildPoolContents(
      changesForName.map((x) => [x.Timestamp, x.Name, x.Type, x.Value]),
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
      const cardName of new Set([
        ...expectedMap.keys(),
        ...actualMap?.keys() ?? [],
      ])
    ) {
      const exp = expectedMap.get(cardName)?.length ?? 0;
      const act = actualMap?.get(cardName)?.length ?? 0;
      if (exp !== act) {
        console.log(cardName + ": Expected " + exp + " but got " + act);
        ok = false;
      }
    }
    const poolId = ok
      ? currentPoolId
      : (await makeSealedDeck({ sideboard: expected }));
    return "https://sealeddeck.tech/" + poolId;
  }

  async recordPackAddition(
    name: string,
    pack: import("./sealeddeck.ts").SealedDeckPool,
    comment: string,
  ) {
    const poolChanges = await this.getPoolChanges();
    const playerChanges = poolChanges.rows.filter((c) => c.Name === name);
    const currentPoolId = playerChanges.findLast((c) => c["Full Pool"])
      ?.["Full Pool"];

    const newPoolId = await makeSealedDeck(
      { sideboard: pack.sideboard },
      currentPoolId ?? undefined,
    );

    await this.addPoolChange(
      name,
      "add pack",
      pack.poolId,
      comment,
      newPoolId,
    );
  }
}

export const liveSheet = getLeagueSheet(CONFIG.LIVE_SHEET_ID);
export const upcomingSheet = CONFIG.UPCOMING_SHEET_ID
  ? getLeagueSheet(CONFIG.UPCOMING_SHEET_ID)
  : undefined;
export const archiveSheets = (CONFIG.ARCHIVE_SHEET_IDS ?? []).map(
  getLeagueSheet,
);

// --- Backward-compatible module-level wrappers (default to the live league) ---

export async function readTable(
  range: string,
  headerRowNum = 1,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).readTable(range, headerRowNum);
}

export async function getCurrentWeek(sheetId = CONFIG.LIVE_SHEET_ID) {
  return await getLeagueSheet(sheetId).getCurrentWeek();
}

export async function getEntropyWeek(sheetId = CONFIG.LIVE_SHEET_ID) {
  return await getLeagueSheet(sheetId).getEntropyWeek();
}

export async function setEntropyWeek(
  week: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).setEntropyWeek(week);
}

export async function addEntropyRow(
  playerName: string,
  week: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).addEntropyRow(playerName, week);
}

export const addPoolChange = (
  name: string,
  type: string,
  value: string,
  comment: string,
  newPoolId?: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
  sheetName = POOL_CHANGES_SHEET_NAME,
) =>
  getLeagueSheet(sheetId).addPoolChange(
    name,
    type,
    value,
    comment,
    newPoolId,
    sheetName,
  );

export async function addPoolChanges(
  changes: [
    name: string,
    type: string,
    value: string,
    comment: string,
    newPoolId?: string,
  ][],
  sheetId = CONFIG.LIVE_SHEET_ID,
  sheetName = POOL_CHANGES_SHEET_NAME,
) {
  return await getLeagueSheet(sheetId).addPoolChanges(changes, sheetName);
}

export async function deletePoolChange(
  rowNum: number,
  sheetId = CONFIG.LIVE_SHEET_ID,
  sheetName = POOL_CHANGES_SHEET_NAME,
) {
  return await getLeagueSheet(sheetId).deletePoolChange(rowNum, sheetName);
}

export async function getPoolChanges<S extends z.ZodRawShape>(
  sheetId = CONFIG.LIVE_SHEET_ID,
  sheetName = POOL_CHANGES_SHEET_NAME,
  extras?: z.ZodObject<S>,
) {
  return await getLeagueSheet(sheetId).getPoolChanges(sheetName, extras);
}

export async function getPlayers<
  S extends z.ZodRawShape = Record<string, never>,
>(
  sheetId = CONFIG.LIVE_SHEET_ID,
  ...[extras]: S extends Record<string, never> ? [S?] : [S]
): Promise<Table<Player<S>>> {
  return await getLeagueSheet(sheetId).getPlayers(extras) as Promise<
    Table<Player<S>>
  >;
}

export async function getQuotas(sheetId = CONFIG.LIVE_SHEET_ID) {
  return await getLeagueSheet(sheetId).getQuotas();
}

export async function isLeagueOver(sheetId = CONFIG.LIVE_SHEET_ID) {
  return await getLeagueSheet(sheetId).isLeagueOver();
}

export async function getMatches<S extends z.ZodRawShape>(
  extras?: S,
  quotas?: QuotaInfo[],
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).getMatches(extras, quotas);
}

export async function getEntropy<S extends z.ZodRawShape>(
  extras?: S,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).getEntropy(extras);
}

export async function getAllMatches<
  SM extends z.ZodRawShape,
  SE extends z.ZodRawShape,
>(
  matchExtras?: SM,
  entropyExtras?: SE,
  quotas?: QuotaInfo[],
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).getAllMatches(
    matchExtras,
    entropyExtras,
    quotas,
  );
}

export async function getPools(sheetId = CONFIG.LIVE_SHEET_ID) {
  return await getLeagueSheet(sheetId).getPools();
}

export async function getExpectedPool(
  name: string,
  poolsChangesSheet?: Awaited<ReturnType<typeof getPoolChanges>>,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).getExpectedPool(
    name,
    poolsChangesSheet,
  );
}

export async function recordPackAddition(
  name: string,
  pack: import("./sealeddeck.ts").SealedDeckPool,
  comment: string,
  sheetId = CONFIG.LIVE_SHEET_ID,
) {
  return await getLeagueSheet(sheetId).recordPackAddition(name, pack, comment);
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
        const cardName = splitCardNames.has(e[3].split(" //")[0])
          ? e[3]
          : e[3].split(" //")[0];
        cards.set(cardName, (cards.get(cardName) ?? 0) + 1);
        break;
      }
      case "remove card": {
        const cardName = splitCardNames.has(e[3].split(" //")[0])
          ? e[3]
          : e[3].split(" //")[0];
        cards.set(cardName, (cards.get(cardName) ?? 0) - 1);
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
    [cardName, count],
  ) => ({
    name: cardName,
    count,
  }));
  return sideboard;
}
