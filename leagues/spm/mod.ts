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
  getAllMatches,
  getPlayers,
  MATCHTYPE,
  ROWNUM,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { delay } from "@std/async/delay";
import { Client } from "discord.js";
import { ScryfallCard } from "../../scryfall.ts";
import { makeSealedDeck, SealedDeckEntry } from "../../sealeddeck.ts";
import { tileCardImages } from "../../scryfall.ts";
import { Handler } from "../../dispatch.ts";
import { Buffer } from "node:buffer";
import { generatePackFromSlots, getCitizenBoosterSlots, getCitizenHeroBoosterSlots, getCitizenVillainBoosterSlots, getHeroBoosterSlots, getVillainBoosterSlots } from "./packs.ts";
import { buildHeroVillainChoice } from "./packs.ts";
import { mutex } from "../../mutex.ts";
import { generateAndPostStartingPool } from "./pools.ts";

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
  if (!message.content.startsWith("!villainpack ") || !message.inGuild()) return;

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
const packChoiceInteractionHandler: Handler<djs.Interaction> = async (interaction, handle) => {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith("SPM_choose_hero_") && !customId.startsWith("SPM_choose_villain_")) return;

  handle.claim();

  const userId = interaction.user.id;

  // Prevent concurrent processing for a single user
  if (packChoiceLocks.has(userId)) {
    await interaction.reply({ content: "You're already processing a pack choice. Please wait...", ephemeral: true });
    return;
  }

  try {
    packChoiceLocks.add(userId);

    const packChoice = pendingPackChoices.get(userId);
    if (!packChoice) {
      await interaction.reply({ content: "You don't have a pending pack choice. Use `!packchoice` first.", ephemeral: true });
      return;
    }

    // Expiration (24 hours)
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - packChoice.timestamp > maxAge) {
      pendingPackChoices.delete(userId);
      await interaction.reply({ content: "Your pack choice has expired. Use `!packchoice` to get a new one.", ephemeral: true });
      return;
    }

    if (customId.startsWith("SPM_choose_hero_")) {
      const expectedId = `SPM_choose_hero_${packChoice.heroPoolId}`;
      if (customId !== expectedId) {
        await interaction.reply({ content: "This pack doesn't match your current options.", ephemeral: true });
        return;
      }

      // Update the original message to remove buttons
      await interaction.update({
        content: `<@!${interaction.user.id}> chose the **Hero Pack**!`,
        embeds: interaction.message.embeds,
        components: [], // Remove all buttons
      });

      // Send public message to channel with card images
      const channel = interaction.channel;
      if (channel && channel.isTextBased() && 'send' in channel) {
        // Generate card image
        let cardImageAttachment: djs.AttachmentBuilder | undefined;
        try {
          const cardImageBlob = await tileCardImages(packChoice.heroCards, "normal");
          const cardImageBuffer = Buffer.from(await cardImageBlob.arrayBuffer());
          cardImageAttachment = new djs.AttachmentBuilder(cardImageBuffer, {
            name: `hero_pack_${packChoice.heroPoolId}.png`,
            description: "Hero pack cards",
          });
        } catch (error) {
          console.error("Failed to generate hero pack image:", error);
        }

        const embed = new djs.EmbedBuilder()
          .setTitle(`🦸 Hero Pack - ${interaction.user.displayName}`)
          .setColor(0x00BFFF)
          .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
          .addFields([
            {
              name: "🔗 SealedDeck Link",
              value: `[View Pack](https://sealeddeck.tech/${packChoice.heroPoolId})`,
              inline: false,
            },
            {
              name: "🆔 SealedDeck ID",
              value: `\`${packChoice.heroPoolId}\``,
              inline: true,
            }
          ])
          .setTimestamp();

        if (cardImageAttachment) {
          embed.setImage(`attachment://${cardImageAttachment.name}`);
        }

        const files = cardImageAttachment ? [cardImageAttachment] : [];
        
        await channel.send({
          content: `<@!${interaction.user.id}> chose the **Hero Pack**!`,
          embeds: [embed],
          files,
        });
      }

      pendingPackChoices.delete(userId);
      console.log(`${interaction.user.username} chose Hero pack: ${packChoice.heroPoolId}`);
      return;
    }

    if (customId.startsWith("SPM_choose_villain_")) {
      const expectedId = `SPM_choose_villain_${packChoice.villainPoolId}`;
      if (customId !== expectedId) {
        await interaction.reply({ content: "This pack doesn't match your current options.", ephemeral: true });
        return;
      }

      // Update the original message to remove buttons
      await interaction.update({
        content: `<@!${interaction.user.id}> chose the **Villain Pack**!`,
        embeds: interaction.message.embeds,
        components: [], // Remove all buttons
      });

      // Send public message to channel with card images
      const channel = interaction.channel;
      if (channel && channel.isTextBased() && 'send' in channel) {
        // Generate card image
        let cardImageAttachment: djs.AttachmentBuilder | undefined;
        try {
          const cardImageBlob = await tileCardImages(packChoice.villainCards, "normal");
          const cardImageBuffer = Buffer.from(await cardImageBlob.arrayBuffer());
          cardImageAttachment = new djs.AttachmentBuilder(cardImageBuffer, {
            name: `villain_pack_${packChoice.villainPoolId}.png`,
            description: "Villain pack cards",
          });
        } catch (error) {
          console.error("Failed to generate villain pack image:", error);
        }

        const embed = new djs.EmbedBuilder()
          .setTitle(`🦹 Villain Pack - ${interaction.user.displayName}`)
          .setColor(0x8B0000)
          .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
          .addFields([
            {
              name: "🔗 SealedDeck Link",
              value: `[View Pack](https://sealeddeck.tech/${packChoice.villainPoolId})`,
              inline: false,
            },
            {
              name: "🆔 SealedDeck ID",
              value: `\`${packChoice.villainPoolId}\``,
              inline: true,
            }
          ])
          .setTimestamp();

        if (cardImageAttachment) {
          embed.setImage(`attachment://${cardImageAttachment.name}`);
        }

        const files = cardImageAttachment ? [cardImageAttachment] : [];
        
        await channel.send({
          content: `<@!${interaction.user.id}> chose the **Villain Pack**!`,
          embeds: [embed],
          files,
        });
      }

      pendingPackChoices.delete(userId);
      console.log(`${interaction.user.username} chose Villain pack: ${packChoice.villainPoolId}`);
      return;
    }
  } catch (error) {
    console.error("Error handling pack choice interaction:", error);
    try {
      if (!interaction.replied) {
        await interaction.reply({ content: "Failed to process your choice. Please try again.", ephemeral: true });
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
    getPlayers()
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
        `Unidentified loser ${record["Loser Name"]} for ${record[MATCHTYPE]} ${record[ROWNUM]}`,
      );
      continue;
    }

    // Skip if they're done.
    if (loser["TOURNAMENT STATUS"] === "Eliminated" || loser["Matches Played"] >= 30) {
      continue;
    }

    // Skip if we've already messaged this player in this batch
    if (messagedThisBatch.has(loser["Discord ID"])) {
      continue;
    }

    // Skip if they have a pending pack choice
    if (pendingPackChoices.has(loser["Discord ID"])) {
      continue;
    }

    try {
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(loser["Discord ID"]);

      let blocked = false;
      try {
        if (true /* TODO check if they are a citizen */) {
          await sendPackChoice(member);
        } else if (true /* TODO check if they are hero */) {
          // await generateSuperheroPack(member);
        } else if (true /* TODO check if they are villain */) {
          // await generateSupervillainPack(member);
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
      // TODO build based on type like eoe
      const cellRef = record[MATCHTYPE] === "entropy"
        ? `Entropy!J${record[ROWNUM]}`
        : `Matches!G${record[ROWNUM]}`;

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

async function sendPackChoice(member: djs.GuildMember): Promise<void> {
  console.log(`Sending pack choice to ${member.displayName}`);

  try {
    // Generate both pack options
    // Share citizen cards between both packs
    const citizenCards = await generatePackFromSlots(getCitizenBoosterSlots());
    const heroCards = await generatePackFromSlots(getCitizenHeroBoosterSlots());
    const villainCards = await generatePackFromSlots(getCitizenVillainBoosterSlots());

    // Combine citizen cards with each pack's specific cards
    const allHeroCards = [...citizenCards, ...heroCards];
    const allVillainCards = [...citizenCards, ...villainCards];

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

    // Store the pack choices for this user
    pendingPackChoices.set(member.id, {
      heroCards: allHeroCards,
      villainCards: allVillainCards,
      heroPoolId,
      villainPoolId,
      timestamp: Date.now(),
    });

    const guild = member.guild;
    const channel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as djs.TextChannel;
    await channel.send(await buildHeroVillainChoice(
      member,
      allHeroCards,
      heroPoolId,
      allVillainCards,
      villainPoolId,
    ));

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

// Send a hero pack to a member
async function sendHeroPack(member: djs.GuildMember): Promise<void> {
  console.log(`Sending hero pack to ${member.displayName}`);

  try {
    // Generate hero pack
    const heroCards = await generatePackFromSlots(getHeroBoosterSlots());
    
    // Create SealedDeck pool
    const heroPoolId = await makeSealedDeck({
      sideboard: heroCards.map((c) => ({
        name: c.name,
        count: 1,
        set: c.set ?? undefined,
      })),
    });

    // Generate card image
    let cardImageAttachment: djs.AttachmentBuilder | undefined;
    try {
      const cardImageBlob = await tileCardImages(heroCards, "normal");
      const cardImageBuffer = Buffer.from(await cardImageBlob.arrayBuffer());
      cardImageAttachment = new djs.AttachmentBuilder(cardImageBuffer, {
        name: `hero_pack_${heroPoolId}.png`,
        description: "Hero pack cards",
      });
    } catch (error) {
      console.error("Failed to generate hero pack image:", error);
    }

    const embed = new djs.EmbedBuilder()
      .setTitle(`🦸 Hero Pack - ${member.displayName}`)
      .setColor(0x00BFFF)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: `[View Pack](https://sealeddeck.tech/${heroPoolId})`,
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: `\`${heroPoolId}\``,
          inline: true,
        }
      ])
      .setTimestamp();

    if (cardImageAttachment) {
      embed.setImage(`attachment://${cardImageAttachment.name}`);
    }

    const files = cardImageAttachment ? [cardImageAttachment] : [];
    
    const guild = member.guild;
    const channel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as djs.TextChannel;
    await channel.send({
      content: `<@!${member.user.id}> received a **Hero Pack**!`,
      embeds: [embed],
      files,
    });

    console.log(`Sent hero pack to ${member.displayName} with pool ${heroPoolId}`);
  } catch (error) {
    console.error(`Failed to send hero pack to ${member.displayName}:`, error);
    throw error;
  }
}

// Send a villain pack to a member
async function sendVillainPack(member: djs.GuildMember): Promise<void> {
  console.log(`Sending villain pack to ${member.displayName}`);

  try {
    // Generate villain pack
    const villainCards = await generatePackFromSlots(getVillainBoosterSlots());
    
    // Create SealedDeck pool
    const villainPoolId = await makeSealedDeck({
      sideboard: villainCards.map((c) => ({
        name: c.name,
        count: 1,
        set: c.set ?? undefined,
      })),
    });

    // Generate card image
    let cardImageAttachment: djs.AttachmentBuilder | undefined;
    try {
      const cardImageBlob = await tileCardImages(villainCards, "normal");
      const cardImageBuffer = Buffer.from(await cardImageBlob.arrayBuffer());
      cardImageAttachment = new djs.AttachmentBuilder(cardImageBuffer, {
        name: `villain_pack_${villainPoolId}.png`,
        description: "Villain pack cards",
      });
    } catch (error) {
      console.error("Failed to generate villain pack image:", error);
    }

    const embed = new djs.EmbedBuilder()
      .setTitle(`🦹 Villain Pack - ${member.displayName}`)
      .setColor(0x8B0000)
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: `[View Pack](https://sealeddeck.tech/${villainPoolId})`,
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: `\`${villainPoolId}\``,
          inline: true,
        }
      ])
      .setTimestamp();

    if (cardImageAttachment) {
      embed.setImage(`attachment://${cardImageAttachment.name}`);
    }

    const files = cardImageAttachment ? [cardImageAttachment] : [];
    
    const guild = member.guild;
    const channel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as djs.TextChannel;
    await channel.send({
      content: `<@!${member.user.id}> received a **Villain Pack**!`,
      embeds: [embed],
      files,
    });

    console.log(`Sent villain pack to ${member.displayName} with pool ${villainPoolId}`);
  } catch (error) {
    console.error(`Failed to send villain pack to ${member.displayName}:`, error);
    throw error;
  }
}

// Pack choice tracking
interface PackChoice {
  heroCards: ScryfallCard[];
  villainCards: ScryfallCard[];
  heroPoolId: string;
  villainPoolId: string;
  timestamp: number;
}

// Store pending pack choices by Discord ID
// TODO find a way to not depend on memory for this; it won't persist.
const pendingPackChoices = new Map<string, PackChoice>();

// Mutex to prevent race conditions when processing pack choices
// TODO use real locks (mutex.ts)
const packChoiceLocks = new Set<string>();
