import { CONFIG } from "./main.ts";
import * as djs from "discord.js";
import { Handler } from "./dispatch.ts";
import { getEntropy, getMatches, getPlayers } from "./standings.ts";
import { sheets, sheetsWrite } from "./sheets.ts";
import { delay } from "@std/async/delay";
import { generateAndPostStartingPool } from "./fin/pools.ts";
import {
  countCompletedUpgrades,
  playerStates,
  restorePlayerStates,
  restoreSinglePlayerState,
} from "./fin/state.ts";
import {
  finLevel2Handler,
  finLevel3Handler,
  finUpgradeHandler,
  finUpgradeSubmitHandler,
  sendUpgradeChoice,
} from "./fin/upgrades.ts";

async function checkForMatches(client: djs.Client) {
  const matches = await getMatches();
  const entropy = await getEntropy();
  const players = await getPlayers();

  const records = [...matches, ...entropy].sort((a, b) =>
    a.timestamp - b.timestamp
  );

  // Track players we've already messaged in this batch
  const messagedThisBatch = new Set<string>();

  for (const record of records) {
    if (record.botMessaged || !record.scriptHandled) continue;

    // Find losing player
    const loser = players.find((p) => p.name === record.loser);
    if (!loser) {
      console.warn(
        `Unidentified loser ${record.loser} for ${record.matchType} ${
          record.matchType === "match"
            ? record.matchRowNum
            : record.matchType === "entropy"
            ? record.entropyRowNum
            : record satisfies never
        }`,
      );
      continue;
    }

    // Skip if they're dead.
    if (loser.status === 'Eliminated') {
      continue;
    }

    // Skip if we've already messaged this player in this batch
    if (messagedThisBatch.has(loser.id)) {
      continue;
    }

    // Check if player already has outstanding upgrades
    // Count how many matches have been messaged for this player
    const messagedMatches = records.filter((r) =>
      r.botMessaged &&
      players.find((p) => p.name === r.loser)?.id === loser.id
    ).length;

    // Count completed upgrades from the sheet (more accurate than in-memory state)
    const completedUpgrades = await countCompletedUpgrades(loser.name);

    // Skip if they have unclaimed upgrades
    if (messagedMatches > completedUpgrades) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(loser.id);

      const state = await restoreSinglePlayerState(loser.id);
      if (!state) continue;

      let blocked = false;
      try {
        await sendUpgradeChoice(member, state);
      } catch (e: unknown) {
        if (e instanceof djs.DiscordAPIError && e.code === 10007) {
          blocked = true;
        } else {
          throw e;
        }
      }

      // Mark this player as messaged in this batch
      messagedThisBatch.add(loser.id);

      // Build the complete cell reference based on record type
      const cellRef = record.matchType === "entropy"
        ? `Entropy!J${record.entropyRowNum}`
        : `Matches!G${record.matchRowNum}`;

      // Mark record as messaged in the appropriate sheet
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        cellRef,
        [[blocked ? "-1" : "1"]],
      );
    } catch (error) {
      console.error(
        `Error sending upgrade message to ${loser.name} (${loser.id}):`,
        error,
      );
    }
  }
}

/**
 * Handler for !finpool command
 */
export const finPoolHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!finpool")) return;

  handle.claim();

  try {
    // Extract mentioned user
    const mentionedUser = message.mentions.members?.first();

    // Check if channel is a text channel
    if (!message.channel.isTextBased() || message.channel.isDMBased()) {
      await message.reply("This command can only be used in server channels.");
      return;
    }

    await generateAndPostStartingPool(
      mentionedUser ?? message.author,
      message.channel as djs.TextChannel,
      message,
    );
  } catch (error) {
    console.error("Error in finpool command:", error);
    await message.reply("❌ Failed to generate FIN pool. Please try again.");
  }
};

export async function setup() {
  try {
    await restorePlayerStates();
  } catch (error) {
    console.error("Error restoring player states:", error);
  }
  return {
    watch: async (client: djs.Client) => {
      while (true) {
        await checkForMatches(client);
        await delay(60_000);
      }
    },
    messageHandlers: [finPoolHandler],
    interactionHandlers: [
      finUpgradeHandler,
      finLevel2Handler,
      finLevel3Handler,
      finUpgradeSubmitHandler,
    ],
  };
}
