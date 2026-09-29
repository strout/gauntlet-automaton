import { CONFIG } from "../../config.ts";
import { readTable, ROW } from "../../standings.ts";

export const RIVAL_PAIRINGS_TAB = "Rival Pairings";

export function cellString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/** `Jordan M - JMTron#46639` → `JMTron#46639`; bare Arena IDs pass through. */
export function arenaIdFromIdentification(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const sep = trimmed.lastIndexOf(" - ");
  if (sep >= 0) {
    const arenaId = trimmed.slice(sep + 3).trim();
    return arenaId || null;
  }
  return trimmed;
}

/** True when two Identification strings refer to the same Arena account. */
export function sameArenaId(a: string, b: string): boolean {
  const idA = arenaIdFromIdentification(a);
  const idB = arenaIdFromIdentification(b);
  return !!idA && !!idB && idA.toLowerCase() === idB.toLowerCase();
}

export interface RivalPair {
  readonly player1: string;
  readonly player2: string;
}

/** Reads all rival pairs (columns B / C) from the registration sheet. */
export async function getRivalPairs(): Promise<readonly RivalPair[]> {
  const table = await readTable(
    `${RIVAL_PAIRINGS_TAB}!A:Z`,
    1,
    CONFIG.REGISTRATION_SHEET_ID,
  );
  const pairs: RivalPair[] = [];
  for (const row of table.rows) {
    const player1 = cellString(row[ROW][1]);
    const player2 = cellString(row[ROW][2]);
    if (player1 && player2) pairs.push({ player1, player2 });
  }
  return pairs;
}

/**
 * Finds the rival Identification (as written on Rival Pairings) for a player.
 *
 * @param identification - Player Database Identification or bare Arena ID
 */
export function findRival(
  pairs: readonly RivalPair[],
  identification: string,
): string | undefined {
  for (const pair of pairs) {
    if (sameArenaId(pair.player1, identification)) return pair.player2;
    if (sameArenaId(pair.player2, identification)) return pair.player1;
  }
  return undefined;
}
