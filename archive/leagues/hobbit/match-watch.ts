import { delay } from "@std/async";
import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { CONFIG } from "../../../config.ts";
import { getEntropyAnnouncer } from "../../../entropy.ts";
import { getMatchAnnouncer } from "../../../match_announcer.ts";
import { waitForBoosterTutor } from "../../../pending.ts";
import { MATCHTYPE, ROWNUM } from "../../../standings.ts";
import { z } from "zod";
import {
  COMPANY_REWARD_PROCESSED_COLUMN,
  HOBBIT_COMEBACK_PACK_CMD,
  HOBBIT_CUBE,
  hobbitSheet,
  MATCH_ANNOUNCED_COLUMN,
} from "./constants.ts";
import {
  COMPANY_REWARDS,
  distributeCompanyReward,
  getCompanySpace,
  hasReachedWin11,
  WIN11_REWARD,
} from "./company-rewards.ts";
import { Player } from "../../../standings.ts";
import { ScryfallCard, tileCardImages } from "../../../scryfall.ts";
import { formatPool, SealedDeckPool } from "../../../sealeddeck.ts";
import { Buffer } from "node:buffer";

const POLL_MS = 30_000;

/** Poll Hobbit matches and entropy; packs via `!cube HOBX`. */
export async function watchHobbitMatches(client: Client): Promise<never> {
  const sheet = hobbitSheet();
  const announcer = getMatchAnnouncer(sheet, "hobbit");
  const entropy = getEntropyAnnouncer(sheet, "hobbit", `cube ${HOBBIT_CUBE}`);

  while (true) {
    try {
      await entropy.process(client);
      await announceHobbitMatches(client, announcer);
    } catch (err) {
      console.error("[hobbit] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/**
 * Unannounced match losses: post `!cube HOBX` for the loser (unless
 * eliminated), wait for Booster Tutor, record the pack on Pool Changes.
 */
export async function announceHobbitMatches(
  client: Client,
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  console.log("[hobbit] Checking for matches to announce…");

  try {
    const sheet = announcer.sheet;
    const [players, quotas, matchTable] = await Promise.all([
      sheet.getPlayers({ Company: z.string() }),
      sheet.getQuotas(),
      sheet.getMatches({ "Company Reward Processed": z.coerce.boolean() }),
    ]);

    // Shape expected by MatchAnnouncer without requiring an Entropy sheet yet.
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
      console.error("[hobbit] Could not find pack generation channel");
      return;
    }

    let poolChanges = await sheet.getPoolChanges();

    for (const match of matches.rows) {
      if (match[MATCHTYPE] !== "match") continue;

      // --- Company Reward Processing ---
      // Processed independently of announcement to prevent reward loss on crash.
      try {
        if (!match[COMPANY_REWARD_PROCESSED_COLUMN]) {
          const winnerName = match["Your Name"];
          const winnerInfo = players.rows.find((p) =>
            p.Identification === winnerName
          );

          if (winnerInfo?.["Company"]) {
            const company = winnerInfo["Company"];
            const companyMembers = players.rows.filter((p) =>
              p["Company"] === company
            );
            const currentSpace = getCompanySpace(companyMembers);

            // Check milestone rewards
            for (const reward of COMPANY_REWARDS) {
              if (currentSpace >= reward.space) {
                const result = await distributeCompanyReward(
                  sheet,
                  poolChanges,
                  companyMembers,
                  reward,
                );
                if (result?.isNew) {
                  await announceCompanyReward(
                    packGenChannel,
                    company,
                    reward.name,
                    companyMembers,
                    result,
                  );
                }
                if (result) {
                  poolChanges = await sheet.getPoolChanges();
                }
              }
            }

            // Check Win 11 reward
            if (hasReachedWin11(companyMembers)) {
              const result11 = await distributeCompanyReward(
                sheet,
                poolChanges,
                companyMembers,
                WIN11_REWARD,
              );
              if (result11?.isNew) {
                await announceCompanyReward(
                  packGenChannel,
                  company,
                  WIN11_REWARD.name,
                  companyMembers,
                  result11,
                );
              }
              if (result11) {
                poolChanges = await sheet.getPoolChanges();
              }
            }
          }
          await sheet.updateMatchCell(
            match[ROWNUM],
            COMPANY_REWARD_PROCESSED_COLUMN,
            true,
          );
        }
      } catch (err) {
        console.error("[hobbit] Company reward error:", err);
      }

      // --- Match Announcement ---
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
          `[hobbit] [Row ${
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
          `[hobbit] [Row ${
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
      let message = "";
      if (eliminated) {
        message = `${loserMention} was eliminated by ${winnerMention}.`;
      } else {
        message =
          `${HOBBIT_COMEBACK_PACK_CMD} ${loserMention} was defeated ${result} by ${winnerMention}.`;
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
          try {
            const packResult = await waitForBoosterTutor(
              Promise.resolve(sentMessage),
            );
            if ("success" in packResult) {
              await sheet.recordPackAddition(
                loserName,
                packResult.success,
                `Loss against ${winnerName}`,
                poolChanges,
              );
            } else if ("error" in packResult) {
              console.error(
                `[hobbit] Booster Tutor error for ${loserName}: ${packResult.error}`,
              );
            }
          } catch (e) {
            console.error(
              `[hobbit] Failed to record pack for ${loserName}:`,
              e,
            );
          }
          poolChanges = await sheet.getPoolChanges();
        }
      } catch (err) {
        console.error("[hobbit] Failed to send pack generation command:", err);
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
    console.error("[hobbit] Error in announceHobbitMatches:", e);
  }
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}

/**
 * Announces a company reward in the pack generation channel.
 */
async function announceCompanyReward(
  channel: TextChannel,
  companyName: string,
  locationName: string,
  members: Player[],
  result: { cards: ScryfallCard[]; pool: SealedDeckPool; isNew: boolean },
) {
  const mentions = members
    .map((m) => `<@${m["Discord ID"]}>`)
    .join(" ");

  const packText = formatPool(result.pool);
  const imageBlob = await tileCardImages(result.cards);
  const attachment = new AttachmentBuilder(
    Buffer.from(await imageBlob.arrayBuffer()),
    { name: "reward.png" },
  );

  const embed = new EmbedBuilder()
    .setTitle(`${companyName} has reached ${locationName}!`)
    .setDescription(`${mentions}\n\n${packText}`)
    .setImage(`attachment://${attachment.name}`);

  await channel.send({
    embeds: [embed],
    files: [attachment],
  });
}
