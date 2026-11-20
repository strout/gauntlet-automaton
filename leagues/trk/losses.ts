import { z } from "zod";
import { type LeagueSheet, ROWNUM } from "../../standings.ts";
import { DM_SENT_COLUMN } from "./constants.ts";

/**
 * One counted loss. Match rows keep their sheet row number. Entropy rows are
 * negative, so row 12 on Entropy is -12 and cannot collide with Matches.
 */
export interface TrkLoss {
  readonly [ROWNUM]: number;
  readonly Timestamp: number;
  readonly "Your Name": string;
  readonly "Loser Name": string;
  readonly "Match Announced": unknown;
  readonly "DM Sent": unknown;
}

const lossExtras = {
  "Match Announced": z.unknown().optional(),
  [DM_SENT_COLUMN]: z.unknown().optional(),
};

/** One read of Matches and one read of Entropy. */
export async function readTrkLossSheets(sheet: LeagueSheet) {
  const [matches, entropy] = await Promise.all([
    sheet.getMatches(lossExtras),
    sheet.getEntropy(lossExtras),
  ]);
  return {
    matches,
    losses: combineTrkLosses(matches.rows, entropy.rows),
  };
}

/** Matches and entropy losses for pack order, planets, and announcements. */
export function trkLossRows(sheet: LeagueSheet): Promise<TrkLoss[]> {
  return readTrkLossSheets(sheet).then((loaded) => loaded.losses);
}

export function combineTrkLosses(
  matches: readonly LossSource[],
  entropy: readonly LossSource[],
): TrkLoss[] {
  return [
    ...matches.map((row) => lossFrom(row, row[ROWNUM])),
    ...entropy.map((row) => lossFrom(row, -row[ROWNUM])),
  ];
}

interface LossSource {
  readonly [ROWNUM]: number;
  readonly Timestamp: number;
  readonly "Your Name": string;
  readonly "Loser Name": string;
  readonly "Match Announced": unknown;
}

function lossFrom(
  row: {
    readonly Timestamp: number;
    readonly "Your Name": string;
    readonly "Loser Name": string;
    readonly "Match Announced": unknown;
  },
  rowNum: number,
): TrkLoss {
  return {
    [ROWNUM]: rowNum,
    Timestamp: row.Timestamp,
    "Your Name": row["Your Name"],
    "Loser Name": row["Loser Name"],
    "Match Announced": row["Match Announced"],
    "DM Sent": (row as Record<string, unknown>)[DM_SENT_COLUMN],
  };
}

/** 1-based loss number for each counted row. Rejections are left out. */
export function lossOrdinals(rows: readonly TrkLoss[]): Map<number, number> {
  const byLoser = new Map<string, TrkLoss[]>();
  for (const row of rows) {
    if (!countsAsLoss(row["Match Announced"])) continue;
    const group = byLoser.get(row["Loser Name"]) ?? [];
    group.push(row);
    byLoser.set(row["Loser Name"], group);
  }
  const ordinals = new Map<number, number>();
  for (const group of byLoser.values()) {
    // Matches column A and Entropy column I are both sheet serials.
    // The row id is negative for entropy, so it must not decide the order.
    group.sort((a, b) => a.Timestamp - b.Timestamp);
    group.forEach((row, index) => ordinals.set(row[ROWNUM], index + 1));
  }
  return ordinals;
}

/**
 * True for a real loss. A rejection is any other non-empty string in
 * Match Announced. False and blank still count: the loss exists before it
 * is announced.
 */
export function countsAsLoss(value: unknown): boolean {
  if (
    value === true || value === false || value === undefined ||
    value === null ||
    value === ""
  ) return true;
  return typeof value === "string" && value.trim().toUpperCase() === "TRUE";
}

/** True once Match Announced has been set, including an error string. */
export function lossAnnounced(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return value.trim() !== "";
}
