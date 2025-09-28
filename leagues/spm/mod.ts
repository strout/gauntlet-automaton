/* Spider-Man: Through the Omenpath */

import { CONFIG } from "../../config.ts";
import * as djs from "discord.js";
import {
  addPoolChange,
  deletePoolChange,
  getAllMatches,
  getPlayers,
  getPoolChanges,
  MATCHTYPE,
  Player,
  ROWNUM,
  Table,
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
import z from "zod";

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
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      while (true) {
        await checkForMatches(client);
        await assignHeroVillainRoles(guild, false);
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
    getSpmPlayers(),
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

const spmPlayerShape = {
  Heroism: z.number(),
  Villainy: z.number(),
};

type SPMPlayer = Player<typeof spmPlayerShape>;

function getSpmPlayers(): Promise<Table<SPMPlayer>> {
  return getPlayers(undefined, spmPlayerShape);
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
  channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  return sendPack(member, "superhero", channelId);
}

export function sendVillainPack(
  member: djs.GuildMember,
  channelId = CONFIG.PACKGEN_CHANNEL_ID,
): Promise<void> {
  return sendPack(member, "supervillain", channelId);
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

/**
 * Ensure a member has (or doesn't have) a particular role.
 * @returns whether they had the role previously.
 */
const ensureRole = async (
  member: djs.GuildMember,
  role: djs.Role,
  shouldHaveRole: boolean,
  pretend: boolean,
) => {
  const hasRole = member.roles.cache.has(role.id);
  if (!hasRole && shouldHaveRole) {
    console.log(`Adding role ${role.name} to ${member.displayName}`);
    if (!pretend) await member.roles.add(role);
  } else if (hasRole && !shouldHaveRole) {
    console.log(`Removing role ${role.name} from ${member.displayName}`);
    if (!pretend) await member.roles.remove(role);
  }
  return hasRole;
};

export const assignHeroVillainRoles = async (
  guild: djs.Guild,
  pretend: boolean,
) => {
  // Get players with Heroism and Villainy stats
  const players = await getSpmPlayers();

  const superheroRole = await guild.roles.fetch(CONFIG.SPM.SUPERHERO_ROLE_ID);
  const supervillainRole = await guild.roles.fetch(
    CONFIG.SPM.SUPERVILLAIN_ROLE_ID,
  );
  if (!superheroRole || !supervillainRole) {
    throw new Error("Could not find super roles");
  }

  for (const player of players.rows) {
    const shouldBeSuperhero = player.Heroism >= 4;
    const shouldBeSupervillain = player.Villainy >= 4;
    try {
      const member = await guild.members.fetch(player["Discord ID"]);
      await ensureRole(member, superheroRole, shouldBeSuperhero, pretend);
      await ensureRole(member, supervillainRole, shouldBeSupervillain, pretend);
    } catch (e) {
      console.error("Could not manage roles for " + player.Identification, e);
    }
  }
};
