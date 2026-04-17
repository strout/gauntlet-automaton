import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../../../dispatch.ts";
import { transformPool } from "./transform.ts";

/**
 * Handler for !transform command - transforms each card in a sealeddeck.tech pool
 * Usage: !transform <key_code> (e.g. !transform abc123 or !transform https://sealeddeck.tech/abc123)
 */
const transformPoolHandler: Handler<Message> = async (message, handle) => {
  if (!message.content.startsWith("!transform")) return;

  handle.claim();

  try {
    if (!message.channel.isTextBased() || message.channel.isDMBased()) {
      await message.reply("This command can only be used in server channels.");
      return;
    }

    const parts = message.content.trim().split(/\s+/);
    if (parts.length < 2) {
      await message.reply(
        "Usage: `!transform <key_code>`\nExample: `!transform abc123` or `!transform https://sealeddeck.tech/abc123`",
      );
      return;
    }

    let keyCode = parts[1].trim();
    // Extract key_code from full URL if provided
    const urlMatch = keyCode.match(/sealeddeck\.tech\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      keyCode = urlMatch[1];
    }

    if (!keyCode) {
      await message.reply("❌ Invalid key code. Please provide a sealeddeck.tech pool ID.");
      return;
    }

    await message.reply(`🔄 Transforming pool \`${keyCode}\`... This may take a minute.`);

    const result = await transformPool(keyCode);

    if (!result) {
      await message.reply(`❌ Could not fetch pool \`${keyCode}\`. Check the link and try again.`);
      return;
    }

    await message.reply(
      `✅ Transformed pool created!\n\n${result.url}`,
    );
  } catch (error) {
    console.error("Error in !transform command:", error);
    await message.reply("❌ Failed to transform pool. Please try again.");
  }
};

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: () => Promise.resolve(),
    messageHandlers: [transformPoolHandler],
    interactionHandlers: [],
  });
}
