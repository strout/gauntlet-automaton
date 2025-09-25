/* Spider-Man: Through the Omenpath */

/* TODO
  * [x] starting pool packs
  * [ ] distribution of packs (DMs)
  * [ ] pack selection & generation for civilians
  * [ ] pack selection & generation for heroes
  * [ ] pack selection & generation for villains
  * [ ] hero/villain tracking
  */

import { CONFIG } from "../../main.ts";
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
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import { makeSealedDeck, SealedDeckEntry } from "../../sealeddeck.ts";
import { tileCardImages } from "../../scryfall.ts";
import { choice, weightedChoice } from "../../random.ts";
import { Handler } from "../../dispatch.ts";
import { addPoolChange } from "../../standings.ts";
import { Buffer } from "node:buffer";

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
    heroChoiceHandler,
    villainChoiceHandler,
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
    interactionHandlers: [],
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

// Hero pack choice handler
const heroChoiceHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!hero")) return;

  handle.claim();

  const userId = message.author.id;

  // Check if this user is already processing a pack choice
  if (packChoiceLocks.has(userId)) {
    await message.reply(
      "You're already processing a pack choice. Please wait...",
    );
    return;
  }

  try {
    // Lock this user's pack choice processing
    packChoiceLocks.add(userId);

    // Check if user has a pending pack choice
    const packChoice = pendingPackChoices.get(userId);
    if (!packChoice) {
      await message.reply(
        "You don't have a pending pack choice. Use `!packchoice` first.",
      );
      return;
    }

    // Check if the choice is not too old (24 hours)
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    if (Date.now() - packChoice.timestamp > maxAge) {
      pendingPackChoices.delete(userId);
      await message.reply(
        "Your pack choice has expired. Use `!packchoice` to get a new one.",
      );
      return;
    }

    // Use the stored hero pack
    const { heroPack, heroPoolId } = packChoice;

    await message.reply({
      content: `You chose the **Hero Pack**! Here's your pack:`,
      embeds: [{
        title: "🦸 Hero Pack",
        description: `[View Pack](https://sealeddeck.tech/${heroPoolId})\n${
          formatPackCards(heroPack)
        }`,
        color: 0x00BFFF,
      }],
    });

    // Remove the pending choice
    pendingPackChoices.delete(userId);

    console.log(`${message.author.displayName} chose Hero pack: ${heroPoolId}`);
  } catch (error) {
    console.error("Error in hero choice handler:", error);
    await message.reply(
      "Failed to process hero pack choice. Please try again.",
    );
  } finally {
    // Always release the lock
    packChoiceLocks.delete(userId);
  }
};

// Villain pack choice handler
const villainChoiceHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!villain")) return;

  handle.claim();

  const userId = message.author.id;

  // Check if this user is already processing a pack choice
  if (packChoiceLocks.has(userId)) {
    await message.reply(
      "You're already processing a pack choice. Please wait...",
    );
    return;
  }

  try {
    // Lock this user's pack choice processing
    packChoiceLocks.add(userId);

    // Check if user has a pending pack choice
    const packChoice = pendingPackChoices.get(userId);
    if (!packChoice) {
      await message.reply(
        "You don't have a pending pack choice. Use `!packchoice` first.",
      );
      return;
    }

    // Check if the choice is not too old (24 hours)
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    if (Date.now() - packChoice.timestamp > maxAge) {
      pendingPackChoices.delete(userId);
      await message.reply(
        "Your pack choice has expired. Use `!packchoice` to get a new one.",
      );
      return;
    }

    // Use the stored villain pack
    const { villainPack, villainPoolId } = packChoice;

    await message.reply({
      content: `You chose the **Villain Pack**! Here's your pack:`,
      embeds: [{
        title: "🦹 Villain Pack",
        description: `[View Pack](https://sealeddeck.tech/${villainPoolId})\n${
          formatPackCards(villainPack)
        }`,
        color: 0x8B0000,
      }],
    });

    // Remove the pending choice
    pendingPackChoices.delete(userId);

    console.log(
      `${message.author.displayName} chose Villain pack: ${villainPoolId}`,
    );
  } catch (error) {
    console.error("Error in villain choice handler:", error);
    await message.reply(
      "Failed to process villain pack choice. Please try again.",
    );
  } finally {
    // Always release the lock
    packChoiceLocks.delete(userId);
  }
};

