import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { Handler } from "../../dispatch.ts";
import { CONFIG } from "../../config.ts";
import { readStringPool } from "../../fix-pool.ts";
import { waitForBoosterTutor, withPending } from "../../pending.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "../../sealeddeck.ts";
import { addPoolChanges, getPlayers, getPoolChanges } from "../../standings.ts";
import { ROWNUM } from "../../standings.ts";
import {
  appendToPoolPending,
  getMutagenTokens,
  getPoolPendingRows,
  markPoolPendingDMedForPacks,
} from "./standings-tmt.ts";
import {
  recordMatchPackNoMutation,
  sendMatchPackMutateDM,
  sendPackDMs,
} from "./pool-dm.ts";
import { buildNameToCardMap } from "./tmt.ts";
import { ScryfallCard, tileRareImages } from "../../scryfall.ts";

const LINES_PER_PACK = 14;
const PACKS_PER_POOL = 6;

/**
 * Splits a Booster Tutor txt file (all packs concatenated) into individual packs.
 * Packs are separated by blank lines; each pack has exactly LINES_PER_PACK card lines.
 * Returns up to PACKS_PER_POOL non-empty groups.
 */
function splitIntoPacks(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  const packs: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (current.length > 0) {
        packs.push(current);
        current = [];
      }
    } else {
      current.push(trimmed);
    }
  }
  if (current.length > 0) {
    packs.push(current);
  }

  // Fallback: if there are no blank-line separators, split by LINES_PER_PACK
  if (
    packs.length <= 1 && lines.filter((l) => l.trim()).length > LINES_PER_PACK
  ) {
    const nonEmpty = lines.filter((l) => l.trim());
    const bySize: string[][] = [];
    for (let i = 0; i < nonEmpty.length; i += LINES_PER_PACK) {
      bySize.push(nonEmpty.slice(i, i + LINES_PER_PACK));
    }
    return bySize.slice(0, PACKS_PER_POOL);
  }

  return packs.slice(0, PACKS_PER_POOL);
}

/**
 * Generates a starting pool for a player by:
 * 1. Sending `!set <setCode> <numPacks>` to the starting-pools channel
 * 2. Waiting for Booster Tutor to reply with a txt file
 * 3. Splitting the txt into packs and writing each to the Pool Pending sheet
 * 4. Sending DMs with pack summaries (images + links) and a dropdown + Mutate button
 *
 * @param playerName - Player's Identification (from the spreadsheet)
 * @param discordId - Player's Discord user ID (for DMs)
 * @param setCode - The set code to pass to Booster Tutor (e.g. "TMT")
 * @param numPacks - Number of packs (default 6)
 * @param poolChangesChannel - The channel to post Pool Changes links to
 * @param startingPoolChannel - The channel to send the !set command to
 * @param client - Discord client
 * @param pretend - If true, only log what would happen
 */
