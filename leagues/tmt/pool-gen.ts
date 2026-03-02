import * as djs from "discord.js";
import { Handler } from "../../dispatch.ts";
import { CONFIG } from "../../config.ts";
import { readStringPool } from "../../fix-pool.ts";
import { makeSealedDeck, SealedDeckEntry } from "../../sealeddeck.ts";
import { getPlayers } from "../../standings.ts";
import { sheets, sheetsAppend } from "../../sheets.ts";
import { sendPackDMs } from "./pool-dm.ts";

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
  if (packs.length <= 1 && lines.filter((l) => l.trim()).length > LINES_PER_PACK) {
    const nonEmpty = lines.filter((l) => l.trim());
    const bySize: string[][] = [];
    for (let i = 0; i < nonEmpty.length; i += LINES_PER_PACK) {
      bySize.push(nonEmpty.slice(i, i + LINES_PER_PACK));
    }
    return bySize.slice(0, PACKS_PER_POOL);
  }

  return packs.slice(0, PACKS_PER_POOL);
}

const POOL_PENDING_SHEET = "Pool Pending";

/**
 * Generates a starting pool for a player by:
 * 1. Sending `!set <setCode> <numPacks>` to the starting-pools channel
 * 2. Waiting for Booster Tutor to reply with a txt file
 * 3. Splitting the txt into packs and writing each to the Pool Pending sheet
 * 4. Sending DMs with pack summaries (images + links) and a dropdown + Mutate button
 *
 * @param playerName - Player's Identification (from the spreadsheet)
 * @param discordId - Player's Discord user ID (for DMs)
 * @param setCode - The set code to pass to Booster Tutor (e.g. "ECL")
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
  console.log(`[pool-gen] Generating ${numPacks}-pack pool for ${playerName} (${setCode})`);

  if (pretend) {
    console.log(
      `[PRETEND] Would send !set ${setCode} ${numPacks} to #${startingPoolChannel.name} and process response`,
    );
    return;
  }

  // Send the command to the starting-pools channel
  const sentMessage = await startingPoolChannel.send(`!set ${setCode} ${numPacks}`);

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
      console.error(`[pool-gen] Could not parse pack ${i + 1} for ${playerName}:`, e);
      await poolChangesChannel.send(
        `⚠️ Could not parse pack ${i + 1} for **${playerName}** — skipping.`,
      );
      continue;
    }

    const packEntries: SealedDeckEntry[] = (packData.sideboard ?? []).map((e) => ({
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
    await sheetsAppend(
      sheets,
      CONFIG.LIVE_SHEET_ID,
      `${POOL_PENDING_SHEET}!A:D`,
      [[timestamp, playerName, type, packPoolId]],
    );

    packs.push({ poolId: packPoolId, packEntries });

    console.log(
      `[pool-gen] Pack ${i + 1}/${packLines.length} for ${playerName}: ${packLink}`,
    );
  }

  if (packs.length > 0) {
    try {
      await sendPackDMs(client, discordId, playerName, packs);
    } catch (e) {
      console.error("[pool-gen] Error sending pack DMs:", e);
      await poolChangesChannel.send(
        `⚠️ Packs written to Pool Pending, but DMs could not be sent to <@${discordId}>. They may need to open DMs.`,
      );
    }
  }

  await poolChangesChannel.send(
    `✅ Generated ${packLines.length} pack(s) for **${playerName}** Check your DMs to see the packs and decide which ones to mutate.`,
  );
}

/**
 * Waits for Booster Tutor to reply to a specific message with a txt file attachment.
 * Returns the Booster Tutor message, or null if it times out.
 */
function waitForBoosterTutorFile(
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
        msg.author.id !== CONFIG.BOOSTER_TUTOR_USER_ID ||
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
    const updateHandler = async (_old: djs.Message | djs.PartialMessage, newMsg: djs.Message | djs.PartialMessage) => {
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
 * Handler for the !genpool command.
 * Usage: !genpool @DiscordTag <setCode> [numPacks]
 * Must be sent by a League Committee member or owner.
 * Looks up the player in the Player Database by Discord ID, then sends !set to the
 * starting-pools channel, processes Booster Tutor's response, and writes each pack
 * to the Pool Pending sheet under the player's Identification name.
 */
export const genPoolHandler: Handler<djs.Message> = async (message, handle) => {
  if (!message.content.startsWith("!genpool")) return;
  handle.claim();

  // Owner or league committee only
  const isOwner = message.author.id === CONFIG.OWNER_ID;
  let isCommittee = false;
  if (message.inGuild()) {
    try {
      const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(message.author.id);
      isCommittee = member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID);
    } catch {
      // ignore
    }
  }
  if (!isOwner && !isCommittee) return;

  const parts = message.content.trim().split(/\s+/);
  // !genpool <@mention|discordId> <setCode> [numPacks]
  if (parts.length < 3) {
    await message.reply(
      "Usage: `!genpool @Player <setCode> [numPacks]`\nExample: `!genpool @Alice ECL 6`",
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
      `❌ Error generating pool for **${playerName}**: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};