async function checkForMatches(client: Client<boolean>) {
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
        `Unidentified loser ${record["Loser Name"]} for ${record[MATCHTYPE]} ${
          record[MATCHTYPE] === "match"
            ? record[ROWNUM]
            : record[MATCHTYPE] === "entropy"
            ? record[ROWNUM]
            : (() => {
              throw new Error("Invalid record type");
            })()
        }`,
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

    try {
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(loser["Discord ID"]);

      let blocked = false;
      try {
        await sendPackChoice(member);
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
    // TODO share cards for non-differentiated slots
    const heroPack = await generatePackFromSlots(getCitizenHeroBoosterSlots());
    const villainPack = await generatePackFromSlots(
      getCitizenVillainBoosterSlots(),
    );

    // Create SealedDeck pools for both packs
    const heroPoolId = await makeSealedDeck({ sideboard: heroPack });
    const villainPoolId = await makeSealedDeck({ sideboard: villainPack });

    // Store the pack choices for this user
    pendingPackChoices.set(member.id, {
      heroPack,
      villainPack,
      heroPoolId,
      villainPoolId,
      timestamp: Date.now(),
    });

    // Create embed with pack choices
    const embed = new djs.EmbedBuilder()
      .setTitle("🕷️ Spider-Man: Pack Choice")
      .setDescription("Choose your path - Hero or Villain?")
      .setColor(0xFF6B35)
      .addFields([
        {
          name: "🦸 Hero Pack",
          value: `[View Pack](https://sealeddeck.tech/${heroPoolId})\n${
            formatPackCards(heroPack)
          }`,
          inline: true,
        },
        {
          name: "🦹 Villain Pack",
          value: `[View Pack](https://sealeddeck.tech/${villainPoolId})\n${
            formatPackCards(villainPack)
          }`,
          inline: true,
        },
      ])
      .setFooter({ text: "Reply with !hero or !villain to choose" })
      .setTimestamp();

    await member.send({
      content: "You have a new pack choice! Choose your path:",
      embeds: [embed],
    });

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

// Generate pack cards from booster slots
async function generatePackFromSlots(
  slots: BoosterSlot[],
): Promise<SealedDeckEntry[]> {
  const packCards: SealedDeckEntry[] = [];

  for (const slot of slots) {
    try {
      // Build Scryfall query
      let query = slot.scryfall || "set:om1";

      // Add rarity filter if specified
      if (slot.rarity) {
        if (slot.rarity === "rare/mythic") {
          // Handle rare/mythic with proper weighting
          const rareQuery = `${query} rarity:rare`;
          const mythicQuery = `${query} rarity:mythic`;

          const [rares, mythics] = await Promise.all([
            searchCards(rareQuery, { unique: "cards" }),
            searchCards(mythicQuery, { unique: "cards" }),
          ]);

          // Weight rares 2:1 over mythics
          const weightedCards = [
            ...rares.map((card): [ScryfallCard, number] => [card, 2]),
            ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
          ];

          const selectedCard = weightedChoice(weightedCards);
          if (selectedCard) {
            packCards.push({ name: selectedCard.name, count: 1 });
          }
        } else {
          query += ` rarity:${slot.rarity}`;
          const cards = await searchCards(query, { unique: "cards" });
          const selectedCard = choice(cards);
          if (selectedCard) {
            packCards.push({ name: selectedCard.name, count: 1 });
          }
        }
      } else {
        // No rarity specified, search all rarities
        const cards = await searchCards(query, { unique: "cards" });
        const selectedCard = choice(cards);
        if (selectedCard) {
          packCards.push({ name: selectedCard.name, count: 1 });
        }
      }
    } catch (error) {
      console.error(`Error generating card for slot:`, slot, error);
      // Add a fallback card if generation fails
      packCards.push({ name: "Unknown Card", count: 1 });
    }
  }

  return packCards;
}

// Format pack cards for display
function formatPackCards(cards: SealedDeckEntry[]): string {
  return cards
    .slice(0, 5) // Show first 5 cards
    .map((card) => `• ${card.name}`)
    .join("\n") +
    (cards.length > 5 ? `\n... and ${cards.length - 5} more` : "");
}

// Booster slot definition
export interface BoosterSlot {
  rarity?: "rare/mythic" | "uncommon" | "common";
  scryfall?: string;
}

// Pack choice tracking
interface PackChoice {
  heroPack: SealedDeckEntry[];
  villainPack: SealedDeckEntry[];
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

// booster slots for citizens - hero pack
export function getCitizenHeroBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(-t:hero t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena -s:spm -s:om1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u",
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        'game:arena legal:standard r:c (o:"+1/+1" o:"put" -o:renew -o:exhaust)',
    },
    {
      rarity: "common",
      scryfall:
        '(o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer',
    },
    {
      rarity: "common",
      scryfall:
        'o:"when this creature enters" game:arena r:c t:creature legal:standard',
    },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
  ];
}

// booster slots for citizens - villain pack
export function getCitizenVillainBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(t:hero -t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena legal:standard r:u (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw)",
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        "legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet",
    },
    {
      rarity: "common",
      scryfall:
        "legal:pioneer game:arena r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth)",
    },
    {
      rarity: "common",
      scryfall:
        'game:arena legal:standard r:c (o:"commit a crime" OR o:"target spell" OR otag:removal)',
    },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
  ];
}

