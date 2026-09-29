import { z } from "zod";
import { sheets, sheetsAppend, sheetsWrite } from "../../sheets.ts";
import { type LeagueSheet, parseTable, ROWNUM } from "../../standings.ts";
import type { EchoedRarity } from "./cards.ts";
import { MIRRORED_CARDS_TAB } from "./constants.ts";
import { sameArenaId } from "./rivals.ts";

/**
 * Mirrored Cards tab layout (header row 1, columns A–J):
 *
 * Timestamp | Owner | Rival | Pack # | Slot | Rarity | Card | Counterpart | Delivered | Pool ID
 *
 * Each mirrored pair is two rows: one owned by each rival, same Pack # / Slot.
 * Pack # is the owner's comeback pack number (1-based; 0 reserved for starting
 * pools). Delivered flips to TRUE and Pool ID is filled when the owner opens
 * that pack.
 */
const mirroredRowShape = {
  Owner: z.string(),
  Rival: z.string(),
  "Pack #": z.coerce.number(),
  Slot: z.coerce.number(),
  Rarity: z.string(),
  Card: z.string(),
  Counterpart: z.string().optional(),
  Delivered: z.coerce.boolean(),
  "Pool ID": z.string().optional(),
};

export interface MirroredCardRow {
  readonly rowNum: number;
  readonly owner: string;
  readonly rival: string;
  readonly packNumber: number;
  readonly slot: number;
  readonly rarity: EchoedRarity;
  readonly card: string;
  readonly delivered: boolean;
}

export interface MirroredPairToStore {
  readonly slot: number;
  readonly rarity: EchoedRarity;
  readonly ownerCard: string;
  readonly rivalCard: string;
}

/** Reads every row of the Mirrored Cards tab. */
export async function readMirroredCards(
  sheet: LeagueSheet,
): Promise<readonly MirroredCardRow[]> {
  const table = await sheet.readTable(`${MIRRORED_CARDS_TAB}!A:J`, 1);
  const parsed = parseTable(mirroredRowShape, {
    ...table,
    rows: table.rows.filter((r) => typeof r.Owner === "string" && r.Owner),
  });
  return parsed.rows.map((r) => ({
    rowNum: r[ROWNUM],
    owner: r.Owner,
    rival: r.Rival,
    packNumber: r["Pack #"],
    slot: r.Slot,
    rarity: r.Rarity as EchoedRarity,
    card: r.Card,
    delivered: r.Delivered,
  }));
}

/** Pack # used for mirrored pairs rolled into starting pools. */
export const STARTING_POOL_PACK_NUMBER = 0;

/** Next comeback pack number for a player (1 + highest delivered). */
export function nextPackNumber(
  rows: readonly MirroredCardRow[],
  owner: string,
): number {
  let highest = 0;
  for (const row of rows) {
    if (!row.delivered || row.packNumber < 1) continue;
    if (!sameArenaId(row.owner, owner)) continue;
    highest = Math.max(highest, row.packNumber);
  }
  return highest + 1;
}

/** Undelivered cards the rival already rolled for this owner's pack. */
export function pendingMirroredCards(
  rows: readonly MirroredCardRow[],
  owner: string,
  packNumber: number,
): readonly MirroredCardRow[] {
  return rows
    .filter((r) =>
      !r.delivered &&
      r.packNumber === packNumber &&
      sameArenaId(r.owner, owner)
    )
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Appends both halves of each pair: the owner's rows as delivered. The
 * rival's rows are pending for their matching pack unless `rivalPoolId` is
 * given (both pools rolled together, e.g. starting pools).
 */
export async function storeMirroredPairs(
  sheet: LeagueSheet,
  owner: string,
  rival: string,
  packNumber: number,
  pairs: readonly MirroredPairToStore[],
  poolId: string,
  rivalPoolId?: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const values = pairs.flatMap((p) => [
    [
      timestamp,
      owner,
      rival,
      packNumber,
      p.slot,
      p.rarity,
      p.ownerCard,
      p.rivalCard,
      true,
      poolId,
    ],
    [
      timestamp,
      rival,
      owner,
      packNumber,
      p.slot,
      p.rarity,
      p.rivalCard,
      p.ownerCard,
      rivalPoolId !== undefined,
      rivalPoolId ?? "",
    ],
  ]);
  await sheetsAppend(
    sheets,
    sheet.sheetId,
    `${MIRRORED_CARDS_TAB}!A1:J`,
    values,
    "USER_ENTERED",
  );
}

/** Marks pending rows delivered in the given pool. */
export async function markMirroredDelivered(
  sheet: LeagueSheet,
  rows: readonly MirroredCardRow[],
  poolId: string,
): Promise<void> {
  for (const row of rows) {
    await sheetsWrite(
      sheets,
      sheet.sheetId,
      `${MIRRORED_CARDS_TAB}!I${row.rowNum}:J${row.rowNum}`,
      [[true, poolId]],
      "USER_ENTERED",
    );
  }
}