export async function generateStartingPool(
  playerName: string,
  discordId: string,
  setCode: string,
  numPacks: number = PACKS_PER_POOL,
  poolChangesChannel: djs.TextChannel,
  startingPoolChannel: djs.TextChannel,
  client: djs.Client,
  pretend: boolean,
): Promise<void> {
  console.log(
    `[pool-gen] Generating ${numPacks}-pack pool for ${playerName} (${setCode})`,
  );

  if (pretend) {
    console.log(
      `[PRETEND] Would send !set ${setCode} ${numPacks} to #${startingPoolChannel.name} and process response`,
    );
    return;
  }

  // Send the command to the starting-pools channel
  const sentMessage = await startingPoolChannel.send(
    `!set ${setCode} ${numPacks}`,
  );

  // Wait for Booster Tutor to reply with a txt attachment (up to 60 seconds)
  const btMessage = await waitForBoosterTutorFile(sentMessage, client, 60_000);
  if (!btMessage) {
    await poolChangesChannel.send(
      `❌ Timed out waiting for Booster Tutor response for **${playerName}** (${setCode}).`,
    );
    return;
  }

  // Download the txt file
  const attachment = btMessage.attachments.find((a) =>
    a.name?.endsWith(".txt") || a.contentType?.includes("text")
  );
  if (!attachment) {
    await poolChangesChannel.send(
      `❌ Booster Tutor responded but no txt file found for **${playerName}**.`,
    );
    return;
  }

  const resp = await fetch(attachment.url);
  if (!resp.ok) {
    await poolChangesChannel.send(
      `❌ Could not download pool file for **${playerName}**: HTTP ${resp.status}`,
    );
    return;
  }
  const text = await resp.text();

  // Split into individual packs
  const packLines = splitIntoPacks(text);
  if (packLines.length === 0) {
    await poolChangesChannel.send(
      `❌ Could not parse any packs from the Booster Tutor file for **${playerName}**.`,
    );
    return;
  }

  console.log(`[pool-gen] Found ${packLines.length} packs for ${playerName}`);

  const packs: { poolId: string; packEntries: SealedDeckEntry[] }[] = [];

  // Process each pack: create sealeddeck link, write to Pool Pending
  for (let i = 0; i < packLines.length; i++) {
    const packText = packLines[i].join("\n");
    let packData: ReturnType<typeof readStringPool>;
    try {
      packData = readStringPool(packText);
    } catch (e) {
      console.error(
        `[pool-gen] Could not parse pack ${i + 1} for ${playerName}:`,
        e,
      );
      await poolChangesChannel.send(
        `⚠️ Could not parse pack ${i + 1} for **${playerName}** — skipping.`,
      );
      continue;
    }

    const packEntries: SealedDeckEntry[] = (packData.sideboard ?? []).map((
      e,
    ) => ({
      name: e.name,
      count: e.count,
      set: e.set,
    }));

    // Create a sealeddeck link for just this pack
    const packPoolId = await makeSealedDeck({ sideboard: packEntries });
    const packLink = `https://sealeddeck.tech/${packPoolId}`;

    // Write to Pool Pending sheet: Timestamp, Name, Type, Value (Value = sealeddeck.tech pool ID)
    const timestamp = new Date().toISOString();
    const type = "starting pool";
    await appendToPoolPending([[timestamp, playerName, type, packPoolId]]);

    packs.push({ poolId: packPoolId, packEntries });

    console.log(
      `[pool-gen] Pack ${
        i + 1
      }/${packLines.length} for ${playerName}: ${packLink}`,
    );
  }

  if (packs.length > 0) {
    try {
      // Mark DMed before sending so the minute listener doesn't double-send
      await markPoolPendingDMedForPacks(
        playerName,
        packs.map((p) => p.poolId),
      );
      await sendPackDMs(client, discordId, playerName, packs);
    } catch (e) {
      console.error("[pool-gen] Error sending pack DMs:", e);
      await poolChangesChannel.send(
        `⚠️ Packs written to Pool Pending, but DMs could not be sent to <@${discordId}>. They may need to open DMs.`,
      );
    }
  }
}

/**
 * Waits for Packgen bot to reply to a specific message with a txt file attachment.
 * Returns the reply message, or null if it times out.
 */
export function waitForPackgenFile(
  sentMessage: djs.Message,
  client: djs.Client,
  timeoutMs: number,
): Promise<djs.Message | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off(djs.Events.MessageCreate, handler);
      client.off(djs.Events.MessageUpdate, updateHandler);
      resolve(null);
    }, timeoutMs);

    const checkMessage = (msg: djs.Message) => {
      if (
        msg.author.id !== CONFIG.PACKGEN_USER_ID ||
        msg.reference?.messageId !== sentMessage.id
      ) {
        return;
      }
      const hasFile = msg.attachments.some(
        (a) => a.name?.endsWith(".txt") || a.contentType?.includes("text"),
      );
      if (hasFile) {
        clearTimeout(timer);
        client.off(djs.Events.MessageCreate, handler);
        client.off(djs.Events.MessageUpdate, updateHandler);
        resolve(msg);
      }
    };

    const handler = (msg: djs.Message) => checkMessage(msg);
    const updateHandler = async (
      _old: djs.Message | djs.PartialMessage,
      newMsg: djs.Message | djs.PartialMessage,
    ) => {
      try {
        checkMessage(await newMsg.fetch());
      } catch {
        // ignore fetch errors
      }
    };

    client.on(djs.Events.MessageCreate, handler);
    client.on(djs.Events.MessageUpdate, updateHandler);
  });
}

