import type { LeagueSheet } from "../../standings.ts";
import { ROWNUM } from "../../standings.ts";
import { choice } from "../../random.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { z } from "zod";

export const DM_SENT_COLUMN = "DM Sent";
export const PACK_CHOSEN_COLUMN = "Pack Chosen";

/** Matches sheet columns F–G for Marvel (replaces Script Handled / Bot Messaged). */
export const marvelMatchBotColumns = {
  [DM_SENT_COLUMN]: z.coerce.boolean().optional(),
  [PACK_CHOSEN_COLUMN]: z.union([z.coerce.boolean(), z.string()]).optional(),
};

type MarvelMatchRow = {
  [ROWNUM]: number;
  Timestamp: number;
  "Your Name": string;
  "Loser Name": string;
  Notes?: string;
  MATCHTYPE: string;
  [DM_SENT_COLUMN]?: boolean;
  [PACK_CHOSEN_COLUMN]?: boolean | string;
};

type MarvelMatches = {
  readonly rows: readonly MarvelMatchRow[];
};

export type { MarvelMatchRow };

export const HERO_SCORE_COLUMN = "Hero Score";

export const marvelPlayerExtras = {
  [HERO_SCORE_COLUMN]: z.coerce.number().optional(),
};

export interface ComebackPackDef {
  readonly id: string;
  readonly command: string;
  readonly label: string;
  readonly heroScoreDelta: number;
  readonly blurb: string;
}

export const MSH_PACK: ComebackPackDef = {
  id: "msh",
  command: "!msh",
  label: "Marvel Superheroes",
  heroScoreDelta: 0,
  blurb:
    "Recruit an ally to help you on your mission. Receive an MSH Comeback Pack. No change to your Hero Score.",
};

export const HERO_PACKS: readonly ComebackPackDef[] = [
  {
    id: "ltr",
    command: "!ltr",
    label: "Lord of the Rings",
    heroScoreDelta: 1,
    blurb:
      "Embark on a quest to find justice, no matter what it costs you. Receive an LTR Comeback Pack and +1 Hero Score.",
  },
  {
    id: "tla",
    command: "!tla",
    label: "Avatar: The Last Airbender",
    heroScoreDelta: 2,
    blurb:
      "Return to your secret headquarters and continue your hero training. Receive a TLA Comeback Pack and +2 Hero Score.",
  },
  {
    id: "mkm",
    command: "!mkm",
    label: "Murders at Karlov Manor",
    heroScoreDelta: 3,
    blurb:
      "No time to rest, search for clues at the scene of the crime. Receive an MKM Comeback Pack and +3 Hero Score.",
  },
];

export const VILLAIN_PACKS: readonly ComebackPackDef[] = [
  {
    id: "tmt",
    command: "!tmt",
    label: "Teenage Mutant Ninja Turtles",
    heroScoreDelta: -1,
    blurb:
      "There is strength in numbers. Join the local vigilante gang. Take a TMT Comeback Pack and -1 Hero Score.",
  },
  {
    id: "otj",
    command: "!otj",
    label: "Outlaws of Thunder Junction",
    heroScoreDelta: -2,
    blurb:
      "You'll never get anything done following the rules, it's time to operate outside the law. Take an OTJ Comeback Pack and -2 Hero Score.",
  },
  {
    id: "spm",
    command: "!spm",
    label: "Spider-Man",
    heroScoreDelta: -3,
    blurb: "Get revenge. Take an SPM Comeback Pack and -3 Hero Score.",
  },
];

export interface ComebackOffers {
  readonly heroPack: ComebackPackDef;
  readonly villainPack: ComebackPackDef;
}

const COMEBACK_COMMENT_PREFIX = "Comeback:";

/** Whether MSH is offered (unavailable if the previous loss chose MSH). */
export function mshAvailable(
  poolChanges: Awaited<ReturnType<LeagueSheet["getPoolChanges"]>>,
  playerName: string,
): boolean {
  const last = lastComebackChange(poolChanges, playerName);
  if (!last?.Comment) return true;
  return !last.Comment.toLowerCase().includes("comeback: msh");
}

function lastComebackChange(
  poolChanges: Awaited<ReturnType<LeagueSheet["getPoolChanges"]>>,
  playerName: string,
) {
  return poolChanges.rows.filter((c) =>
    c.Name === playerName &&
    c.Type === "add pack" &&
    c.Comment?.startsWith(COMEBACK_COMMENT_PREFIX)
  ).at(-1);
}

/** Rolls one hero and one villain pack to offer for this loss. */
export function rollComebackOffers(): ComebackOffers {
  const heroPack = choice([...HERO_PACKS]);
  const villainPack = choice([...VILLAIN_PACKS]);
  if (!heroPack || !villainPack) {
    throw new Error("Comeback packs not configured");
  }
  return { heroPack, villainPack };
}

const OFFERS_SUFFIX_RE = /\[marvel-offers:([^,]+),([^,\]]+)(?:,(msh))?\]\s*$/;

/** Persists rolled offers on the match row (Notes) for later interaction handling. */
export function encodeOffersInNotes(
  notes: string | undefined,
  offers: ComebackOffers,
  mshOffered: boolean,
): string {
  const base = notes?.replace(/\n?\[marvel-offers:[^\]]+\]\s*$/, "").trim() ??
    "";
  const suffix = mshOffered
    ? `[marvel-offers:${offers.heroPack.id},${offers.villainPack.id},msh]`
    : `[marvel-offers:${offers.heroPack.id},${offers.villainPack.id}]`;
  return base ? `${base}\n${suffix}` : suffix;
}

