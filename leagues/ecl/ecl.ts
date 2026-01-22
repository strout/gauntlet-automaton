import {
  APISelectMenuOption,
  AttachmentBuilder,
  Client,
  Interaction,
  Message,
  TextChannel,
} from "discord.js";
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
import { waitForBoosterTutor } from "../../pending.ts";
import { makeChoice } from "../../util/choice.ts";
import { searchCards, tileCardImages } from "../../scryfall.ts";
import { formatPool, SealedDeckPool } from "../../sealeddeck.ts";
import { Buffer } from "node:buffer";

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
 * Tilers a single pack, preserving order and duplicates.
 */
async function tilePack(pack: SealedDeckPool, name: string) {
  const cardNames = [
    ...pack.sideboard.flatMap((c) => Array(c.count).fill(c.name)),
    ...pack.deck.flatMap((c) => Array(c.count).fill(c.name)),
    ...pack.hidden.flatMap((c) => Array(c.count).fill(c.name)),
  ];

  const uniqueCardNames = [...new Set(cardNames)];
  const scryfallCards = await searchCards(
    `set:ecl (${uniqueCardNames.map((name) => `!"${name}"`).join(" OR ")})`,
  );

  const cardsToTile = cardNames
    .map((name) => scryfallCards.find((c) => c.name === name))
    .filter((c) => c !== undefined);

  const tiledImage = await tileCardImages(cardsToTile, "small");
  return new AttachmentBuilder(Buffer.from(await tiledImage.arrayBuffer()), {
    name,
  });
}

/**
 * Logic for the allocation choice message.
 */
const makeAllocationMessage = async (
  pack1: SealedDeckPool,
  pack2: SealedDeckPool,
) => {
  const [image1, image2] = await Promise.all([
    tilePack(pack1, "pack1.png"),
    tilePack(pack2, "pack2.png"),
  ]);

  const content = `You have two ECL packs to allocate!
  
**Pack 1 (https://sealeddeck.tech/${pack1.poolId})**:
${formatPool(pack1)}

**Pack 2 (https://sealeddeck.tech/${pack2.poolId})**:
${formatPool(pack2)}

Please choose how to allocate them:`;

  const options: APISelectMenuOption[] = [
    {
      label: "Pack 1 -> Lorwyn, Pack 2 -> Shadowmoor",
      value: `1L2S:${pack1.poolId}:${pack2.poolId}`,
      description: "Assign the first pack to Lorwyn and the second to Shadowmoor",
    },
    {
      label: "Pack 1 -> Shadowmoor, Pack 2 -> Lorwyn",
      value: `1S2L:${pack1.poolId}:${pack2.poolId}`,
      description: "Assign the first pack to Shadowmoor and the second to Lorwyn",
    },
  ];

  return {
    content,
    options,
    files: [image1, image2],
  };
};

/**
 * Handler for when the user makes an allocation choice.
 */
const onAllocationChoice = (
  chosen: string,
  _interaction: Interaction,
) => {
  const [allocation, pack1Id, pack2Id] = chosen.split(":");

  // Stub for future pool updates
  console.log(
    `[ECL] Player chose allocation ${allocation} for packs ${pack1Id} and ${pack2Id}`,
  );

  let responseText = "";
  if (allocation === "1L2S") {
    responseText =
      "Allocated Pack 1 to Lorwyn and Pack 2 to Shadowmoor. (Stubbed)";
  } else {
    responseText =
      "Allocated Pack 1 to Shadowmoor and Pack 2 to Lorwyn. (Stubbed)";
  }

  return Promise.resolve({
    result: "success" as const,
    content: `Choice recorded: ${responseText}`,
    files: [],
  });
};

const { sendChoice: sendAllocationChoice, responseHandler: allocationChoiceHandler } = 
  makeChoice("ECL_ALLOC", makeAllocationMessage, onAllocationChoice);

/**
 * Placeholder logic for when a player loses a match.
 */
async function handleLoss(
  client: Client,
  loser: Player<Record<string, never>>,
  _match: Record<string, unknown>,
  lossCount: number,
) {
  console.log(
    `[ECL] Handling loss for ${loser.Identification} (Loss #${lossCount})`,
  );

  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const botBunker = await guild.channels.fetch(CONFIG.BOT_BUNKER_CHANNEL_ID) as TextChannel;

    if (!botBunker) {
      throw new Error("Could not find bot bunker channel");
    }

    // Request two packs
    const pack1Promise = waitForBoosterTutor(
      botBunker.send(`!pool ECL <@${loser["Discord ID"]}> (Pack 1 for loss ${lossCount})`)
    );
    const pack2Promise = waitForBoosterTutor(
      botBunker.send(`!pool ECL <@${loser["Discord ID"]}> (Pack 2 for loss ${lossCount})`)
    );

    const [pack1Result, pack2Result] = await Promise.all([pack1Promise, pack2Promise]);

    if ("error" in pack1Result) {
      throw new Error(`Error generating Pack 1: ${pack1Result.error}`);
    }
    if ("error" in pack2Result) {
      throw new Error(`Error generating Pack 2: ${pack2Result.error}`);
    }

    // Trigger the DM choice
    await sendAllocationChoice(client, loser["Discord ID"], pack1Result.success, pack2Result.success);

  } catch (error) {
    console.error(`[ECL] Error in handleLoss for ${loser.Identification}:`, error);
    // Notify owner or log more details if needed
  }
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
    interactionHandlers: [allocationChoiceHandler],
  });
}
