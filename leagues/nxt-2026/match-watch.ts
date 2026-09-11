import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import { getEntropyAnnouncer } from "../../entropy.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import {
  type LeagueSheet,
  MATCHTYPE,
  parseTable,
  ROWNUM,
} from "../../standings.ts";
import {
  comebackPackCommand,
  MATCH_ANNOUNCED_COLUMN,
  nxtSheet,
} from "./constants.ts";

const POLL_MS = 30_000;
const DRAGON_MATCHES_SHEET = "Dragon Matches";
const DRAGON_DATABASE_SHEET = "Dragon Database";

/** Poll NXT matches, dragon gauntlet matches, and entropy. */
export async function watchNxtMatches(client: Client): Promise<never> {
  const sheet = nxtSheet();
  const announcer = getMatchAnnouncer(sheet, "nxt-2026");
  const entropy = getEntropyAnnouncer(
    sheet,
    "nxt-2026",
    (player) => comebackPackCommand(player.Wins).command.replace(/^!/, ""),
  );

  while (true) {
    try {
      await entropy.process(client);
      await announceNxtMatches(client, announcer);
      await announceDragonMatches(client, announcer);
    } catch (err) {
      console.error("[nxt-2026] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Unannounced match losses: announce the result, roll a comeback pack based
 * on the loser's win total (unless eliminated), and record it on Pool Changes.
 */
export async function announceNxtMatches(
  client: Client,
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  console.log("[nxt-2026] Checking for matches to announce…");

  try {
    const sheet = announcer.sheet;
    const [players, quotas, matchTable] = await Promise.all([
      sheet.getPlayers(),
      sheet.getQuotas(),
      sheet.getMatches(),
    ]);

    const matches = {
      rows: matchTable.rows,
      headers: {
        match: matchTable.headers,
        entropy: [] as string[],
      },
      headerColumns: {
        match: matchTable.headerColumns,
        entropy: {} as Record<string, number>,
      },
      sheetName: {
        match: "Matches" as const,
        entropy: "Entropy" as const,
      },
    };

    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (!packGenChannel) {
      console.error("[nxt-2026] Could not find pack generation channel");
      return;
    }

    for (const match of matches.rows) {
      if (match[MATCHTYPE] !== "match") continue;
      if (match[MATCH_ANNOUNCED_COLUMN]) continue;

      const winnerName = match["Your Name"];
      const loserName = match["Loser Name"];
      const result = match.Result;
      const note = match.Notes;
      const timestamp = match.Timestamp;

      const winnerInfo = players.rows.find((p) =>
        p.Identification === winnerName
      );
      const loserInfo = players.rows.find((p) =>
        p.Identification === loserName
      );

      if (!winnerInfo || !loserInfo) {
        console.warn(
          `[nxt-2026] [Row ${
            match[ROWNUM]
          }] Missing player info: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match[ROWNUM]
          }): could not find standings info for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await announcer.markMatchHandled(
          matches,
          match,
          MATCH_ANNOUNCED_COLUMN,
          "Error: Missing Player Info",
        );
        continue;
      }

      const winnerId = winnerInfo["Discord ID"];
      const loserId = loserInfo["Discord ID"];
      if (!winnerId || !loserId) {
        console.warn(
          `[nxt-2026] [Row ${
            match[ROWNUM]
          }] Missing Discord ID: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match[ROWNUM]
          }): could not find discord ID for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await announcer.markMatchHandled(
          matches,
          match,
          MATCH_ANNOUNCED_COLUMN,
          "Error: Missing Discord ID",
        );
        continue;
      }

      const winnerMention = `<@!${winnerId}>`;
      const loserMention = `<@!${loserId}>`;

      const currentQuota = quotas.find((q) =>
        q.fromDate <= timestamp && q.toDate >= timestamp
      );

      const alreadyPlayed = currentQuota
        ? matches.rows.some((m) => {
          if (m[MATCHTYPE] !== "match") return false;
          if (m[ROWNUM] === match[ROWNUM]) return false;
          if (
            m.Timestamp < currentQuota.fromDate ||
            m.Timestamp > currentQuota.toDate
          ) return false;
          return (
            (m["Your Name"] === winnerName && m["Loser Name"] === loserName) ||
            (m["Your Name"] === loserName && m["Loser Name"] === winnerName)
          );
        })
        : false;

      if (alreadyPlayed) {
        await packGenChannel.send(
          `Match report rejected (Row ${
            match[ROWNUM]
          }):\n* ${loserMention} and ${winnerMention} have already played this week.`,
        );
        await announcer.markMatchHandled(
          matches,
          match,
          MATCH_ANNOUNCED_COLUMN,
          "Rejected: Duplicate",
        );
        continue;
      }

      const eliminated = loserInfo.Losses >= CONFIG.MAX_LOSSES;
      const packTier = comebackPackCommand(loserInfo.Wins);
      let message = "";
      if (eliminated) {
        message = `${loserMention} was eliminated by ${winnerMention}.`;
      } else {
        message =
          `${packTier.command} ${loserMention} was defeated ${result} by ${winnerMention}.`;
      }

      if (note) {
        message += `\n> ${escapeMarkdown(note)}`;
      }

      if ((winnerInfo.Streak ?? 0) >= 5) {
        message +=
          `\n${winnerMention} is on a ${winnerInfo.Streak} win streak!`;
      }

      const winnerMatchesPlayed = winnerInfo.Wins + winnerInfo.Losses;
      const loserMatchesPlayed = loserInfo.Wins + loserInfo.Losses;
      if (currentQuota && winnerMatchesPlayed >= currentQuota.matchesMax) {
        message += `\n${winnerMention} is done for the week.`;
      }
      if (currentQuota && loserMatchesPlayed >= currentQuota.matchesMax) {
        message += `\n${loserMention} is done for the week.`;
      }

      try {
        const sentMessage = await packGenChannel.send(message);

        if (!eliminated) {
          (async () => {
            try {
              const packResult = await waitForBoosterTutor(
                Promise.resolve(sentMessage),
              );
              if ("success" in packResult) {
                await sheet.recordPackAddition(
                  loserName,
                  packResult.success,
                  `Loss against ${winnerName} [${packTier.code}]`,
                );
              } else if ("error" in packResult) {
                console.error(
                  `[nxt-2026] Booster Tutor error for ${loserName}: ${packResult.error}`,
                );
              }
            } catch (e) {
              console.error(
                `[nxt-2026] Failed to record pack for ${loserName}:`,
                e,
              );
            }
          })();
        }
      } catch (err) {
        console.error(
          "[nxt-2026] Failed to send pack generation command:",
          err,
        );
        continue;
      }

      await announcer.markMatchHandled(
        matches,
        match,
        MATCH_ANNOUNCED_COLUMN,
        true,
      );
    }
  } catch (e) {
    console.error("[nxt-2026] Error in announceNxtMatches:", e);
  }
}

/**
 * Dragon Gauntlet matches from the Dragon Matches tab — announce only, no packs.
 * Winner in Player Database = Knight win; otherwise Dragon win.
 */
export async function announceDragonMatches(
  client: Client,
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  console.log("[nxt-2026] Checking for dragon matches to announce…");

  try {
    const sheet = announcer.sheet;
    const [players, dragons, matchTable] = await Promise.all([
      sheet.getPlayers(),
      loadDragonDatabase(sheet),
      sheet.getCoreMatchesFromSheet(DRAGON_MATCHES_SHEET),
    ]);

    const matches = {
      rows: matchTable.rows,
      headers: {
        match: matchTable.headers,
        entropy: [] as string[],
      },
      headerColumns: {
        match: matchTable.headerColumns,
        entropy: {} as Record<string, number>,
      },
      sheetName: {
        match: DRAGON_MATCHES_SHEET,
        entropy: "Entropy" as const,
      },
    };

    const channel = await client.channels.fetch(
      CONFIG.DRAGON_GAUNTLET_CHANNEL_ID,
    ) as TextChannel;
    if (!channel) {
      console.error("[nxt-2026] Could not find dragon gauntlet channel");
      return;
    }

    const knights = players.rows as unknown as readonly NamedDiscordRow[];

    for (const match of matches.rows) {
      if (match[MATCHTYPE] !== "match") continue;
      if (match[MATCH_ANNOUNCED_COLUMN]) continue;

      const winnerName = match["Your Name"];
      const loserName = match["Loser Name"];

      const winnerKnight = findNamedRow(knights, winnerName);
      const loserKnight = findNamedRow(knights, loserName);

      // Knights are out after one Dragon Matches loss — skip further reports.
      const eliminatedKnight = [winnerKnight, loserKnight].find((knight) =>
        knight !== undefined &&
        knightAlreadyLost(matches.rows, knights, knight, match[ROWNUM])
      );
      if (eliminatedKnight) {
        const mention = resolveMention(
          eliminatedKnight.Identification,
          eliminatedKnight["Discord ID"],
        );
        await channel.send(
          `Match report rejected (Row ${
            match[ROWNUM]
          }):\n* Knight ${mention} has already been eliminated from the Dragon Gauntlet.`,
        );
        await announcer.markMatchHandled(
          matches,
          match,
          MATCH_ANNOUNCED_COLUMN,
          "Rejected: Knight already eliminated",
        );
        continue;
      }

      const winnerMention = resolveMention(
        winnerName,
        winnerKnight?.["Discord ID"] ??
          findNamedRow(dragons, winnerName)?.["Discord ID"],
      );
      const loserMention = resolveMention(
        loserName,
        loserKnight?.["Discord ID"] ??
          findNamedRow(dragons, loserName)?.["Discord ID"],
      );

      // Knight = in Player Database; Dragon = not.
      const knightWon = winnerKnight !== undefined;
      const message = knightWon
        ? `Knight ${winnerMention} has emerged victorious over Dragon ${loserMention}, and can continue on in the gauntlet.`
        : `Dragon ${winnerMention} has burnt Knight ${loserMention} to a crisp. Their gauntlet has come to an end.`;

      try {
        await channel.send(message);
      } catch (err) {
        console.error(
          "[nxt-2026] Failed to send dragon match announcement:",
          err,
        );
        continue;
      }

      await announcer.markMatchHandled(
        matches,
        match,
        MATCH_ANNOUNCED_COLUMN,
        true,
      );
    }
  } catch (e) {
    console.error("[nxt-2026] Error in announceDragonMatches:", e);
  }
}

/** Prefer known Discord ID; fall back to a bare snowflake in the name cell. */
function resolveMention(
  name: string,
  discordId: string | undefined,
): string {
  if (discordId) return `<@!${discordId}>`;
  if (/^\d{15,20}$/.test(name.trim())) return `<@!${name.trim()}>`;
  return `**${name}**`;
}

type NamedDiscordRow = {
  readonly Identification: string;
  readonly Name: string;
  readonly "Discord ID": string;
};

async function loadDragonDatabase(
  sheet: LeagueSheet,
): Promise<readonly NamedDiscordRow[]> {
  const table = await sheet.readTable(`${DRAGON_DATABASE_SHEET}!A:D`, 1);
  const filtered = {
    ...table,
    rows: table.rows.filter((x) =>
      typeof x.Identification === "string" && x.Identification.length > 4
    ),
  };
  const parsed = parseTable({
    Identification: z.string(),
    Name: z.string(),
    "Arena ID": z.string(),
    "Discord ID": z.coerce.string(),
  }, filtered);
  return parsed.rows;
}

function findNamedRow(
  rows: readonly NamedDiscordRow[],
  name: string,
): NamedDiscordRow | undefined {
  return rows.find((p) => namesMatchRow(p, name));
}

function namesMatchRow(row: NamedDiscordRow, name: string): boolean {
  return (
    row.Identification === name ||
    row.Name === name ||
    row["Discord ID"] === name
  );
}

/** True if this knight appears as Loser Name on an earlier Dragon Matches row. */
function knightAlreadyLost(
  rows: readonly {
    [ROWNUM]: number;
    [MATCHTYPE]: string;
    "Loser Name": string;
  }[],
  players: readonly NamedDiscordRow[],
  knight: NamedDiscordRow,
  beforeRow: number,
): boolean {
  return rows.some((prior) => {
    if (prior[MATCHTYPE] !== "match") return false;
    if (prior[ROWNUM] >= beforeRow) return false;
    if (!namesMatchRow(knight, prior["Loser Name"])) return false;
    // Confirm the prior loser was a knight (in Player Database).
    return findNamedRow(players, prior["Loser Name"]) !== undefined;
  });
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
