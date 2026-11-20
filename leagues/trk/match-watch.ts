import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import {
  getMatchAnnouncer,
  type MatchAnnouncer,
} from "../../match_announcer.ts";
import { MATCHTYPE, ROWNUM } from "../../standings.ts";
import { checkTrkAssimilation } from "./assimilation.ts";
import {
  offerTrkPlanet,
  remindTrkBorgCard,
  resumeTrkPlanets,
  trkNeedsBorgCardReminder,
} from "./comeback.ts";
import { MATCH_ANNOUNCED_COLUMN, trkSheet } from "./constants.ts";
import { assignTrkEntropy } from "./entropy.ts";
import { lossAnnounced, lossOrdinals, readTrkLossSheets } from "./losses.ts";
import type { TrkLoss } from "./losses.ts";

const POLL_MS = 30_000;
/** Assimilation is checked on every other match poll, so about once a minute. */
const ASSIMILATION_EVERY = 2;
/** Entropy week check. Weeks end on a clock, so this does not need the match poll. */
const ENTROPY_EVERY = 20;

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

/** Poll TRK matches, and assimilation on every other pass. */
export async function watchTrkMatches(client: Client): Promise<never> {
  const sheet = trkSheet();
  const announcer = getMatchAnnouncer(sheet, "trk");
  let polls = 0;
  while (true) {
    const assimilation = polls % ASSIMILATION_EVERY === 0;
    console.log(
      assimilation
        ? "[trk] Checking matches and assimilation…"
        : "[trk] Checking matches…",
    );
    if (polls % ENTROPY_EVERY === 0) {
      try {
        await assignTrkEntropy(sheet);
      } catch (err) {
        console.error("[trk] entropy assignment error:", err);
      }
    }
    try {
      await announceTrkMatches(client, announcer);
    } catch (err) {
      console.error("[trk] match watch error:", err);
    }
    if (assimilation) {
      try {
        await checkTrkAssimilation(client, sheet);
      } catch (err) {
        console.error("[trk] assimilation watch error:", err);
      }
    }
    polls++;
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
  try {
    const sheet = announcer.sheet;
    const [players, quotas, loaded] = await Promise.all([
      sheet.getPlayers(playerExtras),
      sheet.getQuotas(),
      readTrkLossSheets(sheet),
    ]);
    const matchTable = loaded.matches;
    const losses = loaded.losses;

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

    await resumeTrkPlanets(client, sheet, packGenChannel, losses);

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
            losses,
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
    await announceTrkEntropy(
      client,
      sheet,
      packGenChannel,
      players.rows,
      losses,
    );
  } catch (e) {
    console.error("[trk] Error in announceTrkMatches:", e);
  }
}

/**
 * Unannounced Entropy rows. The loss counts in the same odd/even pack order
 * as a match, and a non-eliminating loss gets a planet menu.
 */
async function announceTrkEntropy(
  client: Client,
  sheet: ReturnType<typeof trkSheet>,
  channel: TextChannel,
  players: readonly {
    Identification: string;
    Losses: number;
    "Discord ID": string;
  }[],
  losses: readonly TrkLoss[],
): Promise<void> {
  const ordinals = lossOrdinals(losses);
  for (const loss of losses) {
    if (loss[ROWNUM] >= 0) continue;
    if (lossAnnounced(loss["Match Announced"])) continue;
    const sheetRow = -loss[ROWNUM];
    const loserName = loss["Loser Name"];
    const ordinal = ordinals.get(loss[ROWNUM]);
    const loserInfo = players.find((player) =>
      player.Identification === loserName
    );
    const loserId = `${loserInfo?.["Discord ID"] ?? ""}`.trim();
    if (!loserInfo || !loserId || ordinal === undefined) {
      console.warn(
        `[trk] Entropy row ${sheetRow}: missing player info for ${loserName}`,
      );
      await channel.send(
        `Error (Entropy row ${sheetRow}): could not find standings info for ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
      );
      await sheet.setEntropyCell(
        sheetRow,
        "Match Announced",
        "Error: Missing Player Info",
      );
      continue;
    }

    const mention = `<@!${loserId}>`;
    const eliminated = ordinal >= CONFIG.MAX_LOSSES;
    const message = eliminated
      ? `${mention} was eliminated by ENTROPY.`
      : `${mention} was defeated by ENTROPY.`;
    try {
      await channel.send(message);
      if (!eliminated) {
        await offerTrkPlanet({
          client,
          channel,
          sheet,
          identification: loserName,
          discordId: loserId,
          opponent: "ENTROPY",
          matchRow: loss[ROWNUM],
          losses,
        });
      }
      if (ordinal === 1) {
        const remind = await trkNeedsBorgCardReminder(
          sheet,
          loserName,
          ordinal,
        );
        if (remind) await remindTrkBorgCard(client, loserId, channel);
      }
    } catch (err) {
      console.error("[trk] Failed to send entropy announcement:", err);
      continue;
    }
    await sheet.setEntropyCell(sheetRow, "Match Announced", true);
  }
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