/**
 * Waits for Booster Tutor to reply with a txt file attachment.
 * Accepts either a proper reply (msg.reference) or any BT message in the same channel
 * after our message (some bots don't set reply references).
 */
function waitForBoosterTutorFile(
  sentMessage: djs.Message,
  client: djs.Client,
  timeoutMs: number,
): Promise<djs.Message | null> {
  const sentTimestamp = sentMessage.createdTimestamp;
  const channelId = sentMessage.channelId;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.off(djs.Events.MessageCreate, handler);
      client.off(djs.Events.MessageUpdate, updateHandler);
      resolve(null);
    }, timeoutMs);

    const checkMessage = (msg: djs.Message) => {
      if (msg.author.id !== CONFIG.BOOSTER_TUTOR_USER_ID) return;
      if (msg.channelId !== channelId) return;
      // Must be a reply to our message, or posted after our message (fallback if BT doesn't use reply)
      const isReply = msg.reference?.messageId === sentMessage.id;
      const isAfter = msg.createdTimestamp >= sentTimestamp;
      if (!isReply && !isAfter) return;

      const hasFile = msg.attachments.some(
        (a) => a.name?.endsWith(".txt") || a.contentType?.includes("text"),
      );
      if (hasFile) {
        clearTimeout(timer);
        client.off(djs.Events.MessageCreate, handler);
        client.off(djs.Events.MessageUpdate, updateHandler);
        resolve(msg);
      }
    };

    const handler = (msg: djs.Message) => checkMessage(msg);
    const updateHandler = async (
      _old: djs.Message | djs.PartialMessage,
      newMsg: djs.Message | djs.PartialMessage,
    ) => {
      try {
        checkMessage(await newMsg.fetch());
      } catch {
        // ignore fetch errors
      }
    };

    client.on(djs.Events.MessageCreate, handler);
    client.on(djs.Events.MessageUpdate, updateHandler);
  });
}

/**
 * Processes a match reward pack: posts !TMT @user to bot-bunker, waits for
 * Booster Tutor response, adds to Pool Pending, and DMs the player with YES/NO
 * to mutate. Once the player has chosen, the final pack is posted to
 * pack-generation.
 * Call this when a match is processed.
 */
export async function processMatchPack(
  client: djs.Client<true>,
  discordId: string,
  playerName: string,
): Promise<{ ok: boolean; error?: string }> {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const botBunkerChannel = await guild.channels.fetch(
    CONFIG.BOT_BUNKER_CHANNEL_ID,
  ) as djs.TextChannel | null;

  if (!botBunkerChannel?.isSendable()) {
    return { ok: false, error: "Bot bunker channel not available." };
  }

  const result = await waitForBoosterTutor(
    botBunkerChannel.send(`!TMT <@${discordId}>`),
  );

  if ("error" in result) {
    return {
      ok: false,
      error: `Booster Tutor error for **${playerName}**: ${result.error}`,
    };
  }

  const pack = result.success;
  const packPoolId = pack.poolId;
  const packEntries: SealedDeckEntry[] = [
    ...pack.sideboard,
    ...(pack.deck ?? []),
    ...(pack.hidden ?? []),
  ];

  const timestamp = new Date().toISOString();
  await appendToPoolPending([[timestamp, playerName, "add pack", packPoolId]]);

  const tokens = await getMutagenTokens(playerName);
  if (tokens <= 0) {
    const pendingRows = await getPoolPendingRows(playerName);
    const row = pendingRows.find((r) => r.Value === packPoolId);
    if (row) {
      await recordMatchPackNoMutation(
        client,
        playerName,
        discordId,
        packPoolId,
        row[ROWNUM],
      );
      console.log(
        `[match-pack] No mutagen tokens for ${playerName}, recorded pack as-is`,
      );
    }
    return { ok: true };
  }

  try {
    await sendMatchPackMutateDM(client, discordId, playerName, {
      poolId: packPoolId,
      packEntries,
    });
    console.log(`[match-pack] Sent match pack DM to ${playerName}`);
  } catch (e) {
    console.error("[match-pack] Error sending match pack DM:", e);
    return {
      ok: false,
      error:
        `Pack written to Pool Pending, but could not DM <@${discordId}>. Check DMs are open.`,
    };
  }

  return { ok: true };
}

