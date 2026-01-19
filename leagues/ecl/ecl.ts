import { Client, Interaction, Message, TextChannel } from "discord.js";
import { Handler } from "../../dispatch.ts";
import { generateAndPostLorwynPool } from "./pools.ts";

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

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: () => Promise.resolve(),
    messageHandlers: [lorwynPoolHandler],
    interactionHandlers: [],
  });
}
