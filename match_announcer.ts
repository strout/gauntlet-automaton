import { Client, TextChannel } from "discord.js";
import { CONFIG } from "./config.ts";
import {
  getAllMatches,
  getPlayers,
  getQuotas,
  recordPackAddition,
  getEntropyWeek,
  setEntropyWeek,
  addEntropyRow,
  getCurrentWeek,
  isLeagueOver,
} from "./standings.ts";
import { sheets, sheetsWrite } from "./sheets.ts";
import { waitForBoosterTutor, PackWithOrder } from "./pending.ts";

/**
 * Scans for matches that haven't been announced yet, validates them,
 * triggers pack generation, and marks them as handled in the spreadsheet.
 */
export async function announceMatches(client: Client) {
  console.log("Checking for matches to announce...");

  try {
    const players = await getPlayers();
    const quotas = await getQuotas();
    const matches = await getAllMatches();

    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (!packGenChannel) {
      console.error("Could not find pack generation channel");
      return;
    }

    const matchColIndex = matches.headerColumns.match["Script Handled"];

    // We process matches one by one, similar to the original script
    for (const match of matches.rows) {
      if (match["Script Handled"]) continue;
      if (match["MATCHTYPE"] !== "match") continue;

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
          `[Row ${
            match["ROWNUM"]
          }] Could not find player info for match: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match["ROWNUM"]
          }): could not find standings info for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await markMatchHandled(
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
          `[Row ${
            match["ROWNUM"]
          }] Could not find Discord ID for match: ${winnerName} vs ${loserName}`,
        );
        await packGenChannel.send(
          `Error (Row ${
            match["ROWNUM"]
          }): could not find discord ID for match: ${winnerName} vs ${loserName}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        await markMatchHandled(
          match["ROWNUM"],
          matchColIndex,
          "Error: Missing Discord ID",
        );
        continue;
      }

      const winnerMention = `<@!${winnerId}>`;
      const loserMention = `<@!${loserId}>`;

      // Validation: Check if they already played this week
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
        await markMatchHandled(
          match["ROWNUM"],
          matchColIndex,
          "Rejected: Duplicate",
        );
        continue;
      }

      let message = "";
      if (loserInfo.Losses >= CONFIG.MAX_LOSSES) {
        message =
          `!cube SET ${loserMention} was eliminated by ${winnerMention}.`;
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

      const playerMatches = (p: any) => p.Wins + p.Losses;
      if (
        currentQuota && playerMatches(winnerInfo) >= currentQuota.matchesMax
      ) {
        message += `\n${winnerMention} is done for the week.`;
      }
      if (currentQuota && playerMatches(loserInfo) >= currentQuota.matchesMax) {
        message += `\n${loserMention} is done for the week.`;
      }

      // Trigger pack generation and announcement
      try {
        const sentMessage = await packGenChannel.send(message);
        
        // Fire-and-forget: wait for the resulting pack and record it
        (async () => {
          try {
            const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
            if ("success" in result) {
              await recordPackAddition(
                loserName,
                result.success,
                `Loss against ${winnerName}`,
              );
            } else if ("error" in result) {
              console.error(`Booster Tutor error for ${loserName}: ${result.error}`);
            }
          } catch (e) {
            console.error(`Failed to record pack for ${loserName}:`, e);
          }
        })();
      } catch (err) {
        console.error("Failed to send pack generation command:", err);
      }

      await markMatchHandled(match["ROWNUM"], matchColIndex, true);
    }
  } catch (e) {
    console.error("Error in announceMatches:", e);
  }
}

async function markMatchHandled(
  rowNum: number,
  columnIndex: number,
  status: string | boolean = true,
) {
  const col = columnIndex + 1;
  // Range: Matches!R{rowNum}C{col}
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    `Matches!R${rowNum}C${col}`,
    [[status]],
    "RAW",
  );
}

function escapeMarkdown(str: string) {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}


/**
 * Processes entropy losses for players who haven't met the minimum match requirement
 * for the current entropy week.
 */
export async function announceEntropy(client: Client) {
  const currentWeek = await getCurrentWeek();
  const entropyWeek = await getEntropyWeek();
  const leagueOver = await isLeagueOver();
  console.log(`Checking for entropy... (Current Week: ${currentWeek}, Entropy Week: ${entropyWeek}, League Over: ${leagueOver})`);
  try {
    // currentWeek and entropyWeek are already fetched above
    // leagueOver is already fetched above


    if (entropyWeek > currentWeek || (entropyWeek === currentWeek && !leagueOver)) {
      console.log(`Waiting until week ${entropyWeek} ends (League Over: ${leagueOver}). Skipping.`);
      return;
    }

    const players = await getPlayers();
    const quotas = await getQuotas();
    const currentQuota = quotas.find((q) => q.week === entropyWeek);

    if (!currentQuota) {
      console.log(`No quota found for entropy week ${entropyWeek}. Advancing to ${entropyWeek + 1}...`);
      await setEntropyWeek(entropyWeek + 1);
      return;
    }

    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (!packGenChannel) {
      console.error("Could not find pack generation channel");
      return;
    }

    for (const player of players.rows) {
      if (CONFIG.WAIVE_ENTROPY.includes(player.Identification)) continue;

      const wins = player.Wins;
      const losses = player.Losses;
      const matchesPlayed = wins + losses;
      const minMatches = currentQuota.matchesMin;

      if (matchesPlayed < minMatches) {
        const toAdd = Math.min(minMatches - matchesPlayed, CONFIG.MAX_LOSSES - losses);
        if (toAdd <= 0) continue;

        const discordId = player["Discord ID"];
        if (!discordId) {
          console.warn(`No Discord ID for player ${player.Identification}`);
          continue;
        }
        const mention = `<@!${discordId}>`;

        if (losses + toAdd >= CONFIG.MAX_LOSSES) {
          // Elimination case
          for (let i = 0; i < toAdd; i++) {
            await addEntropyRow(player.Identification, entropyWeek);
          }
          await packGenChannel.send(`${mention} was eliminated by ENTROPY.`);
        } else {
          // Pack generation case
          for (let i = 0; i < toAdd; i++) {
            await addEntropyRow(player.Identification, entropyWeek);
            const sentMessage = await packGenChannel.send(
              `!cube SET ${mention} was defeated by ENTROPY.`,
            );

            try {
              const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
              if ("success" in result) {
                await recordPackAddition(
                  player.Identification,
                  result.success,
                  `Entropy loss (Week ${entropyWeek})`,
                );
              }
            } catch (e) {
              console.error(`Failed to record entropy pack for ${player.Identification}:`, e);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    }

    await setEntropyWeek(entropyWeek + 1);
    console.log(`Entropy for week ${entropyWeek} processed. Next: ${entropyWeek + 1}`);
  } catch (e) {
    console.error("Error in announceEntropy:", e);
  }
}