export function parseOffersFromNotes(
  notes?: string,
): { offers: ComebackOffers; mshOffered: boolean } | undefined {
  const match = notes?.match(OFFERS_SUFFIX_RE);
  if (!match) return undefined;
  const heroPack = comebackPackById(match[1]);
  const villainPack = comebackPackById(match[2]);
  if (!heroPack || !villainPack) return undefined;
  return {
    offers: { heroPack, villainPack },
    mshOffered: match[3] === "msh",
  };
}

const ALL_COMEBACK_PACKS: readonly ComebackPackDef[] = [
  MSH_PACK,
  ...HERO_PACKS,
  ...VILLAIN_PACKS,
];

export function comebackPackById(packId: string): ComebackPackDef | undefined {
  return ALL_COMEBACK_PACKS.find((p) => p.id === packId);
}

export function resolveOfferedPack(
  offers: ComebackOffers,
  mshOffered: boolean,
  packId: string,
): ComebackPackDef | undefined {
  if (packId === MSH_PACK.id && mshOffered) return MSH_PACK;
  if (packId === offers.heroPack.id) return offers.heroPack;
  if (packId === offers.villainPack.id) return offers.villainPack;
  return undefined;
}

/** Row is fully handled (pack chosen, eliminated, rejected, etc.). */
export function isComebackRowComplete(
  match: Pick<MarvelMatchRow, typeof PACK_CHOSEN_COLUMN>,
): boolean {
  return Boolean(match[PACK_CHOSEN_COLUMN]);
}

/** DM sent but player has not picked a pack yet. */
export function isComebackAwaitingChoice(
  match: Pick<
    MarvelMatchRow,
    typeof DM_SENT_COLUMN | typeof PACK_CHOSEN_COLUMN
  >,
): boolean {
  return Boolean(match[DM_SENT_COLUMN]) && !match[PACK_CHOSEN_COLUMN];
}

/** Any other loss row for this player still waiting on a pack choice. */
export function hasOpenComebackForPlayer(
  matches: MarvelMatches,
  loserName: string,
  excludeRowNum: number,
): boolean {
  return matches.rows.some((m) => {
    if (m.MATCHTYPE !== "match") return false;
    const row = m as MarvelMatchRow;
    return row["Loser Name"] === loserName &&
      row[ROWNUM] !== excludeRowNum &&
      isComebackAwaitingChoice(row);
  });
}

export function markRowDmSent(
  matches: MarvelMatches,
  rowNum: number,
): void {
  const row = matches.rows.find((m) =>
    m.MATCHTYPE === "match" && m[ROWNUM] === rowNum
  ) as MarvelMatchRow | undefined;
  if (row) row[DM_SENT_COLUMN] = true;
}

export function markRowPackChosen(
  matches: MarvelMatches,
  rowNum: number,
  value: boolean | string = true,
): void {
  const row = matches.rows.find((m) =>
    m.MATCHTYPE === "match" && m[ROWNUM] === rowNum
  ) as MarvelMatchRow | undefined;
  if (row) row[PACK_CHOSEN_COLUMN] = value;
}

export function packGenCommand(
  pack: ComebackPackDef,
  discordId: string,
): string {
  return `${pack.command} <@${discordId}>`;
}

export function comebackComment(
  pack: ComebackPackDef,
): string {
  const deltaStr = pack.heroScoreDelta === 0
    ? "±0"
    : (pack.heroScoreDelta > 0 ? "+" : "") + pack.heroScoreDelta;
  return `${COMEBACK_COMMENT_PREFIX} ${pack.id} (${deltaStr})`;
}

export function buildComebackMessage(
  winnerName: string,
  mshOffered: boolean,
  offers: ComebackOffers,
): string {
  const lines = [
    `You've suffered a defeat at the hands of **${winnerName}**. What is your next step?`,
    "",
  ];

  const offered: ComebackPackDef[] = [offers.heroPack, offers.villainPack];
  if (mshOffered) offered.push(MSH_PACK);

  for (const pack of offered) {
    lines.push(`**${pack.label}**`, pack.blurb, "");
  }

  if (!mshOffered) {
    lines.push(
      "_MSH unavailable — you recruited an ally after your last loss._",
    );
  }

  return lines.join("\n").trim();
}

/** First sentence of a pack blurb, trimmed for Discord select menu descriptions. */
export function formatHeroScoreDelta(delta: number): string {
  if (delta === 0) return "±0 Hero Score";
  return `${delta > 0 ? "+" : ""}${delta} Hero Score`;
}

export function formatHeroScore(score: number): string {
  if (score === 0) return "0";
  return `${score > 0 ? "+" : ""}${score}`;
}

export function comebackMenuLabel(pack: ComebackPackDef): string {
  const suffix = pack.heroScoreDelta === 0
    ? " (±0)"
    : ` (${pack.heroScoreDelta > 0 ? "+" : ""}${pack.heroScoreDelta})`;
  const label = `${pack.label}${suffix}`;
  return label.length <= 100
    ? label
    : `${pack.label.slice(0, 100 - suffix.length)}${suffix}`;
}

export function comebackMenuDescription(pack: ComebackPackDef): string {
  const hook = pack.blurb.split(/\.\s/)[0] + ".";
  const score = formatHeroScoreDelta(pack.heroScoreDelta);
  const combined = `${hook} · ${score}`;
  if (combined.length <= 100) return combined;
  const suffix = `… · ${score}`;
  const budget = 100 - suffix.length;
  return `${hook.slice(0, Math.max(0, budget)).trimEnd()}${suffix}`;
}

export async function updateHeroScore(
  sheet: LeagueSheet,
  rowNum: number,
  heroScoreColumn: number,
  currentScore: number,
  delta: number,
) {
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Player Database!R${rowNum}C${heroScoreColumn + 1}`,
    [[currentScore + delta]],
    "RAW",
  );
}
