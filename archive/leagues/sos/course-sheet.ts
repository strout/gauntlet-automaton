import { CONFIG } from "../../config.ts";
import {
  sheets,
  sheetsRead,
  sheetsReadColumnHyperlinkUrls,
} from "../../sheets.ts";

const COURSE_SHEET_NAME = "Course Sheet";
const COURSE_DATA_LAST_ROW = 1000;

/** One row from the live sheet **Course Sheet** (course name, college, Scryfall queries). */
export interface SosCourseRow {
  readonly courseName: string;
  readonly college: string;
  /** Column E — symbology search for Scryfall (`/cards/random?q=`). */
  readonly scryfallQuery: string;
  /** Column F — alternate query for elective tier 5 (losses 9–10 comeback). May be empty. */
  readonly graduateStudiesQuery: string;
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

function scryfallQueryForMatchedCourse(
  row: SosCourseRow,
  electiveTier: number | undefined,
): string {
  const grad = row.graduateStudiesQuery.trim();
  if (electiveTier === 5 && grad.length > 0) return grad;
  return row.scryfallQuery;
}

/**
 * Resolves a Scryfall `q` string for an elective course title using **Course Sheet** rows
 * (`fetchSosCourses`). Exact normalized match first, then substring match on either side.
 *
 * When `electiveTier` is **5** (comeback after losses 9–10), uses **column F**
 * (`graduateStudiesQuery`) when set; otherwise column E (`scryfallQuery`).
 */
export function scryfallQueryForElectiveCourseTitle(
  electiveTitle: string,
  catalog: readonly SosCourseRow[],
  options?: { readonly electiveTier?: number },
): string | null {
  const tier = options?.electiveTier;
  const n = normalizeSosCourseTitle(electiveTitle);
  if (!n) return null;
  for (const row of catalog) {
    if (normalizeSosCourseTitle(row.courseName) === n) {
      return scryfallQueryForMatchedCourse(row, tier);
    }
  }
  for (const row of catalog) {
    const cn = normalizeSosCourseTitle(row.courseName);
    if (!cn) continue;
    if (n.includes(cn) || cn.includes(n)) {
      return scryfallQueryForMatchedCourse(row, tier);
    }
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
 * Reads **Course Sheet** on `CONFIG.LIVE_SHEET_ID`: B = course name, D = college,
 * E = Scryfall link (undergrad pool), F = graduate-studies link (tier-5 electives).
 * Grid `hyperlink` is read when the Values API omits the formula for inserted links.
 */
export async function fetchSosCourses(): Promise<readonly SosCourseRow[]> {
  const sheetId = CONFIG.LIVE_SHEET_ID;
  const q = (col: string) =>
    `'${COURSE_SHEET_NAME}'!${col}2:${col}${COURSE_DATA_LAST_ROW}`;

  const [
    bRes,
    dRes,
    eFormula,
    eFormatted,
    eHyperUrls,
    fFormula,
    fFormatted,
    fHyperUrls,
  ] = await Promise.all([
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
    sheetsRead(sheets, sheetId, q("F"), "FORMULA"),
    sheetsRead(sheets, sheetId, q("F"), "FORMATTED_VALUE"),
    sheetsReadColumnHyperlinkUrls(
      sheets,
      sheetId,
      q("F"),
      COURSE_SHEET_NAME,
    ),
  ]);

  const bVals = bRes.values ?? [];
  const dVals = dRes.values ?? [];
  const eForm = eFormula.values ?? [];
  const eFmt = eFormatted.values ?? [];
  const fForm = fFormula.values ?? [];
  const fFmt = fFormatted.values ?? [];

  const n = Math.max(
    bVals.length,
    dVals.length,
    eForm.length,
    eFmt.length,
    fForm.length,
    fFmt.length,
  );
  const out: SosCourseRow[] = [];

  for (let i = 0; i < n; i++) {
    const courseName = columnCell(bVals, i);
    if (!courseName) continue;

    const college = columnCell(dVals, i);
    const eF = columnCell(eForm, i);
    const eFmtCell = columnCell(eFmt, i);
    const eGridUrl = i < eHyperUrls.length ? eHyperUrls[i] : null;
    const eFromHyperlink = eGridUrl ? scryfallUrlToQuery(eGridUrl) : null;
    const scryfallQuery = eFromHyperlink ??
      parseScryfallQueryFromCourseLinkCell(eF, eFmtCell);
    if (!scryfallQuery) continue;

    const fF = columnCell(fForm, i);
    const fFmtCell = columnCell(fFmt, i);
    const fGridUrl = i < fHyperUrls.length ? fHyperUrls[i] : null;
    const fFromHyperlink = fGridUrl ? scryfallUrlToQuery(fGridUrl) : null;
    const graduateStudiesQuery = fFromHyperlink ??
      parseScryfallQueryFromCourseLinkCell(fF, fFmtCell) ?? "";

    out.push({
      courseName,
      college,
      scryfallQuery,
      graduateStudiesQuery,
    });
  }

  return out;
}
