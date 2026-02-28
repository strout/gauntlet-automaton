import * as djs from "discord.js";
import { makeClient } from "./main.ts";
import { getMutationMap, mutateWholePool } from "./leagues/tmt/tmt.ts";
import { tileCardImages, tileRareImages } from "./scryfall.ts";
import { fetchSealedDeck } from "./sealeddeck.ts";
import { env } from "./sheets.ts";
import { Buffer } from "node:buffer";

await getMutationMap(); // ensure it's loaded up front

// Configuration
const TARGET_CHANNEL_ID = Deno.args[0];

if (!TARGET_CHANNEL_ID) {
  console.error("Usage: deno run --allow-all mutator-bot.ts <channel_id>");
  console.error(
    "Example: deno run --allow-all mutator-bot.ts 1234567890123456789",
  );
  Deno.exit(1);
}

async function main() {
  console.log(`Starting Mutator Bot for channel: ${TARGET_CHANNEL_ID}`);

  // Create client
  const client = makeClient();

  client.once(djs.Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
    console.log("Waiting for messages containing sealeddeck.tech links...");

    // Get target channel
    const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) {
      console.error("Target channel not found or is not a text channel");
      await client.destroy();
      Deno.exit(1);
    }

    console.log(`Monitoring channel: #${(channel as djs.TextChannel).name}`);
  });

  // Listen for messages
  const handleMessage = async (message: djs.Message) => {
    // Only process messages from the target channel
    if (message.channelId !== TARGET_CHANNEL_ID) return;

    // Ignore messages from the bot itself
    if (message.author.id === client.user?.id) return;

    // Extract SealedDeck ID from link
    const match = message.content.match(/https:\/\/sealeddeck\.tech\/(\w+)/);
    if (!match) return;

    const poolId = match[1];
    console.log(`Processing link: ${match[0]} (ID: ${poolId})`);

    try {
      // Fetch the pool
      const pack = await fetchSealedDeck(poolId);
      console.log(
        `Fetched pool: ${poolId} (${
          pack.sideboard.length + pack.deck.length + pack.hidden.length
        } cards)`,
      );

      // Mutate the entire pack
      console.log("Mutating pack...");
      const { poolId: mutatedPoolId, mutatedCards } = await mutateWholePool(
        pack,
      );
      console.log(
        `Mutated pack ID: ${mutatedPoolId} (${mutatedCards.length} cards)`,
      );

      // Generate card list text
      const cardLines = mutatedCards.map((c) => c.name);
      const cardList = cardLines.join("\n");

      // Create tiled image
      console.log("Generating tiled image...");
      let attachment: djs.AttachmentBuilder | undefined;
      try {
        // If > 15 cards, tile only rares/mythics
        const imageBlob = mutatedCards.length > 15
          ? await tileRareImages(mutatedCards, "small")
          : await tileCardImages(mutatedCards, "small");

        const arrayBuffer = await imageBlob.arrayBuffer();
        attachment = new djs.AttachmentBuilder(Buffer.from(arrayBuffer), {
          name: "pack.png",
        });
      } catch (err) {
        console.error("Failed to generate tiled image:", err);
      }

      // Reply with the mutated link and an embed
      const isLargePool = mutatedCards.length > 15;
      const mutatedPoolUrl = `https://sealeddeck.tech/${mutatedPoolId}`;
      const embed = new djs.EmbedBuilder()
        .setTitle(isLargePool ? "Mutated Pool" : "Mutated Pack")
        .setURL(mutatedPoolUrl)
        .setFooter({
          text: `Original ${
            isLargePool ? "pool" : "pack"
          }: https://sealeddeck.tech/${poolId}`,
        });

      if (!isLargePool) {
        embed.setDescription("```\n" + cardList + "\n```");
      }

      if (attachment) {
        embed.setImage("attachment://pack.png");
      }

      const replyOptions: djs.BaseMessageOptions = {
        embeds: [embed],
      };
      if (attachment) {
        replyOptions.files = [attachment];
      }
      await message.reply(replyOptions);
    } catch (error) {
      console.error("Error processing message:", error);
      // Don't reply on errors to avoid noise if it wasn't a mutation intent
    }
  };

  client.on(djs.Events.MessageCreate, handleMessage);

  // Login
  await client.login(env["DISCORD_TOKEN"]);
}

if (import.meta.main) {
  await main();
}
