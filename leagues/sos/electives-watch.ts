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
 * Returns the three course titles for the elective row that applies at `losses`,
 * using pre-validated submissions from `validateElectivesSheet`.
 *
 * The tier determines which submission row to use (1st submission for losses 0-2,
 * 2nd submission for losses 3-4, etc.). You must have at least `tier` valid
 * submissions to be eligible for a comeback pack at your current loss count.
 */
export function getComebackElectiveCoursesFromValidated(
  identification: string,
  losses: number,
  validSubmissions: Map<string, ValidElectiveRow[]>,
): readonly [string, string, string] | null {
  const tier = electiveRowTierFromLosses(losses);
  const submissions = validSubmissions.get(identification);

  // Must have at least `tier` valid submissions to be eligible
  if (!submissions || submissions.length < tier) {
    return null;
  }

  // Use the tier-th submission (1-indexed)
  const pick = submissions[tier - 1]!;
  return [pick.course1, pick.course2, pick.course3];
}

/**
 * Resolves course titles to Scryfall queries using the Course Sheet.
 */
export async function resolveCoursesToScryfallQueries(
  courses: readonly [string, string, string],
): Promise<readonly [string, string, string] | null> {
  let catalog: Awaited<ReturnType<typeof fetchSosCourses>>;
  try {
    catalog = await fetchSosCourses();
  } catch (e) {
    console.error("[SOS electives] fetchSosCourses failed:", e);
    return null;
  }

  const q1 = scryfallQueryForElectiveCourseTitle(courses[0], catalog);
  const q2 = scryfallQueryForElectiveCourseTitle(courses[1], catalog);
  const q3 = scryfallQueryForElectiveCourseTitle(courses[2], catalog);
  if (!q1 || !q2 || !q3) {
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

/** Check if a row is invalid (non-empty ERROR cell). */
function isRowInvalid(value: unknown): boolean {
  return !!value;
}

/**
 * Determine the marker for a row based on its status.
 * - "" = valid and active
 * - "REPLACED" = superseded by newer submission (even losses, sliding window)
 * - "ERROR" = actually illegal (odd losses excess, duplicate courses, etc.)
 */
function desiredRowMarker(status: "valid" | "replaced" | "illegal"): string {
  switch (status) {
    case "valid":
      return "";
    case "replaced":
      return "REPLACED";
    case "illegal":
      return "ERROR";
  }
}

/** Convert a marker string to its internal status. */
function markerToStatus(marker: string): "valid" | "replaced" | "illegal" {
  if (marker === "REPLACED") return "replaced";
  if (marker === "ERROR") return "illegal";
  return "valid";
}

/** Get the current marker from a cell value. */
function currentRowMarker(value: unknown): string {
  return String(value ?? "");
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

/** A validated elective submission row. */
export interface ValidElectiveRow {
  readonly course1: string;
  readonly course2: string;
  readonly course3: string;
}

/**
 * Result of validating the electives sheet.
 * Maps player identification to their valid (non-ERROR, non-REPLACED) submissions, ordered by timestamp.
 */
export interface ElectiveValidationResult {
  readonly validSubmissions: Map<string, ValidElectiveRow[]>;
}

/**
 * Reads **Electives**, validates rows against Player Database `Losses` and elective rules,
 * writes column **G (ERROR)** with appropriate status markers, and returns validated submissions.
 *
 * Column G markers:
 * - (blank) = valid and active
 * - "REPLACED" = superseded by newer submission (even losses, sliding window)
 * - "ERROR" = actually illegal (odd losses excess, duplicate courses, missing data, etc.)
 *
 * Rules (per player, rows ordered by column A timestamp ascending):
 * - Expected submission count = `1 + floor(losses / 2)` (first batch at 0 losses, then every 2 losses).
 * - At EVEN losses: unlimited submissions allowed; first N-1 are valid, last is valid, in-between → REPLACED
 * - At ODD losses: strict limit; submissions beyond N → ERROR (illegal)
 * - Each submission must have three non-empty courses; no duplicate course within a row.
 * - Across valid submissions, a course may not repeat once taken.
 * - Column B must match a player in the Player Database (Identification, Name, or Arena ID).
 */
export async function validateElectivesSheet(): Promise<
  ElectiveValidationResult
> {
  const rows = await readElectivesParsedRows();
  if (!rows) return { validSubmissions: new Map() };

  // Track row status: "illegal" → ERROR, "replaced" → REPLACED, undefined → valid
  // Pre-populate with existing markers to preserve them
  const rowStatus = new Map<number, "illegal" | "replaced">();
  for (const r of rows) {
    const marker = currentRowMarker(r.currentErrorCell);
    const status = markerToStatus(marker);
    if (status !== "valid") {
      rowStatus.set(r.rowNum, status);
    }
  }

  const contentRows = rows.filter((r) =>
    !rowIsCompletelyBlank(
      r.rawName,
      r.course1,
      r.course2,
      r.course3,
    )
  );

  // Basic sanity: courses without a name are always illegal
  for (const r of contentRows) {
    if (!r.rawName && (r.course1 || r.course2 || r.course3)) {
      rowStatus.set(r.rowNum, "illegal");
    }
  }

  let players: readonly Player[];
  try {
    const { rows } = await getPlayers();
    players = rows as unknown as readonly Player[];
  } catch (e) {
    console.error("[SOS electives] getPlayers failed:", e);
    return { validSubmissions: new Map() };
  }

  const byPlayerKey = new Map<string, ElectiveRowParsed[]>();
  for (const r of contentRows) {
    if (!r.rawName) continue;
    const k = normalizeKey(r.rawName);
    const list = byPlayerKey.get(k) ?? [];
    list.push(r);
    byPlayerKey.set(k, list);
  }

  // Track valid submissions per player (by Identification)
  const validSubmissions = new Map<string, ValidElectiveRow[]>();

  for (const [, group] of byPlayerKey) {
    const sorted = [...group].sort((a, z) => {
      const d = a.timestamp - z.timestamp;
      if (d !== 0) return d;
      return a.rowNum - z.rowNum;
    });

    // Filter out rows already marked as ERROR or REPLACED - they stay that way permanently
    const validRows = sorted.filter((r) =>
      rowStatus.get(r.rowNum) === undefined
    );

    const player = findPlayerForElectiveRow(
      players,
      validRows[0]?.rawName ?? "",
    );
    if (!player) {
      // Unknown player: all rows become illegal
      for (const r of validRows) rowStatus.set(r.rowNum, "illegal");
      continue;
    }

    const losses = Number(player.Losses);
    const normalizedLosses = Number.isFinite(losses) ? losses : 0;
    const required = requiredElectiveSubmissions(normalizedLosses);
    const n = validRows.length;

    // Determine if we're in "sliding window" mode (even losses) or "strict" mode (odd losses)
    const isEvenLosses = normalizedLosses % 2 === 0;

    if (n > required) {
      if (isEvenLosses) {
        // Even losses: first N-1 are valid, last is valid, everything in between is REPLACED
        for (let i = required - 1; i < n - 1; i++) {
          rowStatus.set(validRows[i]!.rowNum, "replaced");
        }
      } else {
        // Odd losses: excess rows are illegal
        for (let i = required; i < n; i++) {
          rowStatus.set(validRows[i]!.rowNum, "illegal");
        }
      }
    }

    // The "active" submissions for duplicate checking:
    // - Even losses: first N-1 + last submission
    // - Odd losses: first N submissions
    let active: ElectiveRowParsed[];
    if (isEvenLosses && n > required) {
      active = [...validRows.slice(0, required - 1), validRows[n - 1]!];
    } else {
      active = validRows.slice(0, Math.min(n, required));
    }

    // Check for duplicate courses within and across active submissions
    const priorCourses = new Set<string>();
    for (const r of active) {
      const c1 = normalizeCourseName(r.course1);
      const c2 = normalizeCourseName(r.course2);
      const c3 = normalizeCourseName(r.course3);

      // Missing courses → illegal
      if (!c1 || !c2 || !c3) {
        rowStatus.set(r.rowNum, "illegal");
        continue;
      }

      // Duplicate within row → illegal
      const trio = [c1, c2, c3];
      if (new Set(trio).size !== 3) {
        rowStatus.set(r.rowNum, "illegal");
        continue;
      }

      // Duplicate across submissions → illegal
      let hasDuplicate = false;
      for (const c of trio) {
        if (priorCourses.has(c)) {
          hasDuplicate = true;
          break;
        }
      }
      if (hasDuplicate) {
        rowStatus.set(r.rowNum, "illegal");
        continue;
      }

      // Valid row: add courses to prior set
      for (const c of trio) priorCourses.add(c);
    }

    // Collect valid submissions for this player (rows not marked as illegal/replaced)
    const playerValidRows = active.filter(
      (r) => rowStatus.get(r.rowNum) === undefined,
    );
    if (playerValidRows.length > 0) {
      validSubmissions.set(
        player.Identification,
        playerValidRows.map((r) => ({
          course1: r.course1,
          course2: r.course2,
          course3: r.course3,
        })),
      );
    }
  }

  // Write markers to column G
  for (const r of rows) {
    const blank = rowIsCompletelyBlank(
      r.rawName,
      r.course1,
      r.course2,
      r.course3,
    );
    if (blank) continue;

    const status = rowStatus.get(r.rowNum);
    const wantMarker = status === undefined ? "valid" : status;
    const wantLiteral = desiredRowMarker(wantMarker);
    const curLiteral = currentRowMarker(r.currentErrorCell);

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

  return { validSubmissions };
}
