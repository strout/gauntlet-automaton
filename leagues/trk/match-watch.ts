import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import {
  getMatchAnnouncer,
  type MatchAnnouncer,
} from "../../match_announcer.ts";
import { MATCHTYPE, ROWNUM } from "../../standings.ts";
import {
  offerTrkPlanet,
  remindTrkBorgCard,
  resumeTrkPlanets,
  trkNeedsBorgCardReminder,
} from "./comeback.ts";
import { MATCH_ANNOUNCED_COLUMN, trkSheet } from "./constants.ts";

const POLL_MS = 30_000;

/** Player Database column: matches still allowed under this week's max. */
const MATCHES_UNDER_MAX = "MATCHES <Max";

const playerExtras = {
  [MATCHES_UNDER_MAX]: z.unknown().transform((value): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }),
};

/** Poll TRK matches. Losses offer a planet to station. */
export async function watchTrkMatches(client: Client): Promise<never> {
  const announcer = getMatchAnnouncer(trkSheet(), "trk");
  while (true) {
    try {
      await announceTrkMatches(client, announcer);
    } catch (err) {
      console.error("[trk] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Unannounced match losses: announce the result and, unless the loser is
 * eliminated, ask them to station a planet once they have a valid Borg card.
 * A first loss with no valid Assimilation row asks them to pick that card,
 * and the planet and pack stay held until they do.
 */
export async function announceTrkMatches(
  client: Client,
  announcer: MatchAnnouncer,
): Promise<void> {
  console.log("[trk] Checking for matches to announce…");

  try {
    const sheet = announcer.sheet;
    const [players, quotas, matchTable] = await Promise.all([
      sheet.getPlayers(playerExtras),
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
    );
    if (!(packGenChannel instanceof TextChannel)) {
      console.error("[trk] Could not find pack generation channel");
      return;
    }

    await resumeTrkPlanets(client, sheet, packGenChannel);

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
          `[trk] [Row ${
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
          `[trk] [Row ${
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

      // The column already includes this match. Zero is the match that
      // fills the cap. A negative value means the player was already there.
      const overLimit = [winnerInfo, loserInfo].filter((player) => {
        const remaining = player[MATCHES_UNDER_MAX];
        return remaining !== null && remaining < 0;
      });
      if (overLimit.length > 0) {
        const lines = overLimit.map((player) =>
          `* <@!${player["Discord ID"]}> is at their match limit for the week.`
        );
        await packGenChannel.send(
          `Match report rejected (Row ${match[ROWNUM]}):\n${lines.join("\n")}`,
        );
        await announcer.markMatchHandled(
          matches,
          match,
          MATCH_ANNOUNCED_COLUMN,
          "Rejected: Match limit",
        );
        continue;
      }

      const eliminated = loserInfo.Losses >= CONFIG.MAX_LOSSES;
      const remindBorg = await trkNeedsBorgCardReminder(
        sheet,
        loserName,
        loserInfo.Losses,
      );
      let message = eliminated
        ? `${loserMention} was eliminated by ${winnerMention}.`
        : `${loserMention} was defeated ${match.Result} by ${winnerMention}.`;

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
        if (!eliminated) {
          await offerTrkPlanet({
            client,
            channel: packGenChannel,
            sheet,
            identification: loserName,
            discordId: loserId,
            opponent: winnerName,
            matchRow: match[ROWNUM],
          });
        }
        if (remindBorg) {
          await remindTrkBorgCard(client, loserId, packGenChannel);
        }
      } catch (err) {
        console.error("[trk] Failed to send match announcement:", err);
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
    console.error("[trk] Error in announceTrkMatches:", e);
  }
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
