import { delay } from "@std/async";
import { CONFIG } from "../../config.ts";
import {
  fetchSosCourses,
  scryfallQueryForElectiveCourseTitle,
} from "./course-sheet.ts";
import { getPlayers, type Player } from "../../standings.ts";
import { sheets, sheetsRead, sheetsWrite } from "../../sheets.ts";

const ELECTIVES_SHEET = "Electives";
const ELECTIVES_DATA_RANGE = `${ELECTIVES_SHEET}!A2:G2000`;
const WRITE_DELAY_MS = 150;

export interface ElectiveRowParsed {
  readonly rowNum: number;
  readonly timestamp: number;
  readonly rawName: string;
  readonly course1: string;
  readonly course2: string;
  readonly course3: string;
  readonly currentErrorCell: unknown;
}

/** How many 3-elective submissions a player should have on the sheet from `Losses`. */
export function requiredElectiveSubmissions(losses: number): number {
  return 1 + Math.floor(Math.max(0, losses) / 2);
}

/**
 * Which Electives submission row (1-based, oldest first) drives comeback variable slots
 * for this loss count: 1–2 losses → tier 1, 3–4 → tier 2, 0 → tier 1.
 */
export function electiveRowTierFromLosses(losses: number): number {
  return Math.max(1, Math.ceil(Math.max(0, losses) / 2));
}

/**
 * Reads **Electives** `A2:G` into parsed rows (timestamp, name, courses, ERROR cell).
 * Returns `null` if the sheet cannot be read.
 */
export async function readElectivesParsedRows(): Promise<
  ElectiveRowParsed[] | null
> {
  try {
    const res = await sheetsRead(
      sheets,
      CONFIG.LIVE_SHEET_ID,
      ELECTIVES_DATA_RANGE,
      "UNFORMATTED_VALUE",
    );
    const grid = res.values ?? [];
    const rows: ElectiveRowParsed[] = [];
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i] ?? [];
      const rowNum = i + 2;
      rows.push({
        rowNum,
        timestamp: parseSheetTimestamp(row[0]),
        rawName: cellAt(row, 1),
        course1: cellAt(row, 2),
        course2: cellAt(row, 3),
        course3: cellAt(row, 4),
        currentErrorCell: row[6],
      });
    }
    return rows;
  } catch (e) {
    console.error("[SOS electives] Failed to read Electives sheet:", e);
    return null;
  }
}

/**
 * Returns the three Scryfall `q` strings for the elective row that applies at `losses`,
 * or `null` if there is no valid (non-ERROR) row at that tier, or any course cannot be
 * resolved on **Course Sheet**.
 */
export async function getComebackElectiveScryfallQueries(
  identification: string,
  losses: number,
): Promise<readonly [string, string, string] | null> {
  const electiveRows = await readElectivesParsedRows();
  if (!electiveRows) return null;

  let players: readonly Player[];
  try {
    const { rows } = await getPlayers();
    players = rows as unknown as readonly Player[];
  } catch (e) {
    console.error("[SOS electives] getPlayers (comeback) failed:", e);
    return null;
  }

  const tier = electiveRowTierFromLosses(losses);
  const idNorm = normalizeKey(identification);

  const mine = electiveRows.filter((r) => {
    if (!r.rawName.trim()) return false;
    if (truthySheetError(r.currentErrorCell)) return false;
    if (
      !r.course1.trim() || !r.course2.trim() || !r.course3.trim()
    ) return false;
    const p = findPlayerForElectiveRow(players, r.rawName);
    if (p && p.Identification === identification) return true;
    return normalizeKey(r.rawName) === idNorm;
  });

  const sorted = [...mine].sort((a, z) => {
    const d = a.timestamp - z.timestamp;
    if (d !== 0) return d;
    return a.rowNum - z.rowNum;
  });

  const idx = tier - 1;
  if (idx < 0 || idx >= sorted.length) return null;
  const pick = sorted[idx]!;

  let catalog: Awaited<ReturnType<typeof fetchSosCourses>>;
  try {
    catalog = await fetchSosCourses();
  } catch (e) {
    console.error("[SOS electives] fetchSosCourses (comeback) failed:", e);
    return null;
  }

  const q1 = scryfallQueryForElectiveCourseTitle(pick.course1, catalog);
  const q2 = scryfallQueryForElectiveCourseTitle(pick.course2, catalog);
  const q3 = scryfallQueryForElectiveCourseTitle(pick.course3, catalog);
  if (!q1 || !q2 || !q3) {
    console.warn(
      `[SOS electives] Could not map all three courses to Course Sheet for ${identification} (tier ${tier}).`,
    );
    return null;
  }
  return [q1, q2, q3];
}

function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeCourseName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseSheetTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function cellAt(row: unknown[], index: number): string {
  const v = row[index];
  if (v == null) return "";
  return String(v).trim();
}

function rowIsCompletelyBlank(
  rawName: string,
  c1: string,
  c2: string,
  c3: string,
): boolean {
  return !rawName && !c1 && !c2 && !c3;
}

