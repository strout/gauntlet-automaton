/* Spider-Man: Through the Omenpath */

/* TODO
  * [x] starting pool packs
  * [x] distribution of packs (DMs)
  * [x] pack selection & generation for civilians
  * [ ] pack selection & generation for heroes
  * [ ] pack selection & generation for villains
  * [ ] hero/villain tracking
  */

import { CONFIG } from "../../config.ts";
import * as djs from "discord.js";
import {
  addPoolChange,
  deletePoolChange,
  getAllMatches,
  getPlayers,
  getPoolChanges,
  MATCHTYPE,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { delay } from "@std/async/delay";
import { Client } from "discord.js";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "../../sealeddeck.ts";
import { tileCardImages } from "../../scryfall.ts";
import { Handler } from "../../dispatch.ts";
import { fetchMessageByUrl } from "../../main.ts";
import { Buffer } from "node:buffer";
import {
  formatPackCards,
  generatePackFromSlots,
  getCitizenBoosterSlots,
  getCitizenHeroBoosterSlots,
  getCitizenVillainBoosterSlots,
  getHeroBoosterSlots,
  getVillainBoosterSlots,
} from "./packs.ts";
import { buildHeroVillainChoice } from "./packs.ts";
import { mutex } from "../../mutex.ts";
import { generateAndPostStartingPool } from "./pools.ts";
import { z } from "zod";

const deletionLock = mutex();

// Pool generation handler
const poolHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!poolspm")) return;

  handle.claim();

  try {
    // Extract username from command (e.g., "!poolspm @username" or "!poolspm username")
    const args = message.content.trim().split(/\s+/);
    if (args.length < 2) {
      await message.reply(
        "Usage: `!poolspm [username]` - mention the user you want to generate a pool for.",
      );
      return;
    }

    // Get the mentioned user or try to parse the username
    const targetUser = message.mentions.users.first();

    if (!targetUser) {
      await message.reply(
        "Could not find the specified user. Make sure to mention them or use their exact username.",
      );
      return;
    }

    if (!message.member?.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) {
      await message.reply("Only LC can generate pools!");
      return;
    }

    // Generate and post the starting pool
    await generateAndPostStartingPool(
      targetUser,
      message.channel as djs.TextChannel,
      message,
    );
  } catch (error) {
    console.error("Error in pool handler:", error);
    await message.reply(
      "An error occurred while generating the pool. Please try again.",
    );
  }
};

export async function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<djs.Message>[];
  interactionHandlers: Handler<djs.Interaction>[];
}> {
  await Promise.resolve();
  const messageHandlers: Handler<djs.Message>[] = [
    packChoiceHandler,
    heroPackHandler,
    villainPackHandler,
    poolHandler,
    unpickHandler,
  ];
  return {
    watch: async (client: Client) => {
      while (true) {
        await checkForMatches(client);
        await delay(60_000);
      }
    },
    messageHandlers,
    interactionHandlers: [packChoiceInteractionHandler],
  };
}

const unpickHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!unpick ")) return;

  handle.claim();

  const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);

  try {
    const member = await guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) {
      await message.reply("Only LC can unpick choices!");
      return;
    }
  } catch (_e) {
    await message.reply("Only LC can unpick choices!");
    return;
  }

  using _ = await deletionLock();

  try {
    const url = message.content.split(" ")[1];
    if (!url) {
      await message.reply("Usage: `!unpick [message_url]`");
      return;
    }

    const announcementMsg = await fetchMessageByUrl(message.client, url);

    if (!announcementMsg) {
      await message.reply("Could not fetch message from URL. Is it valid?");
      return;
    }

    if (
      announcementMsg.guildId !== CONFIG.GUILD_ID ||
      announcementMsg.channelId !== CONFIG.PACKGEN_CHANNEL_ID
    ) {
      await message.reply("Message must be from the pack generation channel.");
      return;
    }

    const targetUserId = announcementMsg.mentions.users.first()?.id;
    if (!targetUserId) {
      await message.reply(
        "Could not find a user mentioned in the announcement.",
      );
      return;
    }

    const chosenPackId = announcementMsg.embeds[0]?.fields.find((f) =>
      f.name === "🆔 SealedDeck ID"
    )?.value.replace(/`/g, "");
    if (!chosenPackId) {
      await message.reply(
        "Could not determine chosen pack ID from announcement.",
      );
      return;
    }

    const [players, poolChanges] = await Promise.all([
      getPlayers(),
      getPoolChanges(),
    ]);
    const player = players.rows.find((p) => p["Discord ID"] === targetUserId);
    if (!player) {
      await message.reply("Could not find player data.");
      return;
    }

    const changeRow = poolChanges.rows.findLast(
      (row) =>
        row["Name"] === player.Identification && row["Value"] === chosenPackId,
    );

    if (!changeRow) {
      await message.reply(
        "Could not find the corresponding pool change to delete.",
      );
      return;
    }

    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(targetUserId);
    const dmChannel = await member.createDM();
    const messages = await dmChannel.messages.fetch({ limit: 20 });

    const choiceType = announcementMsg.content.includes("Hero Pack")
      ? "Hero"
      : "Villain";
    const dmToEdit = messages.find((m) =>
      m.author.id === message.client.user?.id &&
      m.content.includes(`You chose the **${choiceType} Pack**!`)
    );

    if (!dmToEdit || dmToEdit.embeds.length < 2) {
      await message.reply(
        "Could not find the original DM to restore. Aborting.",
      );
      return;
    }

    const heroEmbed = dmToEdit.embeds.find((e) =>
      e.title?.includes("Hero Pack")
    );
    const villainEmbed = dmToEdit.embeds.find((e) =>
      e.title?.includes("Villain Pack")
    );

    const heroPoolId = heroEmbed?.fields.find((f) =>
      f.name === "🆔 SealedDeck ID"
    )?.value.replace(/`/g, "");
    const villainPoolId = villainEmbed?.fields.find((f) =>
      f.name === "🆔 SealedDeck ID"
    )?.value.replace(/`/g, "");

    if (!heroPoolId || !villainPoolId) {
      throw new Error("Could not extract pool IDs from DM embeds.");
    }

    const components = [
      new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
        new djs.ButtonBuilder({
          customId: `SPM_choose_hero_${heroPoolId}`,
          label: "Choose Hero",
          style: djs.ButtonStyle.Primary,
        }),
        new djs.ButtonBuilder({
          customId: `SPM_choose_villain_${villainPoolId}`,
          label: "Choose Villain",
          style: djs.ButtonStyle.Danger,
        }),
      ),
    ];

    await dmToEdit.edit({
      content: `<@!${member.user.id}>, choose your path — Hero or Villain?`,
      components,
    });

    await deletePoolChange(changeRow[ROWNUM]);

    await announcementMsg.delete();

    await message.reply("Unpick successful.");
  } catch (error) {
    console.error("Error in unpick handler:", error);
    await message.reply("An error occurred during unpick. Check logs.");
  }
};

// Bot command handler for pack generation
const packChoiceHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!packchoice ") || !message.inGuild()) return;

  // Extract mentioned user or use message author
  const mentionedUser = message.mentions.users.first();
  const targetUser = mentionedUser || message.author;

  // Check if user has permission (league committee, webhook users, or mentioned themselves)
  const isLeagueCommittee = message.member?.roles.cache.has(
    CONFIG.LEAGUE_COMMITTEE_ROLE_ID,
  );
  const isWebhookUser = message.author.id === CONFIG.PACKGEN_USER_ID;
  const isSelfTarget = targetUser.id === message.author.id;

  if (!isLeagueCommittee && !isWebhookUser && !isSelfTarget) {
    await message.reply("You can only generate pack choices for yourself!");
    return;
  }

  handle.claim();

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(targetUser.id);

    await message.reply(`Generating pack choice for ${member.displayName}...`);
    await sendPackChoice(member);

    await message.reply(`Pack choice sent to ${member.displayName}!`);
  } catch (error) {
    console.error("Error in pack choice handler:", error);
    await message.reply("Failed to generate pack choice. Please try again.");
  }
};

// Hero pack handler for testing
const heroPackHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!heropack ") || !message.inGuild()) return;

  // Extract mentioned user or use message author
  const mentionedUser = message.mentions.users.first();
  const targetUser = mentionedUser || message.author;

  // Check if user has permission (league committee, webhook users, or mentioned themselves)
  const isLeagueCommittee = message.member?.roles.cache.has(
    CONFIG.LEAGUE_COMMITTEE_ROLE_ID,
  );
  const isWebhookUser = message.author.id === CONFIG.PACKGEN_USER_ID;
  const isSelfTarget = targetUser.id === message.author.id;

  if (!isLeagueCommittee && !isWebhookUser && !isSelfTarget) {
    await message.reply("You can only generate hero packs for yourself!");
    return;
  }

  handle.claim();

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(targetUser.id);

    await message.reply(`Generating hero pack for ${member.displayName}...`);
    await sendHeroPack(member);
  } catch (error) {
    console.error("Error in hero pack handler:", error);
    await message.reply("Failed to generate hero pack. Please try again.");
  }
};

// Villain pack handler for testing
const villainPackHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!villainpack ") || !message.inGuild()) {
    return;
  }

  // Extract mentioned user or use message author
  const mentionedUser = message.mentions.users.first();
  const targetUser = mentionedUser || message.author;

  // Check if user has permission (league committee, webhook users, or mentioned themselves)
  const isLeagueCommittee = message.member?.roles.cache.has(
    CONFIG.LEAGUE_COMMITTEE_ROLE_ID,
  );
  const isWebhookUser = message.author.id === CONFIG.PACKGEN_USER_ID;
  const isSelfTarget = targetUser.id === message.author.id;

  if (!isLeagueCommittee && !isWebhookUser && !isSelfTarget) {
    await message.reply("You can only generate villain packs for yourself!");
    return;
  }

  handle.claim();

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(targetUser.id);

    await message.reply(`Generating villain pack for ${member.displayName}...`);
    await sendVillainPack(member);
  } catch (error) {
    console.error("Error in villain pack handler:", error);
    await message.reply("Failed to generate villain pack. Please try again.");
  }
};

// New interaction handler for pack choice buttons
const packChoiceInteractionHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (
    !customId.startsWith("SPM_choose_hero_") &&
    !customId.startsWith("SPM_choose_villain_")
  ) return;

  handle.claim();

  const userId = interaction.user.id;

  // ensure the right person presses it
  if (!interaction.message.mentions.has(userId)) {
    await interaction.reply({
    content: "Sorry, only the mentioned user can choose a pack.",
      ephemeral: true,
    });
    return;
  }

  // Prevent concurrent processing for a single user
  if (packChoiceLocks.has(userId)) {
    await interaction.reply({
      content: "You're already processing a pack choice. Please wait...",
      ephemeral: true,
    });
    return;
  }

  try {
    packChoiceLocks.add(userId);

    const [choiceType, packPoolId] = customId.split("_").slice(2) as [
      "hero" | "villain",
      string,
    ];

    // find the embed matching this pool ID
    const chosenEmbed = interaction.message.embeds.find((embed) => {
      return embed.fields.some((field) => field.value.includes(packPoolId));
    });

    if (!chosenEmbed) {
      await interaction.reply({
        content: "This pack doesn't match your current options.",
        ephemeral: true,
      });
      return;
    }

    const titleCaseChoiceType = choiceType.charAt(0).toUpperCase() +
      choiceType.slice(1);

    // Update the original message to remove buttons
    await interaction.update({
      content: `You chose the **${titleCaseChoiceType} Pack**!`,
      components: [], // Remove all buttons
    });

    // Build a new embed from the chosen embed (including its image and description and fields)
    const newEmbed = new djs.EmbedBuilder()
      .setTitle(chosenEmbed.title)
      .setColor(chosenEmbed.color)
      .setThumbnail(chosenEmbed.thumbnail?.url ?? null)
      .setImage(chosenEmbed.image?.url ?? null)
      .setDescription(chosenEmbed.description)
      .addFields(chosenEmbed.fields)
      .setTimestamp();

    const guild = await interaction.client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel;
    await channel.send({
      content:
        `<@!${interaction.user.id}> chose a **${titleCaseChoiceType} Pack**!`,
      embeds: [newEmbed],
    });

    await recordPack(interaction.user.id, choiceType, packPoolId);
  } catch (error) {
    console.error("Error handling pack choice interaction:", error);
    try {
      if (!interaction.replied) {
        await interaction.reply({
          content: "Failed to process your choice. Please try again.",
          ephemeral: true,
        });
      }
    // deno-lint-ignore no-empty
    } catch {}
  } finally {
    packChoiceLocks.delete(userId);
    checkForMatches(interaction.client);
  }
};

const matchesLock = mutex();
let matchesRequested = false;

async function checkForMatches(client: Client<boolean>) {
  // TODO Abstract out this "requested" song-and-dance; it's essentially a debounce
  if (matchesRequested) return;
  matchesRequested = true;
  using _ = await matchesLock();
  if (!matchesRequested) return;
  matchesRequested = false;

  const [records, players] = await Promise.all([
    getAllMatches(),
    getPlayers(undefined, {
      ["Heroism"]: z.number(),
      ["Villainy"]: z.number(),
    }),
  ]);

  // Track players we've already messaged in this batch
  const messagedThisBatch = new Set<string>();

  for (const record of records.rows) {
    if (record["Bot Messaged"] || !record["Script Handled"]) continue;

    // Find losing player
    const loser = players.rows.find((p) =>
      p.Identification === record["Loser Name"]
    );
    if (!loser) {
      console.warn(
        `Unidentified loser ${record["Loser Name"]} for ${record[MATCHTYPE]} ${
          record[ROWNUM]
        }`,
      );
      continue;
    }

    // Skip if they're done.
    if (
      loser["TOURNAMENT STATUS"] === "Eliminated" ||
      loser["Matches played"] >= 30
    ) {
      continue;
    }

    // Skip if we've already messaged this player in this batch
    if (messagedThisBatch.has(loser["Discord ID"])) {
      continue;
    }

    const totalPacksChosen = loser["Heroism"] + loser["Villainy"];
    const totalMessagesSent = records.rows.filter((r) =>
      r["Loser Name"] === loser.Identification && r["Bot Messaged"]
    ).length;
    // skip if they have unanswered messages
    if (totalMessagesSent > totalPacksChosen) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(loser["Discord ID"]);

      let blocked = false;
      try {
        if (loser["Heroism"] < 4 && loser["Villainy"] < 4) {
          await sendPackChoice(member);
        } else if (loser["Heroism"] >= 4) {
          await sendHeroPack(member);
        } else if (loser["Villainy"] >= 4) {
          await sendVillainPack(member);
        } else {
          console.warn(
            `No valid pack choice for ${loser.Identification} with Heroism ${
              loser["Heroism"]
            } and Villainy ${loser["Villainy"]}`,
          );
          const owner = await client.users.fetch(CONFIG.OWNER_ID);
          await owner.send(
            `No valid pack choice for ${loser.Identification} with Heroism ${
              loser["Heroism"]
            } and Villainy ${loser["Villainy"]}`,
          );
        }
      } catch (e: unknown) {
        if (e instanceof djs.DiscordAPIError && e.code === 10007) {
          blocked = true;
        } else {
          throw e;
        }
      }

      // Mark this player as messaged in this batch
      messagedThisBatch.add(loser["Discord ID"]);

      // Build the complete cell reference based on record type
      const cellRef = `${records.sheetName[record[MATCHTYPE]]}!R${
        record[ROWNUM]
      }C${records.headerColumns[record[MATCHTYPE]]["Bot Messaged"] + 1}`;

      // Mark record as messaged in the appropriate sheet
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        cellRef,
        [[blocked ? "-1" : "1"]],
      );
    } catch (error) {
      console.error(
        `Error sending upgrade message to ${loser.Identification} (${
          loser["Discord ID"]
        }):`,
        error,
      );
    }
  }
}

export async function sendPackChoice(
  member: djs.GuildMember,
  _channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  console.log(`Sending pack choice to ${member.displayName}`);

  try {
    // Generate both pack options
    // Share citizen cards between both packs
    const citizenCards = await generatePackFromSlots(getCitizenBoosterSlots());
    const heroCards = await generatePackFromSlots(getCitizenHeroBoosterSlots());
    const villainCards = await generatePackFromSlots(
      getCitizenVillainBoosterSlots(),
    );

    // Combine citizen cards with each pack's specific cards
    const allHeroCards = [...heroCards, ...citizenCards];
    const allVillainCards = [...villainCards, ...citizenCards];

    // Convert ScryfallCard[] -> SealedDeckEntry[] for sealed-deck creation
    const heroSideboard: SealedDeckEntry[] = allHeroCards.map((c) => ({
      name: c.name,
      count: 1,
      set: (c.set ?? undefined),
    }));
    const villainSideboard: SealedDeckEntry[] = allVillainCards.map((c) => ({
      name: c.name,
      count: 1,
      set: (c.set ?? undefined),
    }));

    // Create SealedDeck pools for both packs
    const heroPoolId = await makeSealedDeck({ sideboard: heroSideboard });
    const villainPoolId = await makeSealedDeck({ sideboard: villainSideboard });

    const options = await buildHeroVillainChoice(
      member,
      allHeroCards,
      heroPoolId,
      allVillainCards,
      villainPoolId,
    );
    await member.send(
      options,
    );

    console.log(
      `Sent pack choice to ${member.displayName} with pools ${heroPoolId} and ${villainPoolId}`,
    );
  } catch (error) {
    console.error(
      `Failed to send pack choice to ${member.displayName}:`,
      error,
    );
    throw error;
  }
}

export function sendHeroPack(
  member: djs.GuildMember,
  _channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  return sendPack(member, "superhero", _channelId);
}

export function sendVillainPack(
  member: djs.GuildMember,
  _channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  return sendPack(member, "supervillain", _channelId);
}

async function sendPack(
  member: djs.GuildMember,
  type: "superhero" | "supervillain",
  channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  console.log(`Sending ${type} pack to ${member.displayName}`);

  try {
    // Choose slots based on type
    const slots = type === "superhero"
      ? getHeroBoosterSlots()
      : getVillainBoosterSlots();

    // Generate pack cards
    const cards = await generatePackFromSlots(slots);

    // Create SealedDeck pool
    const poolId = await makeSealedDeck({
      sideboard: cards.map((c) => ({
        name: c.name,
        count: 1,
        set: c.set ?? undefined,
      })),
    });

    // Generate card image (optional)
    let cardImageAttachment: djs.AttachmentBuilder | undefined;
    try {
      const cardImageBlob = await tileCardImages(cards, "normal");
      const cardImageBuffer = Buffer.from(await cardImageBlob.arrayBuffer());
      cardImageAttachment = new djs.AttachmentBuilder(cardImageBuffer, {
        name: `${type}_pack_${poolId}.png`,
        description: `${type[0].toUpperCase() + type.slice(1)} pack cards`,
      });
    } catch (error) {
      console.error(`Failed to generate ${type} pack image:`, error);
    }

    // Build embed with type-specific styling
    const isHero = type === "superhero";
    const embed = new djs.EmbedBuilder()
      .setTitle(
        `${
          isHero ? "🦸 Superhero Pack" : "🦹 Supervillain Pack"
        } - ${member.displayName}`,
      )
      .setDescription(formatPackCards(cards))
      .setColor(isHero ? 0x00BFFF : 0x8B0000)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: `[View Pack](https://sealeddeck.tech/${poolId})`,
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: `\`${poolId}\``,
          inline: true,
        },
      ])
      .setTimestamp();

    if (cardImageAttachment) {
      embed.setImage(`attachment://${cardImageAttachment.name}`);
    }

    const files = cardImageAttachment ? [cardImageAttachment] : [];

    const guild = member.guild;
    const channel = await guild.channels.fetch(channelId) as djs.TextChannel;
    await channel.send({
      content: `<@!${member.user.id}> received a **${
        isHero ? "Superhero" : "Supervillain"
      } Pack**!`,
      embeds: [embed],
      files,
    });

    console.log(
      `Sent ${type} pack to ${member.displayName} with pool ${poolId}`,
    );

    await recordPack(member.user.id, type, poolId);
  } catch (error) {
    console.error(
      `Failed to send ${type} pack to ${member.displayName}:`,
      error,
    );
    throw error;
  }
}