// SPM Starting Pool Generation

const SPM_BASE_POOL_SEARCH = "set:om1";

/**
 * Rolls a starting SPM pool for a new player
 * @returns The starting pool cards
 */
export async function rollStartingPool(): Promise<ScryfallCard[]> {
  const pool: ScryfallCard[] = [];

  try {
    // Get all SPM cards by rarity
    const [rares, mythics, uncommons, commons] = await Promise.all([
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:rare`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:mythic`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:uncommon`, {
        unique: "cards",
      }),
      searchCards(`${SPM_BASE_POOL_SEARCH} rarity:common`, {
        unique: "cards",
      }),
    ]);

    // Pre-calculate weight mappings for rare/mythic (rares appear twice as often as mythics)
    const rareMythicWeights: [ScryfallCard, number][] = [
      ...rares.map((card): [ScryfallCard, number] => [card, 2]),
      ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
    ];

    // Roll 6 rare/mythic
    for (let i = 0; i < 6; i++) {
      const randomCard = weightedChoice(rareMythicWeights);
      if (randomCard) pool.push(randomCard);
    }

    // Roll 20 uncommons in 5 batches of 4 with no duplicates per batch
    for (let batch = 0; batch < 5; batch++) {
      const batchUncommons: ScryfallCard[] = [];
      const usedInBatch = new Set<string>();

      for (let i = 0; i < 4; i++) {
        let randomCard: ScryfallCard | undefined;
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops

        do {
          randomCard = choice(uncommons);
          attempts++;
        } while (
          randomCard && usedInBatch.has(randomCard.name) &&
          attempts < maxAttempts
        );

        if (randomCard) {
          batchUncommons.push(randomCard);
          usedInBatch.add(randomCard.name);
        }
      }

      pool.push(...batchUncommons);
    }

    // Roll 50 commons with deduplication logic and color requirements
    // Roll 5 batches of 10, no replacement within a batch, yes replacement between batches
    // Each batch must have at least 1 of each color (W, U, B, R, G)
    for (let batch = 0; batch < 5; batch++) {
      const batchCommons: ScryfallCard[] = [];
      const usedInBatch = new Set<string>();
      const colorsInBatch = new Set<string>();

      for (let i = 0; i < 10; i++) {
        let randomCard: ScryfallCard | undefined;
        let attempts = 0;
        const maxAttempts = 100; // Prevent infinite loops

        do {
          randomCard = choice(commons);
          attempts++;
        } while (
          randomCard && usedInBatch.has(randomCard.name) &&
          attempts < maxAttempts
        );

        if (randomCard) {
          batchCommons.push(randomCard);
          usedInBatch.add(randomCard.name);
          for (const color of randomCard.colors || []) {
            colorsInBatch.add(color);
          }
        }
      }

      if (colorsInBatch.size < 5) {
        // If we're missing a color, abandon the batch
        batch--;
        continue;
      }

      pool.push(...batchCommons);
    }

    // Add one spider card from the special query
    try {
      const spiderCards = await searchCards(
        "in:arena in:paper -s:spm -s:om1 t:spider r<r",
        {
          unique: "cards",
        },
      );
      const spiderCard = choice(spiderCards);
      if (spiderCard) {
        pool.push(spiderCard);
      }
    } catch (error) {
      console.error("Error fetching spider card:", error);
      // Continue without spider card if it fails
    }

    return pool;
  } catch (error) {
    console.error("Error rolling initial SPM pool:", error);
    return [];
  }
}

/**
 * Gets the most common WUBRG color in a pool of cards
 * @param pool - Array of ScryfallCard objects
 * @returns Hex color code for the most common color
 */
export function getPoolAccentColor(pool: ScryfallCard[]): number {
  const colorCounts: Record<string, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  // Count colors in the pool
  for (const card of pool) {
    if (card.colors) {
      for (const color of card.colors) {
        if (color in colorCounts) {
          colorCounts[color]++;
        }
      }
    }
  }

  // Find the most common color, or 'M' if there are multiples
  const mostCommonColor = Object.entries(colorCounts)
    .reduce((a, b) =>
      colorCounts[a[0]] > colorCounts[b[0]]
        ? a
        : colorCounts[a[0]] < colorCounts[b[0]]
        ? b
        : ["M", a[1]]
    )[0];

  // Return hex colors for each WUBRG color
  const colorHex: Record<string, number> = {
    W: 0xFFF9E3, // Brighter white/yellow
    U: 0x0E68AB, // Blue
    B: 0x7C3AED, // Lighter purple for black
    R: 0xD3202A, // Red
    G: 0x00733E, // Green
  };

  return colorHex[mostCommonColor] || 0xE87800; // Default orange if no color is most common
}

/**
 * Generates and posts a starting SPM pool for a user
 * @param user - Discord User object
 * @param channel - Discord TextChannel to post in
 */
export async function generateAndPostStartingPool(
  user: djs.User | djs.GuildMember,
  channel: djs.TextChannel,
  replyTo?: djs.Message,
): Promise<void> {
  try {
    console.log(`Generating starting SPM pool for user ${user.id}...`);

    // Show typing indicator
    await channel.sendTyping();

    // Roll the starting pool
    const pool = await rollStartingPool();

    // Create pool content text
    const poolContent = pool
      .map((card) =>
        `${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`
      )
      .join("\n");

    // Create attachment for pool list
    const poolBuffer = Buffer.from(poolContent, "utf-8");
    const poolAttachment = new djs.AttachmentBuilder(poolBuffer, {
      name: "pool.txt",
      description: "Complete SPM starting pool card list",
    });

    // Try to get a guild display name if there is one
    if (!(user instanceof djs.GuildMember)) {
      user = await channel.guild.members.fetch(user.id).catch(() => user);
    }

    // Post initial message with placeholder content
    const initialEmbed = new djs.EmbedBuilder()
      .setTitle(
        `🕷️ SPM Starting Pool - ${user.displayName}`,
      )
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: "⏳ Generating...",
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: "⏳ Generating...",
          inline: true,
        },
        {
          name: "📊 Total Cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    const message =
      await (replyTo?.reply.bind(replyTo) ?? channel.send.bind(channel))({
        embeds: [initialEmbed],
        files: [poolAttachment],
      });


    // Generate SealedDeck and rare+spider card image in background (concurrent)
    console.log("Creating SealedDeck.tech pool and rare+spider card image...");
    // Find rare/mythic cards and the extra spider card (last card in pool)
    const rareMythicCards = pool.filter(
      (card) => card.rarity === "rare" || card.rarity === "mythic"
    );
    let spiderCard: ScryfallCard | undefined = undefined;
    if (pool.length > 0) {
      const lastCard = pool[pool.length - 1];
      // Heuristic: the spider card is the last card and not from OM1
      spiderCard = lastCard;
    }
    const rareImageCards = spiderCard ? [...rareMythicCards, spiderCard] : rareMythicCards;
    const [sealedDeckResult, rareImageResult] = await Promise.allSettled([
      makeSealedDeck({
        sideboard: pool.map((card) => ({
          name: card.name,
          count: 1,
          set: card.set,
        })),
      }),
      tileCardImages(rareImageCards, "small"),
    ]);

    // Handle SealedDeck result
    let poolId: string;
    let sealedDeckLink: string;
    if (sealedDeckResult.status === "fulfilled") {
      poolId = sealedDeckResult.value;
      sealedDeckLink = `https://sealeddeck.tech/${poolId}`;
    } else {
      console.error("SealedDeck generation failed:", sealedDeckResult.reason);
      poolId = "Error";
      sealedDeckLink = "Failed to generate";
    }

    // Handle rare image result
    let rareImageAttachment: djs.AttachmentBuilder | undefined;
    if (rareImageResult.status === "fulfilled") {
      const rareImageBuffer = Buffer.from(
        await rareImageResult.value.arrayBuffer(),
      );
      rareImageAttachment = new djs.AttachmentBuilder(rareImageBuffer, {
        name: "rares.png",
        description: "Rare and mythic cards from starting pool",
      });
    } else {
      console.error("Rare image generation failed:", rareImageResult.reason);
    }

    // Update message with final content
    const finalEmbed = new djs.EmbedBuilder()
      .setTitle(
        `🕷️ SPM Starting Pool - ${user.displayName}`,
      )
      .setColor(getPoolAccentColor(pool))
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields([
        {
          name: "🔗 SealedDeck Link",
          value: sealedDeckLink,
          inline: false,
        },
        {
          name: "🆔 SealedDeck ID",
          value: `\`${poolId}\``,
          inline: true,
        },
        {
          name: "📊 Total Cards",
          value: pool.length.toString(),
          inline: true,
        },
      ])
      .setTimestamp();

    // Only set image if we have the attachment
    if (rareImageAttachment) {
      finalEmbed.setImage("attachment://rares.png");
    }

    const finalFiles = rareImageAttachment
      ? [poolAttachment, rareImageAttachment]
      : [poolAttachment];

    try {
      await message.edit({
        embeds: [finalEmbed],
        files: finalFiles,
      });
    } catch (editError) {
      console.error("Failed to edit starting pool message:", editError);
      // Swallow error, do not throw
    }

    console.log(`Successfully posted starting pool for user ${user.id}`);

    // Add pool change record if player found in database, but only if in the starting pool channel
    try {
      if (channel.id === CONFIG.STARTING_POOL_CHANNEL_ID) {
        const players = await getPlayers();
        const player = players.rows.find((p) => p.id === user.id);
        if (player && poolId !== "Error") {
          await addPoolChange(
            player.name,
            "starting pool",
            poolId,
            "SPM starting pool",
            poolId,
          );
          console.log(
            `Added starting pool record for ${player.name} (${poolId})`,
          );
        }
      }
    } catch (error) {
      console.error("Error adding pool change record:", error);
      // Don't throw - this shouldn't break the user experience
    }
  } catch (error) {
    console.error("Error generating and posting starting pool:", error);
    throw error;
  }
}
