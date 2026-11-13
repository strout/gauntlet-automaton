import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { type ScryfallCard, tileRareImages } from "../../scryfall.ts";
import { makeSealedDeck, type SealedDeckEntry } from "../../sealeddeck.ts";
import { trkSheet } from "./constants.ts";
import { rollTrkStartingPool } from "./cards.ts";

const POOL_COMMAND_CHANNELS = new Set([
  CONFIG.STARTING_POOL_CHANNEL_ID,
  CONFIG.BOT_BUNKER_CHANNEL_ID,
]);

function resolveDiscordId(input: string): string | null {
  const mention = input.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}

async function isLeagueCommittee(
  client: djs.Client,
  userId: string,
): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    return member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID);
  } catch {
    return false;
  }
}

function sealedEntries(cards: readonly ScryfallCard[]): SealedDeckEntry[] {
  const entries = new Map<string, SealedDeckEntry>();
  for (const card of cards) {
    const key = `${card.name}|${card.set}`;
    const existing = entries.get(key);
    entries.set(key, {
      name: card.name,
      set: card.set,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return [...entries.values()];
}

async function rareImage(
  cards: readonly ScryfallCard[],
): Promise<djs.AttachmentBuilder | undefined> {
  try {
    const blob = await tileRareImages(cards, "small");
    return new djs.AttachmentBuilder(Buffer.from(await blob.arrayBuffer()), {
      name: "rares.png",
      description: "Rare and mythic cards from starting pool",
    });
  } catch (err) {
    console.error("[trk] Failed to build rares.png:", err);
    return undefined;
  }
}

async function poolMessage(
  pool: readonly ScryfallCard[],
  poolId: string,
  title: string,
  content: string,
  member?: djs.GuildMember,
): Promise<djs.MessageCreateOptions> {
  const list = pool.map((card) =>
    `${card.name} (${card.set.toUpperCase()}) ${card.collector_number}`
  ).join("\n");
  const files: djs.AttachmentBuilder[] = [
    new djs.AttachmentBuilder(Buffer.from(list, "utf8"), {
      name: "pool.txt",
      description: "Trek starting pool card list",
    }),
  ];
  const rares = await rareImage(pool);
  if (rares) files.push(rares);
  const embed = new djs.EmbedBuilder()
    .setTitle(title)
    .setDescription(`${pool.length} cards`)
    .addFields(
      {
        name: "Pool",
        value: `[Pool contents](https://sealeddeck.tech/${poolId})`,
      },
      { name: "SealedDeck ID", value: `\`${poolId}\``, inline: true },
    );
  if (member) embed.setThumbnail(member.displayAvatarURL({ size: 256 }));
  if (rares) embed.setImage("attachment://rares.png");
  return { content, embeds: [embed], files };
}

/**
 * `!trekpool @player` — LC only. Rolls an 84-card Trek starting pool, posts
 * it in #starting-pools, and records it on Pool Changes.
 */
export const trekPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!trekpool") return;
  handle.claim();

  if (!message.inGuild() || !message.channel.isTextBased()) {
    await message.reply("Use this command in a server channel.");
    return;
  }
  if (!POOL_COMMAND_CHANNELS.has(message.channelId)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply("Only League Committee members can run `!trekpool`.");
    return;
  }

  const discordId = parts[1] ? resolveDiscordId(parts[1]) : null;
  if (!discordId) {
    await message.reply("Usage: `!trekpool @Player`.");
    return;
  }

  const sheet = trkSheet();
  const players = await sheet.getPlayers().catch((err) => {
    console.error("[trk] !trekpool failed to read players:", err);
    return undefined;
  });
  if (!players) {
    await message.reply("Couldn't read the Trek Player Database. Check logs.");
    return;
  }
  const player = players.rows.find((row) =>
    `${row["Discord ID"] ?? ""}`.trim() === discordId
  );
  if (!player) {
    await message.reply(
      `<@${discordId}> is not on the Trek Player Database.`,
    );
    return;
  }

  const poolChanges = await sheet.getPoolChanges();
  if (
    poolChanges.rows.some((row) =>
      row.Name === player.Identification && row.Type === "starting pool"
    )
  ) {
    await message.reply(
      `<@${discordId}> already has a starting pool on file.`,
    );
    return;
  }

  await message.reply(`Rolling Trek starting pool for <@${discordId}>…`);

  let pool: ScryfallCard[];
  let poolId: string;
  try {
    pool = await rollTrkStartingPool();
    poolId = await makeSealedDeck({ sideboard: sealedEntries(pool) });
    await sheet.addPoolChange(
      player.Identification,
      "starting pool",
      poolId,
      "TRK starting pool",
      poolId,
    );
  } catch (err) {
    console.error("[trk] !trekpool failed:", err);
    await message.channel.send(
      `Failed to roll a starting pool for <@${discordId}>. Check logs.`,
    );
    return;
  }

  const poolLink = `https://sealeddeck.tech/${poolId}`;
  try {
    const member = await message.guild.members.fetch(discordId).catch(() =>
      undefined
    );
    const payload = await poolMessage(
      pool,
      poolId,
      `Trek starting pool — ${member?.displayName ?? player.Identification}`,
      `Starting pool for <@${discordId}>`,
      member,
    );
    const startingPools = message.channelId === CONFIG.STARTING_POOL_CHANNEL_ID
      ? message.channel
      : await message.client.channels.fetch(CONFIG.STARTING_POOL_CHANNEL_ID);
    if (!startingPools?.isTextBased() || startingPools.isDMBased()) {
      throw new Error("Could not find the starting pools channel");
    }
    await startingPools.send(payload);
    await message.channel.send(
      `Starting pool recorded for **${player.Identification}**: ${poolLink}`,
    );
  } catch (err) {
    console.error("[trk] !trekpool post failed:", err);
    await message.channel.send(
      `Starting pool for **${player.Identification}** is recorded (${poolLink}) but the Discord post failed.`,
    );
  }
};

/**
 * `!trektest` — LC only, bot bunker only. Rolls a Trek pool and posts it in
 * the bunker. Nothing is written to Pool Changes or #starting-pools.
 */
export const trekTestPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const command = message.content.trim().split(/\s+/)[0]?.toLowerCase();
  if (command !== "!trektest") return;
  handle.claim();

  if (!message.inGuild() || !message.channel.isTextBased()) {
    await message.reply("Use this command in a server channel.");
    return;
  }
  if (message.channelId !== CONFIG.BOT_BUNKER_CHANNEL_ID) {
    await message.reply("Use `!trektest` in the bot bunker.");
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply("Only League Committee members can run `!trektest`.");
    return;
  }

  await message.reply("Rolling a test Trek pool…");
  try {
    const pool = await rollTrkStartingPool();
    const poolId = await makeSealedDeck({ sideboard: sealedEntries(pool) });
    await message.channel.send(
      await poolMessage(
        pool,
        poolId,
        "Trek test pool",
        "Test pool. Not recorded.",
      ),
    );
  } catch (err) {
    console.error("[trk] !trektest failed:", err);
    await message.channel.send("Failed to roll a test Trek pool. Check logs.");
  }
};
