import { type LeagueSheet, liveSheet } from "../../standings.ts";

export const MATCH_ANNOUNCED_COLUMN = "Match Announced";

export const HAS_MAP_TOKEN_COLUMN = "Has Map Token";
export const HAS_CLUE_TOKEN_COLUMN = "Has Clue Token";

/** NXT is the live league — always use LIVE_SHEET_ID. */
export function nxtSheet(): LeagueSheet {
  return liveSheet;
}

/** Starting pool: one pack from each set in the NXT pool mix. */
export const NXT_STARTING_POOL_CMD = "!pool HOB|SOS|ECL|TLA|EOE|FIN";

export interface NxtSetDef {
  readonly code: string;
  readonly command: string;
  readonly label: string;
}

/** Sets used for starting pools and token rerolls. */
export const NXT_SETS: readonly NxtSetDef[] = [
  { code: "fin", command: "!fin", label: "Final Fantasy" },
  { code: "eoe", command: "!eoe", label: "Edge of Eternities" },
  { code: "tla", command: "!tla", label: "Avatar: The Last Airbender" },
  { code: "ecl", command: "!ecl", label: "Lorwyn Eclipsed" },
  { code: "sos", command: "!sos", label: "Secrets of Strixhaven" },
  { code: "hob", command: "!hob", label: "The Hobbit" },
];

export interface ComebackPackTier {
  readonly minWins: number;
  readonly maxWins: number | null;
  readonly code: string;
  readonly command: string;
  readonly label: string;
}

/**
 * Comeback pack by the loser's current win count.
 * Ranges are inclusive on both ends (except 10+).
 */
export const COMEBACK_PACK_TIERS: readonly ComebackPackTier[] = [
  {
    minWins: 0,
    maxWins: 1,
    code: "fin",
    command: "!fin",
    label: "Final Fantasy",
  },
  {
    minWins: 2,
    maxWins: 3,
    code: "eoe",
    command: "!eoe",
    label: "Edge of Eternities",
  },
  {
    minWins: 4,
    maxWins: 5,
    code: "tla",
    command: "!tla",
    label: "Avatar: The Last Airbender",
  },
  {
    minWins: 6,
    maxWins: 7,
    code: "ecl",
    command: "!ecl",
    label: "Lorwyn Eclipsed",
  },
  {
    minWins: 8,
    maxWins: 9,
    code: "sos",
    command: "!sos",
    label: "Secrets of Strixhaven",
  },
  {
    minWins: 10,
    maxWins: null,
    code: "hob",
    command: "!hob",
    label: "The Hobbit",
  },
];

/** Booster Tutor command for a loser's win total. */
export function comebackPackCommand(wins: number): ComebackPackTier {
  for (const tier of COMEBACK_PACK_TIERS) {
    if (wins < tier.minWins) continue;
    if (tier.maxWins !== null && wins > tier.maxWins) continue;
    return tier;
  }
  return COMEBACK_PACK_TIERS[COMEBACK_PACK_TIERS.length - 1];
}

export function nxtSetByCode(code: string): NxtSetDef | undefined {
  return NXT_SETS.find((s) => s.code === code.toLowerCase());
}

/** Parses a `[fin]`-style set tag from a Pool Changes comment. */
export function setCodeFromComment(
  comment: string | null | undefined,
): string | undefined {
  const match = comment?.match(/\[(fin|eoe|tla|ecl|sos|hob)\]/i);
  return match?.[1]?.toLowerCase();
}
