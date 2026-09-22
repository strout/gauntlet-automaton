import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { CONFIG } from "../../config.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { readTable, ROW, ROWNUM } from "../../standings.ts";

const POLL_MS = 60_000;
const RIVAL_PAIRINGS_TAB = "Rival Pairings";
const FRA_REGISTRATION_TAB = "FRA";
const ANNOUNCED_COLUMN = "Announced";

/** Column indexes on the FRA registration tab (0-based). */
const FRA_COL = {
  fullName: 1, // B
  arenaId: 4, // E
  discordId: 9, // J
} as const;

type Registrant = {
  readonly identification: string;
  readonly discordId: string;
};

/**
 * Poll registration Rival Pairings and announce new pairs in general chat.
 */
export async function watchFraRivals(client: Client): Promise<never> {
  while (true) {
    try {
      await announceRivalPairings(client);
    } catch (err) {
      console.error("[fra] rival pairing watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Unannounced Rival Pairings rows: resolve Discord IDs from the registration
 * FRA tab and tag both rivals in GENERAL_CHAT_CHANNEL_ID.
 *
 * Rival Pairings (registration spreadsheet):
 * - Column B / C: Identification (`Full Name - ArenaId`)
 * - Announced: set true after a successful announce
 *
 * FRA registration tab:
 * - B Full Name, E Arena Player ID#, J Discord ID
 * - Identification = `${Full Name} - ${Arena Player ID#}`
 */
export async function announceRivalPairings(client: Client): Promise<void> {
  const channelId = CONFIG.GENERAL_CHAT_CHANNEL_ID;

  console.log("[fra] Checking Rival Pairings…");

  const [pairTable, registrants] = await Promise.all([
    readTable(
      `${RIVAL_PAIRINGS_TAB}!A:Z`,
      1,
      CONFIG.REGISTRATION_SHEET_ID,
    ),
    loadFraRegistrants(),
  ]);

  const announcedCol = pairTable.headerColumns[ANNOUNCED_COLUMN];
  if (announcedCol === undefined) {
    console.error(
      `[fra] Rival Pairings needs an "${ANNOUNCED_COLUMN}" column header ` +
        `(use column D). Skipping until it exists.`,
    );
    return;
  }

  const channel = await client.channels.fetch(channelId) as TextChannel | null;
  if (!channel) {
    console.error("[fra] Could not find general chat channel:", channelId);
    return;
  }

  for (const row of pairTable.rows) {
    const announced = row[ANNOUNCED_COLUMN];
    if (announced === true || announced === "TRUE" || announced === 1) {
      continue;
    }

    const raw = row[ROW];
    const name1 = cellString(raw[1]); // column B
    const name2 = cellString(raw[2]); // column C
    if (!name1 || !name2) continue;

    const player1 = findRegistrant(registrants, name1);
    const player2 = findRegistrant(registrants, name2);

    if (!player1 || !player2) {
      console.warn(
        `[fra] [Row ${row[ROWNUM]}] Missing FRA registration for rivals: ` +
          `${name1} / ${name2}` +
          `${!player1 ? ` (missing: ${name1})` : ""}` +
          `${!player2 ? ` (missing: ${name2})` : ""}`,
      );
      continue;
    }

    if (!player1.discordId || !player2.discordId) {
      console.warn(
        `[fra] [Row ${
          row[ROWNUM]
        }] Missing Discord ID for rivals: ${name1} / ${name2}`,
      );
      continue;
    }

    try {
      await channel.send(
        formatRivalAnnouncement(player1.discordId, player2.discordId),
      );
    } catch (err) {
      console.error(
        `[fra] Failed to announce rival pairing row ${row[ROWNUM]}:`,
        err,
      );
      continue;
    }

    await sheetsWrite(
      sheets,
      CONFIG.REGISTRATION_SHEET_ID,
      `${RIVAL_PAIRINGS_TAB}!R${row[ROWNUM]}C${announcedCol + 1}`,
      [[true]],
      "USER_ENTERED",
    );
    console.log(
      `[fra] Announced rivals row ${row[ROWNUM]}: ${name1} ↔ ${name2}`,
    );
  }
}

async function loadFraRegistrants(): Promise<readonly Registrant[]> {
  const table = await readTable(
    `${FRA_REGISTRATION_TAB}!A:J`,
    1,
    CONFIG.REGISTRATION_SHEET_ID,
  );

  const registrants: Registrant[] = [];
  for (const row of table.rows) {
    const raw = row[ROW];
    const fullName = cellString(raw[FRA_COL.fullName]);
    const arenaId = cellString(raw[FRA_COL.arenaId]);
    const discordId = cellString(raw[FRA_COL.discordId]);
    if (!fullName || !arenaId) continue;
    registrants.push({
      identification: `${fullName} - ${arenaId}`,
      discordId: discordId ?? "",
    });
  }
  return registrants;
}

const RIVAL_ANNOUNCEMENTS: readonly string[] = [
  "XXXX and YYYY, rivals from rival multiverses, will prove who is superior once and for all in Reality Fracture League.",
  "The battle we’ve all been waiting for, XXXX vs. YYYY winner-takes-all in Reality Fracture League!",
  "Time to bury their ancient grudge: XXXX takes on YYYY to settle the score in Reality Fracture League.",
  "XXXX and YYYY are entering Reality Fracture League together, but only one can emerge triumphant.",
  "There can be only one! XXXX vs YYYY. Reality Fracture League.",
];

function formatRivalAnnouncement(player1Id: string, player2Id: string): string {
  const template = RIVAL_ANNOUNCEMENTS[
    Math.floor(Math.random() * RIVAL_ANNOUNCEMENTS.length)
  ];
  return template
    .replaceAll("XXXX", `<@!${player1Id}>`)
    .replaceAll("YYYY", `<@!${player2Id}>`);
}

function cellString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function findRegistrant(
  registrants: readonly Registrant[],
  identification: string,
): Registrant | undefined {
  const needle = identification.trim();
  return registrants.find((p) =>
    p.identification === needle ||
    p.discordId === needle
  );
}
