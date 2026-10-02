import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { CONFIG } from "../../config.ts";
import { getEntropyAnnouncer } from "../../entropy.ts";
import {
  getMatchAnnouncer,
  type MatchAnnouncer,
} from "../../match_announcer.ts";
import { MATCHTYPE, ROWNUM } from "../../standings.ts";
import { MATCH_ANNOUNCED_COLUMN, resolveFraSheet } from "./constants.ts";

const POLL_MS = 30_000;
/** Handled by `fracturePackHandler`, which also Empowers Jace. */
const FRACTURE_COMMAND = "fracture";

/** Poll FRA matches and entropy; losses post `!fracture` in pack-gen. */
export async function watchFraMatches(client: Client): Promise<never> {
  while (true) {
    try {
      const sheet = await resolveFraSheet();
      const entropy = getEntropyAnnouncer(sheet, "fra", FRACTURE_COMMAND, {
        recordBoosterTutorPack: false,
      });
      await entropy.process(client);
      await announceFraMatches(client, getMatchAnnouncer(sheet));
    } catch (err) {
      console.error("[fra] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Unannounced match losses: announce the result and, unless the loser is
 * eliminated, post `!fracture @loser …` so their comeback pack is rolled.
 */
export async function announceFraMatches(
  client: Client,
  announcer: MatchAnnouncer,
): Promise<void> {
  console.log("[fra] Checking for matches to announce…");

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
      console.error("[fra] Could not find pack generation channel");
      return;
    }

    for (const match of matches.rows) {
      if (match[MATCHTYPE] !== "match") continue;
      if (match[MATCH_ANNOUNCED_COLUMN]) continue;

      const winnerName = match["Your Name"];
      const loserName = match["Loser Name"];
      const timestamp = match.Timestamp;

      const winnerInfo = players.rows.find((p) =>
        p.Identification === winnerName
      );
      const loserInfo = players.rows.find((p) =>
        p.Identification === loserName
      );

      if (!winnerInfo || !loserInfo) {
        console.warn(
          `[fra] [Row ${
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
          `[fra] [Row ${
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
      let message = eliminated
        ? `${loserMention} was eliminated by ${winnerMention}.`
        : `!${FRACTURE_COMMAND} ${loserMention} was defeated ${match.Result} by ${winnerMention}.`;

      if (match.Notes) {
        message += `\n> ${escapeMarkdown(match.Notes)}`;
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
        await packGenChannel.send(message);
      } catch (err) {
        console.error("[fra] Failed to send match announcement:", err);
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
    console.error("[fra] Error in announceFraMatches:", e);
  }
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
