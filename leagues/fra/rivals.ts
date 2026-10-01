import { type LeagueSheet, ROW } from "../../standings.ts";

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

/** True when two Identification strings refer to the same player. */
export type SamePlayer = (a: string, b: string) => boolean;

function normalizeIdentification(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Builds a player matcher for Identification strings (`Full Name - ArenaId`).
 *
 * Identical Identifications (ignoring case and spacing) always match.
 * Otherwise two Identifications match on Arena ID, so name spelling can differ
 * between sheets — unless that Arena ID is shared by several players on
 * `roster` (a shared Arena account), where only the full Identification can
 * tell them apart.
 *
 * @param roster - Identification of every player (the Player Database)
 */
export function playerMatcher(roster: readonly string[]): SamePlayer {
  const playersPerArenaId = new Map<string, number>();
  for (const identification of new Set(roster.map(normalizeIdentification))) {
    const arenaId = arenaIdFromIdentification(identification);
    if (!arenaId) continue;
    playersPerArenaId.set(arenaId, (playersPerArenaId.get(arenaId) ?? 0) + 1);
  }

  return (a, b) => {
    const normA = normalizeIdentification(a);
    const normB = normalizeIdentification(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    const arenaId = arenaIdFromIdentification(normA);
    return !!arenaId &&
      arenaId === arenaIdFromIdentification(normB) &&
      (playersPerArenaId.get(arenaId) ?? 0) <= 1;
  };
}

export interface RivalPair {
  readonly player1: string;
  readonly player2: string;
}

/**
 * Reads all rival pairs (columns B / C) from the FRA league sheet's Rival
 * Pairings tab.
 */
export async function getRivalPairs(
  sheet: LeagueSheet,
): Promise<readonly RivalPair[]> {
  const table = await sheet.readTable(`${RIVAL_PAIRINGS_TAB}!A:Z`, 1);
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
 * @param identification - Player Database Identification
 * @param samePlayer - Matcher from `playerMatcher`
 */
export function findRival(
  pairs: readonly RivalPair[],
  identification: string,
  samePlayer: SamePlayer,
): string | undefined {
  for (const pair of pairs) {
    if (samePlayer(pair.player1, identification)) return pair.player2;
    if (samePlayer(pair.player2, identification)) return pair.player1;
  }
  return undefined;
}