/**
 * Resolves a Discord mention or raw ID string to a numeric Discord user ID.
 * Accepts: <@123456>, <@!123456>, or a bare numeric string.
 * Returns null if the input doesn't match any of those forms.
 */
function resolveDiscordId(input: string): string | null {
  const mentionMatch = input.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

/**
 * Handler for the !matchpack command.
 * Usage: !matchpack @Player
 * Posts !TMT @user to packgen, gets pack, adds to Pool Pending, DMs with YES/NO to mutate.
 * Call when a match is processed.
 */
export const matchpackHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (!message.content.startsWith("!matchpack")) return;

  handle.claim();

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  if (parts.length < 2) {
    await message.reply("Usage: `!matchpack @Player`");
    return;
  }

  const discordId = resolveDiscordId(parts[1]);
  if (!discordId) {
    await message.reply(
      "❌ First argument must be a Discord mention (e.g. `@Player`).",
    );
    return;
  }

  const players = await getPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    await message.reply(
      `❌ No player with Discord ID \`${discordId}\` found in the Player Database.`,
    );
    return;
  }

  const playerName = player.Identification;

  if (!message.client.readyAt) {
    await message.reply("Bot is not ready yet.");
    return;
  }

  await message.reply(
    `Processing match pack for **${playerName}**… Rolling in bot-bunker.`,
  );

  const result = await processMatchPack(
    message.client as djs.Client<true>,
    discordId,
    playerName,
  );

  if (result.ok) {
    await message.channel.send(
      `✅ Match pack for **${playerName}** added to Pool Pending. Check DMs for pack and mutate choice.`,
    );
  } else {
    await message.channel.send(`❌ ${result.error}`);
  }
};

/**
 * Handler for the !genpool command.
 * Usage: !genpool @DiscordTag <setCode> [numPacks]
 * Must be sent by a League Committee member.
 * Looks up the player in the Player Database by Discord ID, then sends !set to the
 * starting-pools channel, processes Booster Tutor's response, and writes each pack
 * to the Pool Pending sheet under the player's Identification name.
 */
