import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { NXT_STARTING_POOL_CMD, nxtSheet } from "./constants.ts";

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

/**
 * `!nxtpool <@user|discordId>` — LC only. Rolls the NXT starting pool mix
 * via Booster Tutor and records it on Pool Changes.
 */
export const nxtPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!nxtpool") return;
  handle.claim();

  if (!message.inGuild()) {
    await message.reply("Use this command in a server channel.");
    return;
  }

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  if (!POOL_COMMAND_CHANNELS.has(message.channel.id)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }

  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply(
      "Only League Committee members can run `!nxtpool`.",
    );
    return;
  }

  if (parts.length < 2) {
    await message.reply(
      "Usage: `!nxtpool @Player` or `!nxtpool <discordId>`.",
    );
    return;
  }

  const targetDiscordId = resolveDiscordId(parts[1]);
  if (!targetDiscordId) {
    await message.reply(
      "Usage: `!nxtpool @Player` or `!nxtpool <discordId>`.",
    );
    return;
  }

  const sheet = nxtSheet();
  const players = await sheet.getPlayers();
  const player = players.rows.find((p) => p["Discord ID"] === targetDiscordId);
  if (!player) {
    await message.reply(
      `No player with Discord ID \`${targetDiscordId}\` found on the Players sheet.`,
    );
    return;
  }

  const poolChanges = await sheet.getPoolChanges();
  if (
    poolChanges.rows.some((c) =>
      c.Name === player.Identification && c.Type === "starting pool"
    )
  ) {
    await message.reply(
      `<@${targetDiscordId}> already has a starting pool on file.`,
    );
    return;
  }

  const startingPoolChannel = await message.client.channels.fetch(
    CONFIG.STARTING_POOL_CHANNEL_ID,
  ) as djs.TextChannel;
  if (!startingPoolChannel) {
    await message.reply("Starting pools channel not found.");
    return;
  }

  await message.reply(
    `Rolling NXT starting pool for <@${targetDiscordId}>…`,
  );

  try {
    const sentMessage = await startingPoolChannel.send(
      `${NXT_STARTING_POOL_CMD} <@${targetDiscordId}>`,
    );

    const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
    if ("error" in result) {
      throw new Error(result.error);
    }

    const poolId = result.success.poolId;
    await sheet.addPoolChange(
      player.Identification,
      "starting pool",
      poolId,
      sentMessage.url,
      poolId,
    );

    const poolLink = `https://sealeddeck.tech/${poolId}`;
    await message.channel.send(
      `Starting pool recorded for **${player.Identification}**: ${poolLink}`,
    );
  } catch (e) {
    console.error("[nxt-2026] !nxtpool roll failed:", e);
    await message.channel.send(
      `Failed to roll starting pool for <@${targetDiscordId}>. Check starting pools for errors.`,
    );
  }
};
