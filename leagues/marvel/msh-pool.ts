import type { LeagueSheet } from "../../standings.ts";
import { ROWNUM } from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import {
  comebackMenuLabel,
  comebackPackById,
  ComebackPackDef,
  HERO_SCORE_COLUMN,
  marvelPlayerExtras,
} from "./comeback.ts";

export const MSH_POOL_CMD = "!mshpool";
export const MSH_POOL_PENDING_COMMENT = "MSH pool - pending origin";
export const MSH_POOL_DONE_COMMENT = "MSH pool";
export const MSH_POOL_PACK_GEN = "!pool MSH|MSH|MSH|MSH|MSH";
export const MARVEL_MSHPOOL_SELECT_ID = "marvel-mshpool-select";

/** Origin choice order: hero paths high → low, then villain paths. */
export const MSH_ORIGIN_PACK_IDS = [
  "mkm",
  "tla",
  "ltr",
  "tmt",
  "otj",
  "spm",
] as const;

export const MSH_ORIGIN_BLURBS: Record<string, string> = {
  mkm:
    "1. You were a master detective but you've turned in your gun and your badge. You aren't just going to stand by and wait for crimes to be committed. You begin with one **MKM Pack** and +3 Hero Score.",
  tla:
    "2. The prophecy told of a child with special powers… You begin with one **TLA Pack** and +2 Hero Score.",
  ltr:
    "3. You have been entrusted with an ancient ring that gives you untold powers … if you can resist its temptations. You begin with one **LTR Pack** and +1 Hero Score.",
  tmt:
    "4. You joined a gang as a runaway teen, where you were trained in the arts of stealth, disguise and deadly hand-to-hand combat. You begin with one **TMT Pack** and -1 Hero Score.",
  otj:
    "5. Accused of a crime you have no memory of committing, you were forced to flee your home and abandon your family to live outside the law. You begin with one **OTJ Pack** and -2 Hero Score.",
  spm:
    "6. They refused to fund your scientific research, saying it was unethical and dangerous. But they can't stop you from testing your formula on yourself! You begin with one **SPM Pack** and -3 Hero Score.",
};

export function mshOriginPacks(): ComebackPackDef[] {
  return MSH_ORIGIN_PACK_IDS.map((id) => comebackPackById(id)).filter((
    p,
  ): p is ComebackPackDef => p !== undefined);
}

const DISCORD_SELECT_DESC_MAX = 100;

function truncateSelectDescription(text: string): string {
  if (text.length <= DISCORD_SELECT_DESC_MAX) return text;
  return text.slice(0, DISCORD_SELECT_DESC_MAX - 1) + "…";
}

/** Flavor hook for the dropdown (hero score is already in the label). */
export function originMenuDescription(pack: ComebackPackDef): string {
  const blurb = MSH_ORIGIN_BLURBS[pack.id] ?? pack.blurb;
  const hook = blurb.split(/\s+You begin\b/i)[0].trim();
  const line = hook.endsWith("…") ? hook : `${hook}.`;
  return truncateSelectDescription(line);
}

export function buildMshOriginMessage(): string {
  const lines = [
    "Five packs of Marvel Superheroes are yours. Who were you before you walked away from it all?",
    "",
  ];
  for (const pack of mshOriginPacks()) {
    lines.push(MSH_ORIGIN_BLURBS[pack.id] ?? pack.blurb, "");
  }
  return lines.join("\n").trim();
}

export function mshPoolSelectCustomId(discordId: string): string {
  return `${MARVEL_MSHPOOL_SELECT_ID}:${discordId}`;
}

export function parseMshPoolDiscordId(customId: string): string | undefined {
  if (!customId.startsWith(`${MARVEL_MSHPOOL_SELECT_ID}:`)) return undefined;
  return customId.slice(MARVEL_MSHPOOL_SELECT_ID.length + 1) || undefined;
}

export function originComment(pack: ComebackPackDef): string {
  const deltaStr = pack.heroScoreDelta === 0
    ? "±0"
    : (pack.heroScoreDelta > 0 ? "+" : "") + pack.heroScoreDelta;
  return `Origin: ${pack.id} (${deltaStr})`;
}

export function findPendingMshPool(
  poolChanges: Awaited<ReturnType<LeagueSheet["getPoolChanges"]>>,
  playerName: string,
) {
  return poolChanges.rows.findLast((c) =>
    c.Name === playerName &&
    c.Type === "starting pool" &&
    c.Comment === MSH_POOL_PENDING_COMMENT
  );
}

export async function updatePoolChangeComment(
  sheet: LeagueSheet,
  poolChangeRowNum: number,
  comment: string,
) {
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!R${poolChangeRowNum}C5`,
    [[comment]],
    "RAW",
  );
}

export async function setHeroScore(
  sheet: LeagueSheet,
  rowNum: number,
  heroScoreColumn: number,
  score: number,
) {
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Player Database!R${rowNum}C${heroScoreColumn + 1}`,
    [[score]],
    "RAW",
  );
}

export async function lookupPlayerByDiscordId(
  sheet: LeagueSheet,
  discordId: string,
) {
  const players = await sheet.getPlayers(marvelPlayerExtras);
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) return undefined;
  const heroScoreCol = players.headerColumns[HERO_SCORE_COLUMN];
  return { players, player, heroScoreCol };
}

export { comebackMenuLabel, marvelPlayerExtras, ROWNUM };