// Mutex to prevent race conditions when processing pack choices
const packChoiceLocks = new Set<string>();

async function recordPack(
  id: string,
  type: "hero" | "villain" | "superhero" | "supervillain",
  packPoolId: string,
) {
  using _ = await lockPlayer(id);
  const [players, poolChanges] = await Promise.all([
    getPlayers(),
    getPoolChanges(),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === id);
  if (!player) {
    console.warn(`Could not find player with Discord ID ${id} to record pack`);
    return;
  }
  const lastChange = poolChanges.rows.findLast((change) =>
    change["Name"] === player.Identification
  );
  if (!lastChange) {
    console.warn(
      `Could not find last pool change for ${player.Identification}`,
    );
    return;
  }

  const packContents = await fetchSealedDeck(packPoolId);
  // build full pool
  const fullPool = await makeSealedDeck(
    packContents,
    lastChange["Full Pool"] ?? undefined,
  );
  await addPoolChange(
    player.Identification,
    "add pack",
    packPoolId,
    type,
    fullPool,
  );
}

const playerLocks = new Map<string, () => Promise<Disposable>>();

function lockPlayer(discordId: string) {
  let lock = playerLocks.get(discordId);
  if (!lock) {
    lock = mutex();
    playerLocks.set(discordId, lock);
  }
  return lock();
}

export const assignHeroVillainRoles = async (
  members: djs.Collection<djs.Snowflake, djs.GuildMember>,
  pretend: boolean,
) => {
  // Get players with Heroism and Villainy stats
  const players = await getPlayers(undefined, {
    ["Heroism"]: z.number(),
    ["Villainy"]: z.number(),
  });

  // Create a map of Discord ID to player data for quick lookup
  const playerMap = new Map<string, any>();
  for (const player of players.rows) {
    if (player["Discord ID"]) {
      playerMap.set(player["Discord ID"], player);
    }
  }

  const shouldHaveSuperheroRole = (m: djs.GuildMember) => {
    const player = playerMap.get(m.id);
    if (!player) return false;
    const heroism = player["Heroism"] || 0;
    const villainy = player["Villainy"] || 0;
    return heroism >= 4 && heroism > villainy;
  };

  const shouldHaveSupervillainRole = (m: djs.GuildMember) => {
    const player = playerMap.get(m.id);
    if (!player) return false;
    const heroism = player["Heroism"] || 0;
    const villainy = player["Villainy"] || 0;
    return villainy >= 4 && villainy > heroism;
  };

  // Find members who need superhero role
  const needsSuperheroRole = [...members.values()].filter((m) =>
    shouldHaveSuperheroRole(m) && !m.roles.cache.has(CONFIG.SPM.SUPERHERO_ROLE_ID)
  );

  // Find members who need supervillain role
  const needsSupervillainRole = [...members.values()].filter((m) =>
    shouldHaveSupervillainRole(m) && !m.roles.cache.has(CONFIG.SPM.SUPERVILLAIN_ROLE_ID)
  );

  // Find members who have superhero role but shouldn't
  const shouldRemoveSuperheroRole = [...members.values()].filter((m) =>
    m.roles.cache.has(CONFIG.SPM.SUPERHERO_ROLE_ID) && !shouldHaveSuperheroRole(m)
  );

  // Find members who have supervillain role but shouldn't
  const shouldRemoveSupervillainRole = [...members.values()].filter((m) =>
    m.roles.cache.has(CONFIG.SPM.SUPERVILLAIN_ROLE_ID) && !shouldHaveSupervillainRole(m)
  );

  // Log summary
  console.log("Superhero/Supervillain Role Assignment Summary:");
  console.log(`Total members: ${members.size}`);
  console.log(`Need Superhero role: ${needsSuperheroRole.length}`);
  console.log(`Need Supervillain role: ${needsSupervillainRole.length}`);
  console.log(`Should remove Superhero role: ${shouldRemoveSuperheroRole.length}`);
  console.log(`Should remove Supervillain role: ${shouldRemoveSupervillainRole.length}`);

  // Add superhero roles
  if (needsSuperheroRole.length) {
    console.log("Adding Superhero role to:");
    console.table(
      needsSuperheroRole.map((m) => {
        const player = playerMap.get(m.id);
        return {
          name: m.displayName,
          heroism: player?.["Heroism"] || 0,
          villainy: player?.["Villainy"] || 0,
        };
      }),
    );
    for (const m of needsSuperheroRole) {
      if (!pretend) await m.roles.add(CONFIG.SPM.SUPERHERO_ROLE_ID);
      console.log("Added Superhero role to " + m.displayName);
      await delay(250);
    }
  }

  // Add supervillain roles
  if (needsSupervillainRole.length) {
    console.log("Adding Supervillain role to:");
    console.table(
      needsSupervillainRole.map((m) => {
        const player = playerMap.get(m.id);
        return {
          name: m.displayName,
          heroism: player?.["Heroism"] || 0,
          villainy: player?.["Villainy"] || 0,
        };
      }),
    );
    for (const m of needsSupervillainRole) {
      if (!pretend) await m.roles.add(CONFIG.SPM.SUPERVILLAIN_ROLE_ID);
      console.log("Added Supervillain role to " + m.displayName);
      await delay(250);
    }
  }

  // Remove superhero roles
  if (shouldRemoveSuperheroRole.length) {
    console.log("Removing Superhero role from:");
    console.table(
      shouldRemoveSuperheroRole.map((m) => {
        const player = playerMap.get(m.id);
        return {
          name: m.displayName,
          heroism: player?.["Heroism"] || 0,
          villainy: player?.["Villainy"] || 0,
        };
      }),
    );
    for (const m of shouldRemoveSuperheroRole) {
      if (!pretend) await m.roles.remove(CONFIG.SPM.SUPERHERO_ROLE_ID);
      console.log("Removed Superhero role from " + m.displayName);
      await delay(250);
    }
  }

  // Remove supervillain roles
  if (shouldRemoveSupervillainRole.length) {
    console.log("Removing Supervillain role from:");
    console.table(
      shouldRemoveSupervillainRole.map((m) => {
        const player = playerMap.get(m.id);
        return {
          name: m.displayName,
          heroism: player?.["Heroism"] || 0,
          villainy: player?.["Villainy"] || 0,
        };
      }),
    );
    for (const m of shouldRemoveSupervillainRole) {
      if (!pretend) await m.roles.remove(CONFIG.SPM.SUPERVILLAIN_ROLE_ID);
      console.log("Removed Supervillain role from " + m.displayName);
      await delay(250);
    }
  }
};