export const genPoolHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!genpool")) return;
  handle.claim();

  // League Committee only
  if (!message.inGuild()) return;
  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) {
      await message.reply("Only League Committee can use this command.");
      return;
    }
  } catch {
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  // !genpool <@mention|discordId> <setCode> [numPacks]
  if (parts.length < 3) {
    await message.reply(
      "Usage: `!genpool @Player <setCode> [numPacks]`\nExample: `!genpool @Alice TMT 6`",
    );
    return;
  }

  const discordId = resolveDiscordId(parts[1]);
  if (!discordId) {
    await message.reply(
      "❌ First argument must be a Discord mention or numeric ID (e.g. `@Alice` or `189836410306560000`).",
    );
    return;
  }

  const setCode = parts[2].toUpperCase();
  const numPacks = parts[3] ? parseInt(parts[3], 10) : PACKS_PER_POOL;

  if (isNaN(numPacks) || numPacks < 1 || numPacks > 12) {
    await message.reply("numPacks must be between 1 and 12.");
    return;
  }

  // Look up the player in the spreadsheet by Discord ID
  const players = await getPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    await message.reply(
      `❌ No player with Discord ID \`${discordId}\` found in the Player Database.`,
    );
    return;
  }

  const playerName = player.Identification;

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
  const startingPoolChannel = await guild.channels.fetch(
    CONFIG.STARTING_POOL_CHANNEL_ID,
  ) as djs.TextChannel;

  if (!startingPoolChannel?.isTextBased()) {
    await message.reply("❌ Could not find the starting-pools channel.");
    return;
  }

  await message.reply(
    `⏳ Generating ${numPacks}-pack pool for **${playerName}** (<@${discordId}>) (${setCode})…`,
  );

  try {
    await generateStartingPool(
      playerName,
      discordId,
      setCode,
      numPacks,
      message.channel as djs.TextChannel,
      startingPoolChannel,
      message.client,
      false,
    );
  } catch (e) {
    console.error("[pool-gen] Error generating pool:", e);
    await message.reply(
      `❌ Error generating pool for **${playerName}**: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
};

const S2_POOL_CHANGES_SHEET = "S2 Pool Changes";

export const mutatepoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (!message.content.startsWith("!mutatepool")) return;
  handle.claim();

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  if (parts.length < 2) {
    await message.reply("Usage: `!mutatepool @Player`");
    return;
  }

  const discordId = resolveDiscordId(parts[1]);
  if (!discordId) {
    await message.reply(
      "❌ First argument must be a Discord mention (e.g. `@Player`).",
    );
    return;
  }

  const players = await getPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    await message.reply(
      `❌ No player with Discord ID \`${discordId}\` found in the Player Database.`,
    );
    return;
  }

  const playerName = player.Identification;

  await message.reply(
    `⏳ Mutating pool for **${playerName}** and generating Season 2 pool...`,
  );

  try {
    const allChanges = await getPoolChanges();
    const playerChanges = allChanges.rows.filter(
      (c) =>
        c.Name === playerName && c.Comment === "Remaining from Pool Pending",
    );

    if (playerChanges.length === 0) {
      await message.reply(
        `❌ No "Remaining from Pool Pending" entries found for **${playerName}**.`,
      );
      return;
    }

    const config = CONFIG as { TMT?: { MUTATION_CHANNEL_ID: string } };
    const mutationChannelId = config.TMT?.MUTATION_CHANNEL_ID;
    if (!mutationChannelId) {
      await message.reply("❌ Mutation channel not configured.");
      return;
    }

    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const mutationChannel = await guild.channels.fetch(
      mutationChannelId,
    ) as djs.TextChannel;

    if (!mutationChannel?.isSendable()) {
      await message.reply("❌ Mutation channel not available.");
      return;
    }

    const mutatedPoolIds: string[] = [];
    const originalPoolIds: string[] = [];
    const allMutatedCards: ScryfallCard[] = [];
    const nameToCard = buildNameToCardMap();

    for (const change of playerChanges) {
      const originalPoolId = change.Value;
      const link = `https://sealeddeck.tech/${originalPoolId}`;
      const sentMessage = await mutationChannel.send(link);

      const result = await withPending<string>((responseMessage, handle) => {
        if (responseMessage.reference?.messageId !== sentMessage.id) {
          return Promise.resolve(undefined);
        }
        const linkRegex = /https:\/\/sealeddeck\.tech\/([a-zA-Z0-9_-]+)/;
        const linkMatch = responseMessage.content?.match(linkRegex) ??
          responseMessage.embeds.find((e) => e.url)?.url?.match(linkRegex);
        if (linkMatch) {
          handle.claim();
          return Promise.resolve({ done: linkMatch[1] });
        }
        return Promise.resolve(undefined);
      });

      if (!result) {
        await message.reply(
          `❌ Timed out waiting for ooze to mutate pack ${originalPoolId}.`,
        );
        return;
      }

      const mutatedPoolId = result;
      mutatedPoolIds.push(mutatedPoolId);
      originalPoolIds.push(originalPoolId);

      const mutatedPool = await fetchSealedDeck(mutatedPoolId);
      for (const entry of mutatedPool.sideboard) {
        for (let i = 0; i < entry.count; i++) {
          const card = nameToCard.get(entry.name.toLowerCase());
          if (card) allMutatedCards.push(card);
        }
      }
    }

    const botBunkerChannel = await guild.channels.fetch(
      CONFIG.BOT_BUNKER_CHANNEL_ID,
    ) as djs.TextChannel;

    if (!botBunkerChannel?.isSendable()) {
      await message.reply("❌ Bot bunker channel not available.");
      return;
    }

    const sentMessage = await botBunkerChannel.send(`!TMT 2`);
    const btMessage = await waitForBoosterTutorFile(
      sentMessage,
      message.client,
      60_000,
    );

    if (!btMessage) {
      await message.reply("❌ Timed out waiting for Booster Tutor response.");
      return;
    }

    const txtAttachment = btMessage.attachments.find((a) =>
      a.name?.endsWith(".txt") || a.contentType?.includes("text")
    );
    if (!txtAttachment) {
      await message.reply(
        "❌ Booster Tutor responded but no txt file found.",
      );
      return;
    }

    const resp = await fetch(txtAttachment.url);
    if (!resp.ok) {
      await message.reply(
        `❌ Could not download pack file: HTTP ${resp.status}`,
      );
      return;
    }
    const text = await resp.text();
    const packLines = splitIntoPacks(text);

    if (packLines.length < 2) {
      await message.reply(
        `❌ Expected 2 packs from Booster Tutor but got ${packLines.length}.`,
      );
      return;
    }

    const newPackPoolIds: string[] = [];
    const newPackCards: ScryfallCard[] = [];

    for (const packLine of packLines) {
      const packText = packLine.join("\n");
      const packData = readStringPool(packText);
      const packEntries: SealedDeckEntry[] = (packData.sideboard ?? []).map((
        e,
      ) => ({
        name: e.name,
        count: e.count,
        set: e.set,
      }));

      const packPoolId = await makeSealedDeck({ sideboard: packEntries });
      newPackPoolIds.push(packPoolId);

      for (const entry of packEntries) {
        for (let i = 0; i < entry.count; i++) {
          const card = nameToCard.get(entry.name.toLowerCase());
          if (card) {
            newPackCards.push(card);
          }
        }
      }
    }

    const combinedCards = [
      ...allMutatedCards.map((c) => ({ name: c.name, count: 1 })),
      ...newPackCards.map((c) => ({ name: c.name, count: 1 })),
    ];

    const fullPoolId = await makeSealedDeck({ sideboard: combinedCards });

    const changes: [
      name: string,
      type: string,
      value: string,
      comment: string,
      newPoolId?: string,
    ][] = [];

    for (let i = 0; i < mutatedPoolIds.length; i++) {
      changes.push([
        playerName,
        "add pack",
        mutatedPoolIds[i],
        `Mutated from pool ${playerChanges[i].Value}`,
      ]);
    }

    for (const packId of newPackPoolIds) {
      changes.push([
        playerName,
        "add pack",
        packId,
        "New TMT pack",
      ]);
    }

    changes.push([
      playerName,
      "starting pool",
      fullPoolId,
      "Season 2 starting pool",
    ]);

    await addPoolChanges(changes, CONFIG.LIVE_SHEET_ID, S2_POOL_CHANGES_SHEET);

    const fullPoolUrl = `https://sealeddeck.tech/${fullPoolId}`;

    const allCardsForImage = [...allMutatedCards, ...newPackCards];
    const rareCards = allCardsForImage.filter((card) =>
      ["rare", "mythic", "special", "bonus"].includes(card.rarity.toLowerCase())
    );

    let attachment: djs.AttachmentBuilder | undefined;
    try {
      if (rareCards.length > 0) {
        const imageBlob = await tileRareImages(rareCards, "small");
        const arrayBuffer = await imageBlob.arrayBuffer();
        attachment = new djs.AttachmentBuilder(Buffer.from(arrayBuffer), {
          name: "pool-rares.png",
        });
      }
    } catch (err) {
      console.error("[mutatepool] Error generating tiled image:", err);
    }

    const embed = new djs.EmbedBuilder()
      .setTitle("Season 2 Starting Pool")
      .setURL(fullPoolUrl);

    if (attachment) {
      embed.setImage("attachment://pool-rares.png");
    }

    const replyOptions: djs.BaseMessageOptions = {
      content: `✅ Season 2 pool for **${playerName}**: ${fullPoolUrl}`,
      embeds: [embed],
    };
    if (attachment) {
      replyOptions.files = [attachment];
    }

    await message.reply(replyOptions);
  } catch (e) {
    console.error("[mutatepool] Error:", e);
    await message.reply(
      `❌ Error creating Season 2 pool for **${playerName}**: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
};
