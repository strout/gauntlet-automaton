import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { CONFIG } from "../../config.ts";
import { choice } from "../../random.ts";
import { fetchSealedDeck, type SealedDeckPool } from "../../sealeddeck.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { type LeagueSheet, ROWNUM } from "../../standings.ts";
import { trkSheet } from "./constants.ts";

const POLL_MS = 60_000;
const ASSIMILATION_SHEET = "Assimilation";
const PLAYER_COLUMN = "Your Name";
const CARD_COLUMN = "Card to be added to Borg pool upon assimilation";
const VALID_COLUMN = "Valid?";

const SHAMES = [
  "Your compliance has been found wanting. The Collective is disappointed.",
  "Your submission has been deemed unworthy of assimilation. Shame is now part of your designation.",
  "You have failed to meet the Collective's standards. Your inadequacy has been noted.",
  "Resistance was futile. Compliance was apparently optional.",
  "Your biological distinctiveness is no excuse for such a failure.",
  "The Collective has detected a defect. Your shame will be remembered across all drones.",
] as const;

/** Poll Assimilation rows whose Valid? cell is still empty. */
export async function watchTrkAssimilation(client: Client): Promise<never> {
  let warned = false;
  while (true) {
    const sheet = trkSheet();
    if (!sheet) {
      if (!warned) {
        console.log("[trk] No UPCOMING_SHEET_ID; assimilation watch is idle.");
        warned = true;
      }
    } else {
      try {
        await checkTrkAssimilation(client, sheet);
      } catch (err) {
        console.error("[trk] assimilation watch error:", err);
      }
    }
    await delay(POLL_MS);
  }
}

/**
 * An empty Valid? cell is checked against that player's starting pool.
 * A card that is not in the pool is marked false and shamed in general chat.
 * A card that is in the pool is marked true.
 */
export async function checkTrkAssimilation(
  client: Client,
  sheet: LeagueSheet,
): Promise<void> {
  console.log("[trk] Checking assimilation submissions…");
  const [table, players, poolChanges] = await Promise.all([
    sheet.readTable(`${ASSIMILATION_SHEET}!A:E`),
    sheet.getPlayers(),
    sheet.getPoolChanges(),
  ]);
  const validColumn = table.headerColumns[VALID_COLUMN];
  if (validColumn === undefined) {
    throw new Error(`Assimilation tab has no "${VALID_COLUMN}" column`);
  }

  for (const row of table.rows) {
    if (!isBlank(row[VALID_COLUMN])) continue;
    const name = cellText(row[PLAYER_COLUMN]);
    const card = cellText(row[CARD_COLUMN]);
    if (!name || !card) continue;

    const player = players.rows.find((p) => p.Identification === name);
    if (!player) {
      console.warn(
        `[trk] Assimilation row ${row[ROWNUM]}: no player named ${name}`,
      );
      continue;
    }
    const discordId = `${player["Discord ID"] ?? ""}`.trim();
    if (!discordId) {
      console.warn(
        `[trk] Assimilation row ${row[ROWNUM]}: ${name} has no Discord ID`,
      );
      continue;
    }

    const poolId = startingPoolId(poolChanges.rows, name);
    if (!poolId) {
      console.warn(
        `[trk] Assimilation row ${row[ROWNUM]}: ${name} has no starting pool`,
      );
      continue;
    }

    let pool: SealedDeckPool;
    try {
      pool = await fetchSealedDeck(poolId);
    } catch (err) {
      console.error(
        `[trk] Assimilation row ${row[ROWNUM]}: could not read pool ${poolId}:`,
        err,
      );
      continue;
    }

    const valid = cardInPool(pool, card);
    if (valid) {
      await markValid(sheet, row[ROWNUM], validColumn, true);
      continue;
    }

    const channel = await client.channels.fetch(CONFIG.GENERAL_CHAT_CHANNEL_ID);
    if (!(channel instanceof TextChannel)) {
      console.error("[trk] Could not find general chat");
      return;
    }
    const line = choice(SHAMES) ?? SHAMES[0];
    await channel.send(
      `<@${discordId}> ${line}\nYou did not select a card that is in your starting pool. (**${card}**)`,
    );
    await markValid(sheet, row[ROWNUM], validColumn, false);
  }
}

function startingPoolId(
  rows: readonly {
    Name: string;
    Type: string;
    Value: string;
    "Full Pool"?: string | null;
  }[],
  name: string,
): string {
  const row = rows.findLast((change) =>
    change.Name === name && change.Type === "starting pool"
  );
  const raw = `${row?.["Full Pool"] || row?.Value || ""}`.trim();
  const fromUrl = raw.match(
    /sealeddeck\.tech\/(?:api\/pools\/)?([A-Za-z0-9]+)/,
  );
  return fromUrl?.[1] ?? raw;
}

function cardInPool(pool: SealedDeckPool, submitted: string): boolean {
  const want = normalizeName(submitted);
  const names = [
    ...pool.sideboard,
    ...pool.deck,
    ...pool.hidden,
  ].map((card) => card.name);
  return names.some((name) => {
    const have = normalizeName(name);
    return have === want ||
      have.startsWith(`${want} //`) ||
      have.startsWith(`${want} /`);
  });
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function markValid(
  sheet: LeagueSheet,
  rowNum: number,
  column: number,
  valid: boolean,
): Promise<unknown> {
  return sheetsWrite(
    sheets,
    sheet.sheetId,
    `${ASSIMILATION_SHEET}!R${rowNum}C${column + 1}`,
    [[valid]],
    "RAW",
  );
}
