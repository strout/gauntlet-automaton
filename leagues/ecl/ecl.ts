import {
  APIEmbed,
  APISelectMenuOption,
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Interaction,
  Message,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import { Handler } from "../../dispatch.ts";
import { generateAndPostLorwynPool } from "./pools.ts";
import {
  addPoolChange,
  getAllMatches,
  getPlayers,
  getPoolChanges,
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
import {
  fetchSealedDeck,
  formatPool,
  makeSealedDeck,
  SealedDeckPool,
} from "../../sealeddeck.ts";
import { Buffer } from "node:buffer";

const pollingLock = mutex();

// ECL embed colors - Lorwyn (day) and Shadowmoor (night)
const ECL_COLORS = {
  LORWYN: 0xF1E05D, // Light Yellow (day/sunlight)
  SHADOWMOOR: 0x7C3AED, // Light Purple/Lavender (night/shadows)
} as const;

// ECL-specific helper functions for dual pool sheets
type EclPoolType = "Lorwyn" | "Shadowmoor";

const getEclPoolChanges = (poolType: EclPoolType) =>
  getPoolChanges(CONFIG.LIVE_SHEET_ID, `${poolType} Pool Changes`);

async function recordPack(
  discordId: string,
  packPoolId: string,
  poolType: EclPoolType,
): Promise<string> {
  // Get player identification from Discord ID
  const players = await getPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    console.warn(
      `Could not find player with Discord ID ${discordId} to record pack`,
    );
    throw new Error("Player not found");
  }

  // Get current pool state for the specified pool type
  const poolChanges = await getEclPoolChanges(poolType);
  const lastChange = poolChanges.rows.findLast((change) =>
    change.Name === player.Identification
  );
  if (!lastChange) {
    console.warn(
      `Could not find last pool change for ${player.Identification} in ${poolType} pool`,
    );
    throw new Error("Pool change not found");
  }

  // Build full pool with new pack
  const packContents = await fetchSealedDeck(packPoolId);
  const fullPool = await makeSealedDeck(
    packContents,
    lastChange["Full Pool"] ?? undefined,
  );

  await addPoolChange(
    player.Identification,
    "add pack",
    packPoolId,
    "",
    fullPool,
    CONFIG.LIVE_SHEET_ID,
    `${poolType} Pool Changes`,
  );

  return fullPool;
}

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
    } // Check if it's a Discord mention (<@user_id> or <@!user_id>)
    else if (/^<@!?\d+>$/.test(input)) {
      discordId = input.replace(/[<@!>]/g, "");
    } // Try to resolve as a username/tag by searching in the guild
    else {
      try {
        const guild = message.guild;
        if (!guild) {
          await message.reply(
            "❌ Could not resolve username - not in a guild.",
          );
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
          await message.reply(
            `❌ Could not find user "${username}" in this server.`,
          );
          return;
        }
      } catch (error) {
        console.error("Error resolving Discord username:", error);
        await message.reply(
          `❌ Error resolving username "${input}". Please use a numeric Discord ID or mention.`,
        );
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

  const scryfallCards = await fetchEclCards();

  const cardsToTile = cardNames
    .map((name) => scryfallCards.get(name))
    .filter((c) => c !== undefined);

  const tiledImage = await tileCardImages(cardsToTile, "small");
  return new AttachmentBuilder(Buffer.from(await tiledImage.arrayBuffer()), {
    name,
  });
}

export async function formatEclPool(pool: SealedDeckPool) {
  const cards = await fetchEclCards();
  const rarities = [
    "common",
    "uncommon",
    "rare",
    "mythic",
    "special",
    "bonus",
    undefined,
  ] as const;
  return formatPool({
    sideboard: [...pool.sideboard].sort((a, z) => {
      const cardA = cards.get(a.name);
      const cardZ = cards.get(z.name);
      if (!cardZ) return 1;
      if (!cardA) return -1;
      return rarities.indexOf(cardZ.rarity) - rarities.indexOf(cardA.rarity) ||
        ((+cardA.collector_number) - (+cardZ.collector_number));
    }),
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

  const embed1 = {
    title: "Pack 1",
    url: `https://sealeddeck.tech/${pack1.poolId}`,
    description: await formatEclPool(pack1),
    image: { url: "attachment://pack1.png" },
  };

  const embed2 = {
    title: "Pack 2",
    url: `https://sealeddeck.tech/${pack2.poolId}`,
    description: await formatEclPool(pack2),
    image: { url: "attachment://pack2.png" },
  };

  const content =
    `You have two ECL packs to allocate! Please choose how to allocate them:`;

  const options: APISelectMenuOption[] = [
    {
      label: "Pack 1 -> Lorwyn, Pack 2 -> Shadowmoor",
      value: `1L2S:${pack1.poolId}:${pack2.poolId}`,
      description:
        "Assign the first pack to Lorwyn and the second to Shadowmoor",
    },
    {
      label: "Pack 1 -> Shadowmoor, Pack 2 -> Lorwyn",
      value: `1S2L:${pack1.poolId}:${pack2.poolId}`,
      description:
        "Assign the first pack to Shadowmoor and the second to Lorwyn",
    },
  ];

  return {
    content,
    embeds: [embed1, embed2],
    options,
    files: [image1, image2],
  };
};

export async function fetchEclCards() {
  const cards = await searchCards(
    `set:ecl OR (e:spg cn≥129 cn≤148)`,
    { unique: "prints" },
  );
  return new Map(
    cards.toSorted((a, z) => (+z.collector_number) - (+a.collector_number)).map(
      (x) =>
        [x.name, x] as const
    ),
  );
}

/**
 * Announces pack allocation to #pack-generation channel with themed embeds.
 */
async function announcePackAllocation(
  client: Client,
  userId: string,
  lorwynPackId: string,
  shadowmoorPackId: string,
  lorwynFullPoolId: string,
  shadowmoorFullPoolId: string,
) {
  // Fetch pack details for embeds
  const [lorwynPack, shadowmoorPack] = await Promise.all([
    fetchSealedDeck(lorwynPackId),
    fetchSealedDeck(shadowmoorPackId),
  ]);

  // Create new pack images for the announcement
  const [lorwynImage, shadowmoorImage] = await Promise.all([
    tilePack(lorwynPack, "lorwyn-pack.png"),
    tilePack(shadowmoorPack, "shadowmoor-pack.png"),
  ]);

  // Create themed embeds - Lorwyn first, then Shadowmoor
  const lorwynEmbed = new EmbedBuilder()
    .setTitle("☀️ Lorwyn Pool")
    .setColor(ECL_COLORS.LORWYN)
    .setDescription(await formatEclPool(lorwynPack))
    .setImage("attachment://lorwyn-pack.png")
    .addFields([
      {
        name: "🔗 Pack",
        value: `[View Pack](https://sealeddeck.tech/${lorwynPackId})`,
        inline: true,
      },
      {
        name: "📦 Full Pool",
        value: `[View Pool](https://sealeddeck.tech/${lorwynFullPoolId})`,
        inline: true,
      },
    ]);

  const shadowmoorEmbed = new EmbedBuilder()
    .setTitle("🌙 Shadowmoor Pool")
    .setColor(ECL_COLORS.SHADOWMOOR)
    .setDescription(await formatEclPool(shadowmoorPack))
    .setImage("attachment://shadowmoor-pack.png")
    .addFields([
      {
        name: "🔗 Pack",
        value: `[View Pack](https://sealeddeck.tech/${shadowmoorPackId})`,
        inline: true,
      },
      {
        name: "📦 Full Pool",
        value: `[View Pool](https://sealeddeck.tech/${shadowmoorFullPoolId})`,
        inline: true,
      },
    ]);

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const packGenChannel = await guild.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as TextChannel;

  await packGenChannel.send({
    content: `<@!${userId}> allocated their ECL packs!`,
    embeds: [lorwynEmbed, shadowmoorEmbed],
    files: [lorwynImage, shadowmoorImage],
  });
}

/**
 * Handler for when a user makes an allocation choice.
 */
const onAllocationChoice = async (
  chosen: string,
  interaction: Interaction,
) => {
  const [allocation, pack1Id, pack2Id] = chosen.split(":");

  try {
    // Get player identification from Discord ID
    const players = await getPlayers();
    const player = players.rows.find((p) =>
      p["Discord ID"] === interaction.user.id
    );
    if (!player) {
      return {
        result: "failure" as const,
        content: "Could not find player record. Contact league administrator.",
        files: [],
      };
    }

    // Record packs to appropriate pools based on allocation and capture full pool IDs
    let lorwynPackId: string, shadowmoorPackId: string;
    let lorwynFullPoolId: string, shadowmoorFullPoolId: string;

    if (allocation === "1L2S") {
      // Pack 1 -> Lorwyn, Pack 2 -> Shadowmoor
      lorwynPackId = pack1Id;
      shadowmoorPackId = pack2Id;
      [lorwynFullPoolId, shadowmoorFullPoolId] = await Promise.all([
        recordPack(interaction.user.id, pack1Id, "Lorwyn"),
        recordPack(interaction.user.id, pack2Id, "Shadowmoor"),
      ]);
    } else {
      // Pack 1 -> Shadowmoor, Pack 2 -> Lorwyn
      lorwynPackId = pack2Id;
      shadowmoorPackId = pack1Id;
      [lorwynFullPoolId, shadowmoorFullPoolId] = await Promise.all([
        recordPack(interaction.user.id, pack2Id, "Lorwyn"),
        recordPack(interaction.user.id, pack1Id, "Shadowmoor"),
      ]);
    }

    console.log(
      `[ECL] Player ${player.Identification} allocated packs: ${allocation} (${pack1Id}, ${pack2Id})`,
    );

    // Announce pack allocation to #pack-generation channel
    await announcePackAllocation(
      interaction.client,
      interaction.user.id,
      lorwynPackId,
      shadowmoorPackId,
      lorwynFullPoolId,
      shadowmoorFullPoolId,
    );

    return {
      result: "success" as const,
      content: allocation === "1L2S"
        ? "Pack 1 allocated to Lorwyn and Pack 2 allocated to Shadowmoor."
        : "Pack 1 allocated to Shadowmoor and Pack 2 allocated to Lorwyn.",
    };
  } catch (error) {
    console.error(`[ECL] Error recording allocation for ${chosen}:`, error);
    return {
      result: "failure" as const,
      content:
        "Error recording allocation. Please try again or contact league administrator.",
      files: [],
    };
  }
};

/**
 * Updates embed colors when user selects allocation option.
 */
const onSelectAllocation = (
  selectedValue: string,
  interaction: StringSelectMenuInteraction,
): Promise<{ embeds?: APIEmbed[] }> => {
  const [allocation] = selectedValue.split(":");

  // Extract existing embeds from message
  const existingEmbeds = interaction.message.embeds;

  if (!existingEmbeds || existingEmbeds.length < 2) {
    return Promise.resolve({});
  }

  // Apply colors based on allocation: (index === 0) === (allocation === "1L2S") ? lorwyn : shadowmoor
  const newEmbeds = existingEmbeds.map((embed, index) => ({
    ...embed.toJSON(),
    color: (index === 0) === (allocation === "1L2S")
      ? ECL_COLORS.LORWYN
      : ECL_COLORS.SHADOWMOOR,
  }));

  return Promise.resolve({ embeds: newEmbeds });
};

const {
  sendChoice: sendAllocationChoice,
  responseHandler: allocationChoiceHandler,
} = makeChoice(
  "ECL_ALLOC",
  makeAllocationMessage,
  onAllocationChoice,
  onSelectAllocation,
);

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
    const botBunker = await guild.channels.fetch(
      CONFIG.BOT_BUNKER_CHANNEL_ID,
    ) as TextChannel;

    if (!botBunker) {
      throw new Error("Could not find bot bunker channel");
    }

    // Request two packs
    const pack1Promise = waitForBoosterTutor(
      botBunker.send(
        `!pool ECL <@${loser["Discord ID"]}> (Pack 1 for loss ${lossCount})`,
      ),
    );
    const pack2Promise = waitForBoosterTutor(
      botBunker.send(
        `!pool ECL <@${loser["Discord ID"]}> (Pack 2 for loss ${lossCount})`,
      ),
    );

    const [pack1Result, pack2Result] = await Promise.all([
      pack1Promise,
      pack2Promise,
    ]);

    if ("error" in pack1Result) {
      throw new Error(`Error generating Pack 1: ${pack1Result.error}`);
    }
    if ("error" in pack2Result) {
      throw new Error(`Error generating Pack 2: ${pack2Result.error}`);
    }

    // Trigger the DM choice
    await sendAllocationChoice(
      client,
      loser["Discord ID"],
      pack1Result.success,
      pack2Result.success,
    );
  } catch (error) {
    console.error(
      `[ECL] Error in handleLoss for ${loser.Identification}:`,
      error,
    );
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
