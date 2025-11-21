import { CONFIG, DISCORD_TOKEN, makeClient } from "./main.ts";
import * as djs from "discord.js";
import { initSheets } from "./sheets.ts";
import { getPlayers } from "./standings.ts";
import { sendUpgradeChoice } from "./fin/upgrades.ts";
import { playerStates, restoreSinglePlayerState } from "./fin/state.ts";
import { setup } from "./fin.ts";
import { dispatch } from "./dispatch.ts";

/**
 * Test script to simulate the FIN upgrade flow
 * This uses the real player state from the database to test save/restore functionality
 */

async function main() {
  console.log("🧪 Starting FIN upgrade flow test...");

  // Initialize sheets
  await initSheets();

  // Create Discord client
  const client = makeClient();

  client.once(djs.Events.ClientReady, async (readyClient) => {
    console.log(`✅ Bot logged in as ${readyClient.user?.tag}`);
  });

  // Listen for DM messages
  client.on(djs.Events.MessageCreate, async (message) => {
    // Ignore bot messages and non-DM messages
    if (message.author.bot || message.guild) return;

    // Check for upgrade test command
    if (message.content.trim() === "!upgradeTest") {
      console.log(`🧪 Upgrade test requested by ${message.author.tag}`);

      try {
        // Verify user is in the players database
        const players = await getPlayers();
        const player = players.find((p) => p.id === message.author.id);

        if (!player) {
          await message.reply(
            "❌ You're not found in the players database. You need to be registered first!",
          );
          return;
        }

        console.log(`🎯 Player found in database: ${player.name}`);

        // Get the player state from the exported playerStates map
        const playerState = await restoreSinglePlayerState(player.id);

        if (!playerState) {
          await message.reply(
            "❌ Could not get your player state from FIN module. Player state not initialized?",
          );
          return;
        }

        console.log(`📊 Player state for ${message.author.tag}:`, {
          playerName: playerState.playerName,
          stats: playerState.stats,
          boosterSlots: playerState.boosterSlots.length,
        });

        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(message.author.id);
        if (!member) {
          await message.reply(
            "❌ Could not find your member info in the guild.",
          );
          return;
        }

        // Send the upgrade message using the player's state
        console.log(`📨 Sending upgrade message to ${message.author.tag}...`);
        await sendUpgradeChoice(member, playerState);
      } catch (error) {
        console.error(
          `❌ Error processing upgrade test for ${message.author.tag}:`,
          error,
        );
        await message.reply(
          "❌ An error occurred while processing your upgrade test request.",
        );
      }
    }
  });

  // Login
  await client.login(DISCORD_TOKEN);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("💥 Test script failed:", error);
    process.exit(1);
  });
}
