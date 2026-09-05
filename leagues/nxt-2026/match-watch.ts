import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { CONFIG } from "../../config.ts";
import { getEntropyAnnouncer } from "../../entropy.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { MATCHTYPE, ROWNUM } from "../../standings.ts";
import {
  comebackPackCommand,
  MATCH_ANNOUNCED_COLUMN,
  nxtSheet,
} from "./constants.ts";

const POLL_MS = 30_000;

/** Poll NXT matches and entropy; win-tiered comeback packs for losers. */
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

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
