import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { choice } from "../../random.ts";
import { ROWNUM } from "../../standings.ts";
import { z } from "zod";
import {
  HAS_CLUE_TOKEN_COLUMN,
  HAS_MAP_TOKEN_COLUMN,
  NXT_SETS,
  nxtSetByCode,
  type NxtSetDef,
  nxtSheet,
  setCodeFromComment,
} from "./constants.ts";

const TOKEN_COMMAND_CHANNELS = new Set([
  CONFIG.PACKGEN_CHANNEL_ID,
]);

const playerTokenExtras = {
  [HAS_MAP_TOKEN_COLUMN]: z.coerce.boolean().nullish(),
  [HAS_CLUE_TOKEN_COLUMN]: z.coerce.boolean().nullish(),
};

type TokenKind = "map" | "clue";

function tokenColumn(kind: TokenKind): string {
  return kind === "map" ? HAS_MAP_TOKEN_COLUMN : HAS_CLUE_TOKEN_COLUMN;
}

function tokenLabel(kind: TokenKind): string {
  return kind === "map" ? "Map Token" : "Clue Token";
}

function hasUnusedToken(value: boolean | null | undefined): boolean {
  // Explicit false = already used. Missing/true = still available.
  return value !== false;
}

async function handleTokenReroll(
  message: djs.Message,
  kind: TokenKind,
): Promise<void> {
  const sheet = nxtSheet();
  const players = await sheet.getPlayers(playerTokenExtras);
  const player = players.rows.find((p) =>
    p["Discord ID"] === message.author.id
  );
  if (!player) {
    await message.reply(
      "I can't find you on the Players sheet. Ask League Committee for help.",
    );
    return;
  }

  const col = tokenColumn(kind);
  const label = tokenLabel(kind);
  const tokenValue = kind === "map"
    ? player[HAS_MAP_TOKEN_COLUMN]
    : player[HAS_CLUE_TOKEN_COLUMN];
  if (!hasUnusedToken(tokenValue)) {
    await message.reply(`You've already used your ${label}.`);
    return;
  }

  const poolChanges = await sheet.getPoolChanges();
  const playerChanges = poolChanges.rows.filter((c) =>
    c.Name === player.Identification
  );
  const lastAdd = [...playerChanges].reverse().find((c) =>
    c.Type === "add pack"
  );
  if (!lastAdd) {
    await message.reply(
      "I can't find a recent pack to reroll. You need a comeback pack on file first.",
    );
    return;
  }

  let replacementSet: NxtSetDef | undefined;
  if (kind === "map") {
    replacementSet = choice([...NXT_SETS]);
  } else {
    const code = setCodeFromComment(lastAdd.Comment);
    replacementSet = code ? nxtSetByCode(code) : undefined;
    if (!replacementSet) {
      await message.reply(
        `I couldn't tell which set your last pack was from (comment: \`${
          lastAdd.Comment ?? ""
        }\`). CC <@!${CONFIG.OWNER_ID}>.`,
      );
      return;
    }
  }
  if (!replacementSet) {
    await message.reply("Failed to pick a replacement set. Try again.");
    return;
  }

  const packGenChannel = await message.client.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel;
  if (!packGenChannel) {
    await message.reply("Pack generation channel not found.");
    return;
  }

  await message.reply(
    kind === "map"
      ? `Using your Map Token — invalidating your last pack and rolling a random **${replacementSet.label}** pack…`
      : `Using your Clue Token — invalidating your last pack and rolling another **${replacementSet.label}** pack…`,
  );

  // Full pool as it was before this pack was added.
  const priorFullPool = playerChanges
    .filter((c) => c[ROWNUM] < lastAdd[ROWNUM] && c["Full Pool"])
    .at(-1)?.["Full Pool"];

  // Invalidate in place so sheet formulas that count "add pack" drop this row.
  const originalComment = lastAdd.Comment?.trim() || "";
  const unusedComment = originalComment
    ? `${originalComment} — Unused: ${label}`
    : `Unused: ${label}`;
  await sheet.invalidatePoolChange(
    lastAdd[ROWNUM],
    unusedComment,
    priorFullPool ?? undefined,
  );

  // Consume token before rolling so a crash mid-roll doesn't allow double-use.
  await sheet.updatePlayerCell(
    player[ROWNUM],
    col,
    false,
    players.headerColumns,
  );

  try {
    const sentMessage = await packGenChannel.send(
      `${replacementSet.command} <@!${message.author.id}> (${label} reroll)`,
    );
    const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
    if ("error" in result) {
      throw new Error(result.error);
    }

    const refreshed = await sheet.getPoolChanges();
    await sheet.recordPackAddition(
      player.Identification,
      result.success,
      `${label} reroll [${replacementSet.code}]`,
      refreshed,
    );

    const poolLink = await sheet.getExpectedPool(
      player.Identification,
      await sheet.getPoolChanges(),
    );
    await message.reply(
      `${label} spent. New **${replacementSet.label}** pack recorded.\n**Your pool:** ${poolLink}`,
    );
  } catch (e) {
    console.error(`[nxt-2026] ${kind} token reroll failed:`, e);
    await message.reply(
      `Your ${label} was marked used and the old pack was invalidated, but the replacement pack failed. CC <@!${CONFIG.OWNER_ID}>.`,
    );
  }
}

function isAllowedTokenChannel(message: djs.Message): boolean {
  return TOKEN_COMMAND_CHANNELS.has(message.channelId);
}

/** `!usemaptoken` — invalidate last pack, roll a random NXT set pack. */
export const nxtUseMapTokenHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (message.content.trim().toLowerCase() !== "!usemaptoken") return;
  handle.claim();
  if (!isAllowedTokenChannel(message)) {
    await message.reply("Use this command in the pack-gen channel.");
    return;
  }
  try {
    await handleTokenReroll(message, "map");
  } catch (e) {
    console.error("[nxt-2026] !usemaptoken failed:", e);
    await message.reply("Something went wrong using your Map Token.");
  }
};

/** `!usecluetoken` — invalidate last pack, roll another pack of the same set. */
export const nxtUseClueTokenHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (message.content.trim().toLowerCase() !== "!usecluetoken") return;
  handle.claim();
  if (!isAllowedTokenChannel(message)) {
    await message.reply("Use this command in the pack-gen channel.");
    return;
  }
  try {
    await handleTokenReroll(message, "clue");
  } catch (e) {
    console.error("[nxt-2026] !usecluetoken failed:", e);
    await message.reply("Something went wrong using your Clue Token.");
  }
};
