import { delay } from "@std/async";
import { Client, TextChannel } from "discord.js";
import { CONFIG } from "../../../config.ts";
import { MatchAnnouncer } from "../../../match_announcer.ts";
import { liveSheet } from "../../../standings.ts";
import { waitForBoosterTutor } from "../../../pending.ts";

const POLL_MS = 30_000;

/** Poll SET matches and entropy on the live sheet. */
export async function watchSetMatches(client: Client): Promise<never> {
  const announcer = new MatchAnnouncer(liveSheet, "set");
  while (true) {
    try {
      await announceSetMatches(client, announcer);
      await announceSetEntropy(client, announcer);
    } catch (err) {
      console.error("[set] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Scans for matches that haven't been announced yet, validates them,
 * triggers SET pack generation (`!cube SET`), and marks them handled.
 */
export async function announceSetMatches(
  client: Client,
  announcer: MatchAnnouncer,
) {
  console.log("[set] Checking for matches to announce…");

  try {
    const players = await announcer.sheet.getPlayers();
    const quotas = await announcer.sheet.getQuotas();
    const matches = await announcer.sheet.getAllMatches();

    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (!packGenChannel) {
      console.error("[set] Could not find pack generation channel");
      return;
    }

    const matchColIndex = matches.headerColumns.match["Script Handled"];

    for (const raw of matches.rows) {
      if (raw.MATCHTYPE !== "match") continue;
      const match = raw as typeof raw & { "Script Handled"?: boolean };
      if (match["Script Handled"]) continue;

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
          `[set] [Row ${
            match["ROWNUM"]
          }] Could not find player info for match: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match["ROWNUM"]
          }): could not find standings info for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await announcer.markMatchHandled(
          match["ROWNUM"],
          matchColIndex,
          "Error: Missing Player Info",
        );
        continue;
      }

      const winnerId = winnerInfo["Discord ID"];
      const loserId = loserInfo["Discord ID"];

      if (!winnerId || !loserId) {
        console.warn(
          `[set] [Row ${
            match["ROWNUM"]
          }] Could not find Discord ID for match: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match["ROWNUM"]
          }): could not find discord ID for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await announcer.markMatchHandled(
          match["ROWNUM"],
          matchColIndex,
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
          if (m["ROWNUM"] === match["ROWNUM"]) return false;
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
            match["ROWNUM"]
          }):\n* ${loserMention} and ${winnerMention} have already played this week.`,
        );
        await announcer.markMatchHandled(
          match["ROWNUM"],
          matchColIndex,
          "Rejected: Duplicate",
        );
        continue;
      }

      let message = "";
      if (loserInfo.Losses >= CONFIG.MAX_LOSSES) {
        message = `${loserMention} was eliminated by ${winnerMention}.`;
      } else {
        message =
          `!cube SET ${loserMention} was defeated ${result} by ${winnerMention}.`;
      }

      if (note) {
        message += `\n> ${escapeMarkdown(note)}`;
      }

      if ((winnerInfo.Streak ?? 0) >= 5) {
        message +=
          `\n${winnerMention} is on a ${winnerInfo.Streak} win streak!`;
      }

      const playerMatches = (p: { Wins: number; Losses: number }) =>
        p.Wins + p.Losses;
      if (
        currentQuota &&
        playerMatches(
            winnerInfo as unknown as { Wins: number; Losses: number },
          ) >= currentQuota.matchesMax
      ) {
        message += `\n${winnerMention} is done for the week.`;
      }
      if (
        currentQuota &&
        playerMatches(
            loserInfo as unknown as { Wins: number; Losses: number },
          ) >= currentQuota.matchesMax
      ) {
        message += `\n${loserMention} is done for the week.`;
      }

      try {
        const sentMessage = await packGenChannel.send(message);

        (async () => {
          try {
            const packResult = await waitForBoosterTutor(
              Promise.resolve(sentMessage),
            );
            if ("success" in packResult) {
              await announcer.sheet.recordPackAddition(
                loserName,
                packResult.success,
                `Loss against ${winnerName}`,
              );
            } else if ("error" in packResult) {
              console.error(
                `[set] Booster Tutor error for ${loserName}: ${packResult.error}`,
              );
            }
          } catch (e) {
            console.error(
              `[set] Failed to record pack for ${loserName}:`,
              e,
            );
          }
        })();
      } catch (err) {
        console.error("[set] Failed to send pack generation command:", err);
      }

      await announcer.markMatchHandled(match["ROWNUM"], matchColIndex, true);
    }
  } catch (e) {
    console.error("[set] Error in announceSetMatches:", e);
  }
}

/** Processes entropy losses for SET (`!cube SET` pack gen on non-elimination). */
export async function announceSetEntropy(
  client: Client,
  announcer: MatchAnnouncer,
) {
  const currentWeek = await announcer.sheet.getCurrentWeek();
  const entropyWeek = await announcer.sheet.getEntropyWeek();
  const leagueOver = await announcer.sheet.isLeagueOver();
  console.log(
    `[set] Checking for entropy… (Current Week: ${currentWeek}, Entropy Week: ${entropyWeek}, League Over: ${leagueOver})`,
  );
  try {
    if (
      entropyWeek > currentWeek ||
      (entropyWeek === currentWeek && !leagueOver)
    ) {
      console.log(
        `[set] Waiting until week ${entropyWeek} ends (League Over: ${leagueOver}). Skipping.`,
      );
      return;
    }

    const players = await announcer.sheet.getPlayers();
    const quotas = await announcer.sheet.getQuotas();
    const currentQuota = quotas.find((q) => q.week === entropyWeek);

    if (!currentQuota) {
      console.log(
        `[set] No quota found for entropy week ${entropyWeek}. Advancing to ${
          entropyWeek + 1
        }…`,
      );
      await announcer.sheet.setEntropyWeek(entropyWeek + 1);
      return;
    }

    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (!packGenChannel) {
      console.error("[set] Could not find pack generation channel");
      return;
    }

    for (const player of players.rows) {
      if (CONFIG.WAIVE_ENTROPY.includes(player.Identification)) continue;

      const wins = player.Wins;
      const losses = player.Losses;
      const matchesPlayed = wins + losses;
      const minMatches = currentQuota.matchesMin;

      if (matchesPlayed < minMatches) {
        const toAdd = Math.min(
          minMatches - matchesPlayed,
          CONFIG.MAX_LOSSES - losses,
        );
        if (toAdd <= 0) continue;

        const discordId = player["Discord ID"];
        if (!discordId) {
          console.warn(
            `[set] No Discord ID for player ${player.Identification}`,
          );
          continue;
        }
        const mention = `<@!${discordId}>`;

        if (losses + toAdd >= CONFIG.MAX_LOSSES) {
          for (let i = 0; i < toAdd; i++) {
            await announcer.sheet.addEntropyRow(
              player.Identification,
              entropyWeek,
            );
          }
          await packGenChannel.send(`${mention} was eliminated by ENTROPY.`);
        } else {
          for (let i = 0; i < toAdd; i++) {
            await announcer.sheet.addEntropyRow(
              player.Identification,
              entropyWeek,
            );
            const sentMessage = await packGenChannel.send(
              `!cube SET ${mention} was defeated by ENTROPY.`,
            );

            try {
              const packResult = await waitForBoosterTutor(
                Promise.resolve(sentMessage),
              );
              if ("success" in packResult) {
                await announcer.sheet.recordPackAddition(
                  player.Identification,
                  packResult.success,
                  `Entropy loss (Week ${entropyWeek})`,
                );
              }
            } catch (e) {
              console.error(
                `[set] Failed to record entropy pack for ${player.Identification}:`,
                e,
              );
            }
            await delay(1000);
          }
        }
      }
    }

    await announcer.sheet.setEntropyWeek(entropyWeek + 1);
    console.log(
      `[set] Entropy for week ${entropyWeek} processed. Next: ${
        entropyWeek + 1
      }`,
    );
  } catch (e) {
    console.error("[set] Error in announceSetEntropy:", e);
  }
}

function escapeMarkdown(str: string) {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}
