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
  arenaId: 4, // E
  discordId: 9, // J
} as const;

type Registrant = {
  readonly arenaId: string;
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
 * - Column B / C: Identification (`Full Name - ArenaId`); we match on ArenaId
 * - Announced: set true after a successful announce
 *
 * FRA registration tab:
 * - E Arena Player ID#, J Discord ID
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
    const id1 = cellString(raw[1]); // column B
    const id2 = cellString(raw[2]); // column C
    if (!id1 || !id2) continue;

    const arena1 = arenaIdFromIdentification(id1);
    const arena2 = arenaIdFromIdentification(id2);
    if (!arena1 || !arena2) {
      console.warn(
        `[fra] [Row ${
          row[ROWNUM]
        }] Could not parse Arena ID from: ${id1} / ${id2}`,
      );
      continue;
    }

    const player1 = findRegistrant(registrants, arena1);
    const player2 = findRegistrant(registrants, arena2);

    if (!player1 || !player2) {
      console.warn(
        `[fra] [Row ${row[ROWNUM]}] Missing FRA registration for rivals: ` +
          `${arena1} / ${arena2}` +
          `${!player1 ? ` (missing: ${arena1})` : ""}` +
          `${!player2 ? ` (missing: ${arena2})` : ""}`,
      );
      continue;
    }

    if (!player1.discordId || !player2.discordId) {
      console.warn(
        `[fra] [Row ${
          row[ROWNUM]
        }] Missing Discord ID for rivals: ${arena1} / ${arena2}`,
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
      `[fra] Announced rivals row ${row[ROWNUM]}: ${arena1} ↔ ${arena2}`,
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
    const arenaId = cellString(raw[FRA_COL.arenaId]);
    const discordId = cellString(raw[FRA_COL.discordId]);
    if (!arenaId) continue;
    registrants.push({
      arenaId,
      discordId: discordId ?? "",
    });
  }
  return registrants;
}

const RIVAL_ANNOUNCEMENTS: readonly string[] = [
  "XXXX and YYYY, rivals from opposing multiverses, will prove who is superior once and for all in Reality Fracture League.",
  "The battle we’ve all been waiting for, XXXX vs. YYYY winner-takes-all in Reality Fracture League!",
  "Time to bury their ancient grudge: XXXX takes on YYYY to settle the score in Reality Fracture League.",
  "XXXX and YYYY are entering Reality Fracture League together, but only one can emerge triumphant.",
  "There can be only one! XXXX vs YYYY. Reality Fracture League.",
  "Is that XXXX? Or is it their evil döppelganger, YYYY? We will settle the question of who is the imposter in Reality Fracture League!",
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

/** `Jordan M - JMTron#46639` → `JMTron#46639`; bare Arena IDs pass through. */
function arenaIdFromIdentification(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const sep = trimmed.lastIndexOf(" - ");
  if (sep >= 0) {
    const arenaId = trimmed.slice(sep + 3).trim();
    return arenaId || null;
  }
  return trimmed;
}

function findRegistrant(
  registrants: readonly Registrant[],
  arenaId: string,
): Registrant | undefined {
  const needle = arenaId.trim().toLowerCase();
  return registrants.find((p) => p.arenaId.toLowerCase() === needle);
}
