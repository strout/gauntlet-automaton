import * as djs from "discord.js";
import { z } from "zod";
import { CONFIG } from "./config.ts";
import { mutex } from "./mutex.ts";
import { liveSheet } from "./standings.ts";

/**
 * Looking-for-match bot, ported from PoolBot's `Matchmaker`.
 *
 * A player DMs `!lfm`. The bot posts an anonymous note in the LFM channel.
 * Someone there posts `!challenge` to accept. `!nvm` takes the post down.
 * Only one seeker is pending, and that state is lost on restart.
 *
 * Before a pair is announced, both players are checked against the live
 * sheet. The match is not on the sheet yet, so `MATCHES <Max` does not
 * include it. Zero or less means this match would put them over the weekly
 * cap (or they are already over). The match reporter still rejects a row
 * whose value is negative after the match has been counted.
 */

const MATCHES_UNDER_MAX = "MATCHES <Max";
const LFM_COMMAND = "!lfm";
const CHALLENGE_COMMAND = "!challenge";
const RETRACT_COMMANDS = new Set(["!nvm", "!retractlfm"]);

const acquireLock = mutex();

const playerExtras = {
  [MATCHES_UNDER_MAX]: z.unknown().transform((value): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }),
};

type LimitPlayer = Awaited<
  ReturnType<typeof liveSheet.getPlayers<typeof playerExtras>>
>["rows"][number];

interface PendingSeek {
  readonly userId: string;
  readonly message: djs.Message;
}

let pending: PendingSeek | undefined;
let lfmChannel: djs.TextChannel | undefined;

/** Listens for `!lfm`, `!challenge`, and `!nvm` on a client that is already logged in. */
export function startMatchmaking(client: djs.Client<true>): void {
  const channelId = CONFIG.LFM_CHANNEL_ID;
  if (!channelId) {
    console.error("[lfm] LFM_CHANNEL_ID is not set.");
    return;
  }
  void client.channels.fetch(channelId).then((channel) => {
    if (!(channel instanceof djs.TextChannel)) {
      console.error(`[lfm] Channel ${channelId} is not a text channel.`);
      return;
    }
    lfmChannel = channel;
    console.log(
      `[lfm] Matchmaking in #${channel.name} (${channel.guild.name})`,
    );
  }).catch((err) => {
    console.error("[lfm] Could not find the LFM channel:", err);
  });
  client.on(djs.Events.MessageCreate, (message) => {
    void onMessage(message).catch((err) => {
      console.error("[lfm] message failed:", err);
    });
  });
}

async function onMessage(message: djs.Message): Promise<void> {
  if (message.author.bot) return;
  const parsed = parseCommand(message.content);
  if (!parsed) return;
  const channel = lfmChannel;
  if (!channel) return;

  if (!message.inGuild()) {
    await onDirectMessage(message, channel, parsed.command, parsed.argument);
    return;
  }
  if (message.channelId !== channel.id) return;
  if (parsed.command === CHALLENGE_COMMAND) {
    await issueChallenge(message, channel);
    return;
  }
  if (parsed.command === "!help") {
    await message.channel.send(
      [
        "`!challenge`: accept the current anonymous looking-for-match post.",
        "`!lfm`: DM this to me to post an anonymous looking-for-match.",
        "`!nvm`: DM this to me to take your post down.",
      ].join("\n"),
    );
  }
}

async function onDirectMessage(
  message: djs.Message,
  channel: djs.TextChannel,
  command: string,
  argument: string,
): Promise<void> {
  if (command === LFM_COMMAND) {
    await postSeek(message, channel, argument);
    return;
  }
  if (RETRACT_COMMANDS.has(command)) {
    await retract(message, channel);
    return;
  }
  await message.author.send(
    [
      "Send one of these:",
      "`!lfm`: post an anonymous looking-for-match. You can add a note after the command.",
      "`!nvm`: take down the post you sent.",
    ].join("\n"),
  );
}

async function postSeek(
  message: djs.Message,
  channel: djs.TextChannel,
  note: string,
): Promise<void> {
  using _lock = await acquireLock();
  if (pending) {
    await message.author.send(
      `Someone is already looking for a match. Post \`!challenge\` in ${channel.url}`,
    );
    return;
  }
  const block = await playBlock(message.author.id);
  if (block === "unreadable") {
    await message.author.send(
      "I couldn't read the standings, so I didn't post a looking-for-match. Try again in a moment.",
    );
    return;
  }
  if (block) {
    await message.author.send(
      `I didn't post a looking-for-match. ${sentence(block.reason)}`,
    );
    return;
  }
  const lines = [
    "An anonymous player is looking for a match. Post `!challenge` to reveal their identity and start the match.",
  ];
  if (note) lines.push("", "Message from the player:", `> ${note}`);
  const posted = await channel.send(lines.join("\n"));
  pending = { userId: message.author.id, message: posted };
  await message.author.send(
    [
      `I've created a post for you: ${posted.url}`,
      "You'll be mentioned when an opponent accepts.",
      "To cancel it, send `!nvm`.",
    ].join("\n"),
  ).catch((err) => {
    console.error(
      `[lfm] Posted for ${message.author.id} but the DM failed:`,
      err,
    );
  });
  console.log(`[lfm] ${message.author.id} is looking for a match`);
}

