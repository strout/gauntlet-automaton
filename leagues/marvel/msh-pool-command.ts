import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { upcomingSheet } from "../../standings.ts";
import {
  buildMshOriginMessage,
  findPendingMshPool,
  lookupPlayerByDiscordId,
  MSH_POOL_CMD,
  MSH_POOL_PACK_GEN,
  MSH_POOL_PENDING_COMMENT,
} from "./msh-pool.ts";
import { buildMshOriginComponents } from "./msh-pool-interaction.ts";

const MSH_POOL_COMMAND_CHANNELS = new Set([
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

export const marvelMshPoolHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (!message.content.startsWith(MSH_POOL_CMD)) return;
  handle.claim();

  if (!upcomingSheet) {
    await message.reply("Marvel league sheet is not configured.");
    return;
  }

  if (!message.inGuild()) {
    await message.reply("Use this command in a server channel.");
    return;
  }

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  if (!MSH_POOL_COMMAND_CHANNELS.has(message.channel.id)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }

  const parts = message.content.trim().split(/\s+/);
  let targetDiscordId = message.author.id;

  if (parts.length > 1) {
    const mentioned = resolveDiscordId(parts[1]);
    if (!mentioned) {
      await message.reply(
        "Usage: `!mshpool` or `!mshpool @Player` (committee only).",
      );
      return;
    }
    if (mentioned !== message.author.id) {
      if (!await isLeagueCommittee(message.client, message.author.id)) {
        await message.reply(
          "Only League Committee members can roll a pool for another player.",
        );
        return;
      }
      targetDiscordId = mentioned;
    }
  }

  const sheet = upcomingSheet;
  const lookup = await lookupPlayerByDiscordId(sheet, targetDiscordId);
  if (!lookup) {
    await message.reply(
      `No player with Discord ID \`${targetDiscordId}\` found in the Player Database.`,
    );
    return;
  }

  const { player } = lookup;
  const poolChanges = await sheet.getPoolChanges();

  if (findPendingMshPool(poolChanges, player.Identification)) {
    await message.reply(
      `<@${targetDiscordId}> already has an MSH pool waiting on an origin choice — check DMs.`,
    );
    return;
  }

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
    `Rolling MSH starting pool for <@${targetDiscordId}>…`,
  );

  try {
    const sentMessage = await startingPoolChannel.send(
      `${MSH_POOL_PACK_GEN} <@${targetDiscordId}>`,
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
      MSH_POOL_PENDING_COMMENT,
      poolId,
    );

    const targetUser = await message.client.users.fetch(targetDiscordId);
    await targetUser.send({
      content: buildMshOriginMessage(),
      components: buildMshOriginComponents(targetDiscordId),
    });

    await message.channel.send(
      `MSH pool recorded for **${player.Identification}**. Origin choice DM sent.`,
    );
  } catch (e) {
    console.error("[Marvel mshpool] roll failed:", e);
    await message.channel.send(
      `Failed to roll MSH pool for <@${targetDiscordId}>. Check starting pools for errors.`,
    );
  }
};