function truthySheetError(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value ?? "").trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "YES";
}

function desiredErrorLiteral(illegal: boolean): string {
  return illegal ? "TRUE" : "";
}

function currentErrorLiteral(value: unknown): string {
  return truthySheetError(value) ? "TRUE" : "";
}

export function findPlayerForElectiveRow(
  players: readonly Player[],
  rawName: string,
): Player | undefined {
  const key = normalizeKey(rawName);
  if (!key) return undefined;

  for (const p of players) {
    if (normalizeKey(p.Identification) === key) return p;
    if (normalizeKey(p.Name) === key) return p;
    const arena = String(p["Arena ID"] ?? "").trim();
    if (!arena) continue;
    const arenaNorm = normalizeKey(arena);
    if (arenaNorm && (key.includes(arenaNorm) || arenaNorm.includes(key))) {
      return p;
    }
  }
  return undefined;
}

/**
 * Reads **Electives**, validates rows against Player Database `Losses` and elective rules,
 * and writes column **G (ERROR)** to `TRUE` when a row is illegal or clears it when valid.
 *
 * Rules (per player, rows ordered by column A timestamp ascending):
 * - Expected submission count = `1 + floor(losses / 2)` (first batch at 0 losses, then every 2 losses).
 * - More than that many rows → excess rows are illegal.
 * - Fewer than that many rows → no flag (player may not have submitted yet).
 * - Each submission must have three non-empty courses; no duplicate course within a row.
 * - Across the first *expected* submissions (oldest rows), a course may not repeat once taken.
 * - Column B must match a player in the Player Database (Identification, Name, or Arena ID).
 */
export async function validateElectivesSheet(): Promise<void> {
  const rows = await readElectivesParsedRows();
  if (!rows) return;

  const illegal = new Set<number>();
  const contentRows = rows.filter((r) =>
    !rowIsCompletelyBlank(
      r.rawName,
      r.course1,
      r.course2,
      r.course3,
    )
  );

  for (const r of contentRows) {
    if (!r.rawName && (r.course1 || r.course2 || r.course3)) {
      illegal.add(r.rowNum);
    }
  }

  let players: readonly Player[];
  try {
    const { rows } = await getPlayers();
    players = rows as unknown as readonly Player[];
  } catch (e) {
    console.error("[SOS electives] getPlayers failed:", e);
    return;
  }

  const byPlayerKey = new Map<string, ElectiveRowParsed[]>();
  for (const r of contentRows) {
    if (!r.rawName) continue;
    const k = normalizeKey(r.rawName);
    const list = byPlayerKey.get(k) ?? [];
    list.push(r);
    byPlayerKey.set(k, list);
  }

  for (const [, group] of byPlayerKey) {
    const sorted = [...group].sort((a, z) => {
      const d = a.timestamp - z.timestamp;
      if (d !== 0) return d;
      return a.rowNum - z.rowNum;
    });

    const player = findPlayerForElectiveRow(players, sorted[0]?.rawName ?? "");
    if (!player) {
      for (const r of sorted) illegal.add(r.rowNum);
      continue;
    }

    const losses = Number(player.Losses);
    const required = requiredElectiveSubmissions(
      Number.isFinite(losses) ? losses : 0,
    );
    const n = sorted.length;

    if (n > required) {
      for (let i = required; i < n; i++) illegal.add(sorted[i]!.rowNum);
    }

    const officialCount = Math.min(n, required);
    const official = sorted.slice(0, officialCount);

    const priorCourses = new Set<string>();
    for (const r of official) {
      const c1 = normalizeCourseName(r.course1);
      const c2 = normalizeCourseName(r.course2);
      const c3 = normalizeCourseName(r.course3);
      if (!c1 || !c2 || !c3) {
        illegal.add(r.rowNum);
        continue;
      }
      const trio = [c1, c2, c3];
      if (new Set(trio).size !== 3) {
        illegal.add(r.rowNum);
        continue;
      }
      for (const c of trio) {
        if (priorCourses.has(c)) {
          illegal.add(r.rowNum);
          break;
        }
      }
      if (illegal.has(r.rowNum)) continue;
      for (const c of trio) priorCourses.add(c);
    }
  }

  for (const r of rows) {
    const blank = rowIsCompletelyBlank(
      r.rawName,
      r.course1,
      r.course2,
      r.course3,
    );
    const wantIllegal = illegal.has(r.rowNum);
    const wantLiteral = desiredErrorLiteral(wantIllegal && !blank);
    const curLiteral = currentErrorLiteral(r.currentErrorCell);
    if (wantLiteral === curLiteral) continue;
    try {
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `${ELECTIVES_SHEET}!G${r.rowNum}`,
        [[wantLiteral]],
      );
      await delay(WRITE_DELAY_MS);
    } catch (e) {
      console.error(`[SOS electives] Failed to write G${r.rowNum}:`, e);
    }
  }
}
