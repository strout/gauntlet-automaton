import { Client, Interaction, Message, TextChannel } from "discord.js";
import { Handler } from "../../dispatch.ts";
import { generateAndPostLorwynPool } from "./pools.ts";
import {
  getAllMatches,
  getPlayers,
  MATCHTYPE,
  Player,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { mutex } from "../../mutex.ts";
import { delay } from "@std/async";
import { CONFIG } from "../../config.ts";

const pollingLock = mutex();


/**
 * Handler for !lorwyn command to roll ECL pools
 * Usage: !lorwyn <discord_id>
 */
const lorwynPoolHandler: Handler<Message> = async (message, handle) => {
  if (!message.content.startsWith("!lorwyn")) return;

  handle.claim();

  try {
    // Check if channel is a text channel
    if (!message.channel.isTextBased() || message.channel.isDMBased()) {
      await message.reply("This command can only be used in server channels.");
      return;
    }

    // Extract Discord ID or tag from command (format: !lorwyn <discord_id_or_tag>)
    const parts = message.content.trim().split(/\s+/);
    if (parts.length < 2) {
      await message.reply("Usage: `!lorwyn <discord_id_or_tag>`");
      return;
    }

    let discordId: string | null = null;
    const input = parts[1];

    // Check if it's a numeric Discord ID
    if (/^\d+$/.test(input)) {
      discordId = input;
    }
    // Check if it's a Discord mention (<@user_id> or <@!user_id>)
    else if (/^<@!?\d+>$/.test(input)) {
      discordId = input.replace(/[<@!>]/g, "");
    }
    // Try to resolve as a username/tag by searching in the guild
    else {
      try {
        const guild = message.guild;
        if (!guild) {
          await message.reply("❌ Could not resolve username - not in a guild.");
          return;
        }

        // Remove @ symbol if present
        const username = input.replace(/^@/, "");
        
        // Try to find member by username (case-insensitive partial match)
        const members = await guild.members.fetch();
        const member = members.find((m) =>
          m.user.username.toLowerCase() === username.toLowerCase() ||
          m.user.globalName?.toLowerCase() === username.toLowerCase() ||
          m.displayName.toLowerCase() === username.toLowerCase() ||
          m.user.tag?.toLowerCase() === username.toLowerCase()
        );

        if (member) {
          discordId = member.user.id;
        } else {
          await message.reply(`❌ Could not find user "${username}" in this server.`);
          return;
        }
      } catch (error) {
        console.error("Error resolving Discord username:", error);
        await message.reply(`❌ Error resolving username "${input}". Please use a numeric Discord ID or mention.`);
        return;
      }
    }

    if (!discordId) {
      await message.reply("❌ Could not resolve Discord ID or username.");
      return;
    }

    await generateAndPostLorwynPool(
      discordId,
      message.channel as TextChannel,
      message,
    );
  } catch (error) {
    console.error("Error in !lorwyn command:", error);
    await message.reply("❌ Failed to generate Lorwyn pool. Please try again.");
  }
};

/**
 * Placeholder logic for when a player loses a match.
 */
// deno-lint-ignore no-explicit-any
async function handleLoss(
  client: Client,
  loser: any,
  match: any,
  lossCount: number,
) {
  // TODO: Implement ECL-specific loss logic (e.g. awarding a pack)
  console.log(
    `[ECL] Handling loss for ${loser.Identification} (Loss #${lossCount})`,
  );
}

async function checkForMatches(client: Client<true>) {
  using _ = await pollingLock();

  const [allMatchesData, players] = await Promise.all([
    getAllMatches(),
    getPlayers(),
  ]);

  const allMatches = allMatchesData.rows;

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    if (!m["Script Handled"] || m["Bot Messaged"]) continue;

    const loser = players.rows.find((p) =>
      p.Identification === m["Loser Name"]
    );
    if (!loser) {
      console.error(`[ECL] Could not find loser "${m["Loser Name"]}"`);
      continue;
    }

    // Calculate loss count for this player up to this match
    const lossCount = allMatches.slice(0, i + 1).filter((match) =>
      match["Loser Name"] === loser.Identification
    ).length;

    try {
      await handleLoss(client, loser, m, lossCount);

      // Mark as handled in the spreadsheet
      const type = m[MATCHTYPE] as "match" | "entropy";
      const sheetName = allMatchesData.sheetName[type];
      const colIndex = allMatchesData.headerColumns[type]["Bot Messaged"];

      if (colIndex === undefined) {
        throw new Error(`Could not find "Bot Messaged" column in ${sheetName}`);
      }

      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `${sheetName}!R${m[ROWNUM]}C${colIndex + 1}`,
        [[true]],
      );
    } catch (error) {
      console.error(
        `[ECL] Error processing loss for ${loser.Identification}:`,
        error,
      );
    }
  }
}

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: async (client: Client) => {
      if (!client.readyAt) {
        await new Promise((resolve) => client.once("ready", resolve));
      }
      const readyClient = client as Client<true>;

      console.log("[ECL] Starting loss polling loop...");
      while (true) {
        try {
          await checkForMatches(readyClient);
        } catch (error) {
          console.error("[ECL] Error in loss polling loop:", error);
        }
        await delay(30_000);
      }
    },
    messageHandlers: [lorwynPoolHandler],
    interactionHandlers: [],
  });
}

