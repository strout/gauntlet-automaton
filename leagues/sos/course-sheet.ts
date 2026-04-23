import { CONFIG } from "../../config.ts";
import {
  sheets,
  sheetsRead,
  sheetsReadColumnHyperlinkUrls,
} from "../../sheets.ts";

const COURSE_SHEET_NAME = "Course Sheet";
const COURSE_DATA_LAST_ROW = 1000;

/** One row from the live sheet **Course Sheet** (course name, college, Scryfall query). */
export interface SosCourseRow {
  readonly courseName: string;
  readonly college: string;
  /** Symbology search string for Scryfall (passed to `/cards/random?q=`). */
  readonly scryfallQuery: string;
}

/**
 * Label for a select menu or list entry: `[College] - [Course Name]`.
 * Truncates to `maxLength` for Discord field limits.
 */
export function formatSosCourseOptionLabel(
  row: SosCourseRow,
  maxLength = 100,
): string {
  const college = row.college.trim() || "Unknown";
  const raw = `[${college}] - ${row.courseName.trim()}`;
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength - 1)}…`;
}

/** Normalize a course title for matching Electives ↔ Course Sheet. */
export function normalizeSosCourseTitle(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Resolves a Scryfall `q` string for an elective course title using **Course Sheet** rows
 * (`fetchSosCourses`). Exact normalized match first, then substring match on either side.
 */
export function scryfallQueryForElectiveCourseTitle(
  electiveTitle: string,
  catalog: readonly SosCourseRow[],
): string | null {
  const n = normalizeSosCourseTitle(electiveTitle);
  if (!n) return null;
  for (const row of catalog) {
    if (normalizeSosCourseTitle(row.courseName) === n) {
      return row.scryfallQuery;
    }
  }
  for (const row of catalog) {
    const cn = normalizeSosCourseTitle(row.courseName);
    if (!cn) continue;
    if (n.includes(cn) || cn.includes(n)) return row.scryfallQuery;
  }
  return null;
}

function columnCell(column: unknown[][], rowIndex: number): string {
  const row = column[rowIndex];
  const v = row?.[0];
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Pulls a Scryfall symbology query from a **Course Sheet** Scryfall column cell:
 * `=HYPERLINK("https://…", "Scryfall Link")`, a plain URL, or (fallback) a raw query string.
 */
export function parseScryfallQueryFromCourseLinkCell(
  formulaCell: string,
  formattedCell: string,
): string | null {
  const f = formulaCell.trim();
  if (f) {
    const fromHyperlink = extractUrlFromHyperlinkFormula(f);
    if (fromHyperlink) {
      const q = scryfallUrlToQuery(fromHyperlink);
      if (q) return q;
    }
    if (f.startsWith("http")) {
      const q = scryfallUrlToQuery(f);
      if (q) return q;
    }
    if (!f.startsWith("=")) {
      return f.length > 0 ? f : null;
    }
  }
  const fmt = formattedCell.trim();
  if (fmt.startsWith("http")) {
    const q = scryfallUrlToQuery(fmt);
    if (q) return q;
  }
  return null;
}

function extractUrlFromHyperlinkFormula(s: string): string | null {
  const m = s.match(
    /^=\s*HYPERLINK\s*\(\s*"((?:\\"|[^"])*)"\s*[,;]/i,
  );
  if (m) return m[1].replace(/\\"/g, '"');
  const m2 = s.match(/^=\s*HYPERLINK\s*\(\s*"((?:\\"|[^"])*)"\s*\)\s*$/i);
  if (m2) return m2[1].replace(/\\"/g, '"');
  return null;
}

function scryfallUrlToQuery(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.trim());
    const host = u.hostname.toLowerCase();
    if (!host.endsWith("scryfall.com")) return null;
    const q = u.searchParams.get("q");
    if (q) return q;
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads **Course Sheet** on `CONFIG.LIVE_SHEET_ID`: column B = course name, D = college,
 * E = Scryfall link (UI hyperlink, `HYPERLINK` formula, or plain URL). Grid `hyperlink`
 * is read when the Values API omits the formula for inserted links.
 */
export async function fetchSosCourses(): Promise<readonly SosCourseRow[]> {
  const sheetId = CONFIG.LIVE_SHEET_ID;
  const q = (col: string) =>
    `'${COURSE_SHEET_NAME}'!${col}2:${col}${COURSE_DATA_LAST_ROW}`;

  const [bRes, dRes, eFormula, eFormatted, eHyperUrls] = await Promise.all([
    sheetsRead(sheets, sheetId, q("B"), "UNFORMATTED_VALUE"),
    sheetsRead(sheets, sheetId, q("D"), "UNFORMATTED_VALUE"),
    sheetsRead(sheets, sheetId, q("E"), "FORMULA"),
    sheetsRead(sheets, sheetId, q("E"), "FORMATTED_VALUE"),
    sheetsReadColumnHyperlinkUrls(
      sheets,
      sheetId,
      q("E"),
      COURSE_SHEET_NAME,
    ),
  ]);

  const bVals = bRes.values ?? [];
  const dVals = dRes.values ?? [];
  const eForm = eFormula.values ?? [];
  const eFmt = eFormatted.values ?? [];

  const n = Math.max(bVals.length, dVals.length, eForm.length, eFmt.length);
  const out: SosCourseRow[] = [];

  for (let i = 0; i < n; i++) {
    const courseName = columnCell(bVals, i);
    if (!courseName) continue;

    const college = columnCell(dVals, i);
    const formula = columnCell(eForm, i);
    const formatted = columnCell(eFmt, i);
    const gridUrl = i < eHyperUrls.length ? eHyperUrls[i] : null;
    const fromHyperlink = gridUrl ? scryfallUrlToQuery(gridUrl) : null;
    const scryfallQuery = fromHyperlink ??
      parseScryfallQueryFromCourseLinkCell(formula, formatted);
    if (!scryfallQuery) continue;

    out.push({ courseName, college, scryfallQuery });
  }

  return out;
}