async function retract(
  message: djs.Message,
  channel: djs.TextChannel,
): Promise<void> {
  using _lock = await acquireLock();
  if (!pending || pending.userId !== message.author.id) {
    await message.author.send("You don't currently have an outgoing LFM.");
    return;
  }
  await pending.message.delete().catch((err) => {
    console.error("[lfm] Could not delete the LFM post:", err);
  });
  pending = undefined;
  await message.author.send(
    `Understood. The post in ${channel.url} has been deleted.`,
  );
  console.log(`[lfm] ${message.author.id} retracted their LFM`);
}

async function issueChallenge(
  message: djs.Message,
  channel: djs.TextChannel,
): Promise<void> {
  using _lock = await acquireLock();
  if (!pending) {
    await channel.send(
      "No one is looking for a match right now. DM me `!lfm` to post an anonymous one.",
    );
    return;
  }
  if (pending.userId === message.author.id) {
    await channel.send("You can't challenge your own looking-for-match post.");
    return;
  }
  const seekerId = pending.userId;
  const [seeker, challenger] = await Promise.all([
    playBlock(seekerId),
    playBlock(message.author.id),
  ]);
  if (seeker === "unreadable" || challenger === "unreadable") {
    await channel.send(
      "I couldn't read the standings, so I didn't start this match. Try again in a moment.",
    );
    return;
  }
  if (seeker || challenger) {
    console.log(
      `[lfm] rejected challenge ${seekerId} vs ${message.author.id}: ${
        [
          seeker && `${seeker.who}: ${seeker.reason}`,
          challenger &&
          `${challenger.who}: ${challenger.reason}`,
        ].filter(Boolean).join("; ")
      }`,
    );
  }
  if (seeker) {
    await pending.message.delete().catch((err) => {
      console.error("[lfm] Could not delete a blocked LFM post:", err);
    });
    pending = undefined;
    await message.client.users.fetch(seekerId).then((user) =>
      user.send(
        `I took down your looking-for-match post. ${sentence(seeker.reason)}`,
      )
    ).catch((err) => {
      console.error(`[lfm] Could not DM ${seekerId} about the block:`, err);
    });
    const challengerLine = challenger
      ? `\n${message.author}, ${challenger.reason}.`
      : "";
    await channel.send(
      `That looking-for-match post was removed. That player can't take another match right now.${challengerLine}`,
    );
    return;
  }
  if (challenger) {
    await channel.send(
      `${message.author}, ${challenger.reason}. The looking-for-match post is still up.`,
    );
    return;
  }

  try {
    await channel.send(
      `<@${seekerId}>, your anonymous LFM has been accepted by ${message.author}.`,
    );
  } catch (err) {
    console.error(
      "[lfm] Failed to announce the match; the seeker stays pending:",
      err,
    );
    return;
  }
  const posted = pending.message;
  pending = undefined;
  await posted.edit(
    `~~${posted.content}~~\nA match was found!`,
  ).catch((err) => {
    console.error(
      "[lfm] Match announced but the old post was not updated:",
      err,
    );
  });
  console.log(`[lfm] ${seekerId} matched with ${message.author.id}`);
}

/**
 * Why this player cannot take a match that has not been reported yet.
 * `unreadable` means the sheet read failed and the caller should try again.
 */
async function playBlock(
  discordId: string,
): Promise<
  { readonly who: string; readonly reason: string } | "unreadable" | undefined
> {
  let players: readonly LimitPlayer[];
  try {
    players = (await liveSheet.getPlayers(playerExtras)).rows;
  } catch (err) {
    console.error("[lfm] Could not read players:", err);
    return "unreadable";
  }
  const player = players.find((row) => row["Discord ID"].trim() === discordId);
  if (!player) {
    return {
      who: discordId,
      reason: "you are not on the league player list",
    };
  }
  const who = player.Identification;
  if (
    player.Losses >= CONFIG.MAX_LOSSES ||
    player["TOURNAMENT STATUS"] === "Eliminated"
  ) {
    return { who, reason: "you are eliminated" };
  }
  const remaining = player[MATCHES_UNDER_MAX];
  if (remaining === null) {
    return { who, reason: "I couldn't read your match limit" };
  }
  // The match is not on the sheet yet. Zero means they are already at the
  // weekly cap, so accepting this match would be the overplay the reporter
  // later sees as a negative MATCHES <Max.
  if (remaining <= 0) {
    return {
      who,
      reason:
        "you are at your match limit for the week, so this match would be an overplay",
    };
  }
  return undefined;
}

function sentence(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

function parseCommand(
  content: string,
): { readonly command: string; readonly argument: string } | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("!")) return undefined;
  const space = trimmed.search(/\s/);
  const command = (space < 0 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const quoted = trimmed.match(/"([^"]*)"/);
  const argument = quoted
    ? quoted[1].trim()
    : space < 0
    ? ""
    : trimmed.slice(space).trim();
  return { command, argument };
}
