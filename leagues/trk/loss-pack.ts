import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import { extractPool, waitForBoosterTutor } from "../../pending.ts";
import { type ScryfallCard, tileCardImages } from "../../scryfall.ts";
import {
  makeSealedDeck,
  type SealedDeckEntry,
  type SealedDeckPool,
} from "../../sealeddeck.ts";
import {
  getSheetTimeZoneOffsetMs,
  readSheetsDate,
  sheets,
  sheetsWrite,
} from "../../sheets.ts";
import {
  type LeagueSheet,
  rebuildPoolContents,
  ROWNUM,
} from "../../standings.ts";
import { rollTrkLossPack } from "./cards.ts";

const PENDING = "pending";
const EOE_COMMAND = "!eoe";
/** Sheet time can lead Discord by a few seconds. A command inside this window still belongs to the row. */
const COMMAND_GRACE_MS = 15_000;
const waitingOnTutor = new Set<number>();

/**
 * Loss number written on a Pool Changes comment (`Loss: 1`). That number
 * picks the pack: odd losses are EOE, even losses are TRK.
 */
export function recordedLoss(
  comment: string | null | undefined,
): number | undefined {
  const found = `${comment ?? ""}`.match(/\bLoss:\s*(\d+)\b/i);
  if (!found) return undefined;
  const loss = Number(found[1]);
  return loss > 0 ? loss : undefined;
}

/** True once the loss pack row stores a sealed-deck id rather than `pending`. */
export function lossPackRolled(value: string | null | undefined): boolean {
  const text = `${value ?? ""}`.trim();
  return text.length > 0 && text !== PENDING;
}

/**
 * Rolls the loss pack onto an existing Pool Changes row.
 * Odd losses (1st, 3rd, …) ask Booster Tutor for `!eoe` and wait for its reply.
 * Even losses roll a Trek pack. The row's Value becomes the pack id and Full
 * Pool becomes the player's pool with that pack added.
 *
 * Callers hold the planet lock. The EOE reply is written later, under that
 * same lock, so the Discord interaction does not sit on Booster Tutor.
 */
export async function ensureTrkLossPack(args: {
  readonly client: djs.Client;
  readonly sheet: LeagueSheet;
  readonly identification: string;
  readonly discordId: string;
  readonly matchRow: number;
  readonly packRow: number;
  readonly value: string;
  readonly comment: string;
  readonly withLock: <T>(body: () => Promise<T>) => Promise<T>;
}): Promise<string | undefined> {
  if (lossPackRolled(args.value)) return undefined;
  const channel = await packGenChannel(args.client);
  const ordinal = recordedLoss(args.comment) ??
    await lossOrdinal(args.sheet, args.matchRow);
  if (ordinal % 2 === 0) return await rollEvenPack(args, channel, ordinal);
  return await rollOddPack(args, channel);
}

async function rollEvenPack(
  args: {
    readonly sheet: LeagueSheet;
    readonly identification: string;
    readonly discordId: string;
    readonly matchRow: number;
    readonly packRow: number;
  },
  channel: djs.TextChannel,
  ordinal: number,
): Promise<string | undefined> {
  const cards = await rollTrkLossPack();
  const entries = sealedEntries(cards);
  const packId = await makeSealedDeck({ sideboard: entries });
  const fullPoolId = await commitLossPack(
    args.sheet,
    args.packRow,
    args.identification,
    packId,
    entries,
  );
  if (!fullPoolId) return undefined;
  console.log(
    `[trk] loss ${ordinal} for ${args.identification} match ${args.matchRow} is TRK pack ${packId}`,
  );
  const preview = await trkPackPreview({
    identification: args.identification,
    discordId: args.discordId,
    cards,
    packId,
    fullPoolId,
  });
  await channel.send(preview).catch((err) => {
    console.error(
      `[trk] TRK loss pack for match ${args.matchRow} is recorded but the post failed:`,
      err,
    );
  });
  return fullPoolId;
}

/** Tiled pack image and sealeddeck links, same shape as the FRA comeback post. */
async function trkPackPreview(args: {
  readonly identification: string;
  readonly discordId: string;
  readonly cards: readonly ScryfallCard[];
  readonly packId: string;
  readonly fullPoolId: string;
}): Promise<djs.MessageCreateOptions> {
  const embed = new djs.EmbedBuilder()
    .setTitle(`TRK loss pack — ${args.identification}`)
    .setDescription(`${args.cards.length} cards`)
    .setColor(0xe87800)
    .addFields(
      {
        name: "Combined pool",
        value: `[Open pool](https://sealeddeck.tech/${args.fullPoolId})`,
        inline: true,
      },
      {
        name: "This pack only",
        value: `[Pack contents](https://sealeddeck.tech/${args.packId})`,
        inline: true,
      },
    )
    .setTimestamp();
  const files: djs.AttachmentBuilder[] = [];
  try {
    const blob = await tileCardImages(args.cards, "small");
    files.push(
      new djs.AttachmentBuilder(Buffer.from(await blob.arrayBuffer()), {
        name: "pack.png",
        description: "TRK loss pack",
      }),
    );
    embed.setImage("attachment://pack.png");
  } catch (err) {
    console.error("[trk] TRK loss pack image failed:", err);
  }
  return {
    content: `<@${args.discordId}> — loss pack`,
    embeds: [embed],
    files,
  };
}

async function rollOddPack(
  args: {
    readonly client: djs.Client;
    readonly sheet: LeagueSheet;
    readonly identification: string;
    readonly discordId: string;
    readonly matchRow: number;
    readonly packRow: number;
    readonly comment: string;
    readonly withLock: <T>(body: () => Promise<T>) => Promise<T>;
  },
  channel: djs.TextChannel,
): Promise<string | undefined> {
  const command = await eoeCommand(args, channel);
  const reply = await findTutorReply(channel, command.id);
  if (reply) return await commitTutorPack(args, reply);
  if (waitingOnTutor.has(args.matchRow)) return;
  waitingOnTutor.add(args.matchRow);
  const finished = waitForBoosterTutor(Promise.resolve(command)).then(
    async (result) => {
      if ("error" in result) {
        console.error(
          `[trk] Booster Tutor !eoe failed for match ${args.matchRow}: ${result.error}`,
        );
        return;
      }
      await args.withLock(() => commitTutorPack(args, result.success.message));
    },
  );
  finished.catch((err) => {
    console.error(`[trk] EOE pack failed for match ${args.matchRow}:`, err);
  }).finally(() => {
    waitingOnTutor.delete(args.matchRow);
  });
  return undefined;
}

async function commitTutorPack(
  args: {
    readonly sheet: LeagueSheet;
    readonly identification: string;
    readonly matchRow: number;
    readonly packRow: number;
  },
  message: djs.Message,
): Promise<string | undefined> {
  const pool = await extractPool(message);
  if (!pool) {
    console.error(
      `[trk] Booster Tutor reply ${message.id} for match ${args.matchRow} had no pool`,
    );
    return undefined;
  }
  const fullPoolId = await commitLossPack(
    args.sheet,
    args.packRow,
    args.identification,
    pool.poolId,
    poolEntries(pool),
  );
  if (fullPoolId) {
    console.log(
      `[trk] loss pack for ${args.identification} match ${args.matchRow} is EOE ${pool.poolId}`,
    );
  }
  return fullPoolId;
}

async function commitLossPack(
  sheet: LeagueSheet,
  packRow: number,
  identification: string,
  packId: string,
  entries: readonly SealedDeckEntry[],
): Promise<string | undefined> {
  const changes = await sheet.getPoolChanges();
  const row = changes.rows.find((entry) => entry[ROWNUM] === packRow);
  if (!row || row.Type !== "loss pack") {
    throw new Error(`Loss pack row ${packRow} is missing`);
  }
  if (lossPackRolled(row.Value)) return undefined;
  const playerRows = changes.rows.filter((entry) =>
    entry.Name === identification
  );
  const rebuilt = await rebuildPoolContents(
    playerRows.map((entry) => [
      entry.Timestamp,
      entry.Name,
      entry.Type,
      entry.Value,
    ]),
  );
  const fullPoolId = await makeSealedDeck({
    sideboard: withEntries(rebuilt, entries),
  });
  const cardRow = playerRows.findLast((entry) =>
    entry.Type === "add card" &&
    entry[ROWNUM] > packRow &&
    sameLoss(entry.Comment, row.Comment)
  );
  if (!cardRow) {
    await sheetsWrite(
      sheets,
      sheet.sheetId,
      `Pool Changes!D${packRow}:F${packRow}`,
      [[packId, row.Comment ?? "", fullPoolId]],
    );
    return fullPoolId;
  }
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!D${packRow}:E${packRow}`,
    [[packId, row.Comment ?? ""]],
  );
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!F${cardRow[ROWNUM]}`,
    [[fullPoolId]],
  );
  return fullPoolId;
}

function sameLoss(
  comment: string | null,
  packComment: string | null,
): boolean {
  const loss = recordedLoss(packComment);
  return loss !== undefined && recordedLoss(comment) === loss;
}

function withEntries(
  sideboard: readonly { name: string; count: number }[],
  extra: readonly SealedDeckEntry[],
): { name: string; count: number }[] {
  const counts = new Map(sideboard.map((entry) => [entry.name, entry.count]));
  for (const entry of extra) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.count);
  }
  return [...counts.entries()].filter(([, count]) => count > 0).map((
    [name, count],
  ) => ({ name, count }));
}

async function eoeCommand(
  args: {
    readonly client: djs.Client;
    readonly sheet: LeagueSheet;
    readonly discordId: string;
    readonly matchRow: number;
    readonly packRow: number;
    readonly comment: string;
  },
  channel: djs.TextChannel,
): Promise<djs.Message> {
  const changes = await args.sheet.getPoolChanges();
  const row = changes.rows.find((entry) => entry[ROWNUM] === args.packRow);
  const since = await rowCreatedAt(args.sheet, row?.Timestamp);
  const recorded = eoeMessageId(args.comment);
  if (recorded) {
    const message = await channel.messages.fetch(recorded).catch(() =>
      undefined
    );
    if (message && coversThisLoss(message.createdTimestamp, since)) {
      return message;
    }
    if (message) {
      console.log(
        `[trk] match ${args.matchRow} !eoe ${message.id} is from an earlier loss; posting a new one`,
      );
    }
  }
  const clientId = args.client.user?.id;
  if (clientId) {
    const existing = await findCommand(
      channel,
      clientId,
      args.discordId,
      claimedEoeIds(changes.rows, args.packRow),
      since,
    );
    if (existing === "ambiguous") {
      throw new Error(
        `Several !eoe commands for ${args.discordId} are not tied to a pack row`,
      );
    }
    if (existing) {
      await rememberEoe(args.sheet, args.packRow, existing.id);
      return existing;
    }
  }
  console.log(
    `[trk] posting !eoe for ${args.discordId} match ${args.matchRow}`,
  );
  const sent = await channel.send(`${EOE_COMMAND} <@${args.discordId}>`);
  await rememberEoe(args.sheet, args.packRow, sent.id);
  return sent;
}

/** A channel `!eoe` belongs to this loss only if it was posted with the pack row, not borrowed from an earlier one. */
function coversThisLoss(createdAt: number, since: number): boolean {
  return createdAt + COMMAND_GRACE_MS >= since;
}

async function rowCreatedAt(
  sheet: LeagueSheet,
  stamp: string | number | undefined,
): Promise<number> {
  if (
    typeof stamp === "number" ||
    (typeof stamp === "string" && stamp !== "" && !stamp.includes("T") &&
      !Number.isNaN(Number(stamp)))
  ) {
    const offset = await getSheetTimeZoneOffsetMs(sheet.sheetId);
    return readSheetsDate(Number(stamp), offset).getTime();
  }
  if (typeof stamp === "string") {
    const parsed = Date.parse(stamp);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

async function rememberEoe(
  sheet: LeagueSheet,
  packRow: number,
  messageId: string,
): Promise<void> {
  const changes = await sheet.getPoolChanges();
  const row = changes.rows.find((entry) => entry[ROWNUM] === packRow);
  const comment = row?.Comment ?? "";
  if (eoeMessageId(comment) === messageId) return;
  await sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!E${packRow}`,
    [[commentWithEoe(comment, messageId)]],
  );
}

function commentWithEoe(comment: string, messageId: string): string {
  const stripped = comment.replace(/\seoe:\d+\b/g, "").trim();
  const token = `eoe:${messageId}`;
  if (stripped.includes("[sent]")) {
    return stripped.replace("[sent]", `${token} [sent]`);
  }
  return `${stripped} ${token}`.trim();
}

function eoeMessageId(comment: string): string | undefined {
  return comment.match(/\beoe:(\d+)\b/)?.[1];
}

function claimedEoeIds(
  rows: readonly { [ROWNUM]: number; Comment: string | null }[],
  exceptPackRow: number,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row[ROWNUM] === exceptPackRow) continue;
    const id = eoeMessageId(row.Comment ?? "");
    if (id) ids.add(id);
  }
  return ids;
}

function isEoeCommand(content: string, discordId: string): boolean {
  const text = content.trim();
  return text === `${EOE_COMMAND} <@${discordId}>` ||
    text === `${EOE_COMMAND} <@!${discordId}>`;
}

async function findCommand(
  channel: djs.TextChannel,
  clientId: string,
  discordId: string,
  claimed: ReadonlySet<string>,
  since: number,
): Promise<djs.Message | "ambiguous" | undefined> {
  const found: djs.Message[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    for (const message of batch.values()) {
      if (message.author.id !== clientId) continue;
      if (claimed.has(message.id)) continue;
      if (!coversThisLoss(message.createdTimestamp, since)) continue;
      if (!isEoeCommand(message.content, discordId)) continue;
      found.push(message);
    }
    const oldest = batch.last();
    if (!oldest || batch.size < 100) break;
    before = oldest.id;
  }
  if (found.length > 1) return "ambiguous";
  return found[0];
}

async function findTutorReply(
  channel: djs.TextChannel,
  commandId: string,
): Promise<djs.Message | undefined> {
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) return undefined;
    const reply = batch.find((message) =>
      message.author.id === CONFIG.BOOSTER_TUTOR_USER_ID &&
      message.reference?.messageId === commandId
    );
    if (reply) return reply;
    const oldest = batch.last();
    if (!oldest || batch.size < 100) return undefined;
    if (BigInt(oldest.id) <= BigInt(commandId)) return undefined;
    before = oldest.id;
  }
  return undefined;
}

async function lossOrdinal(
  sheet: LeagueSheet,
  matchRow: number,
): Promise<number> {
  const matches = await sheet.getMatches({ "Match Announced": z.unknown() });
  const match = matches.rows.find((row) => row[ROWNUM] === matchRow);
  if (!match) throw new Error(`Match ${matchRow} is not on the Matches tab`);
  const losses = matches.rows.filter((row) =>
    row["Loser Name"] === match["Loser Name"] &&
    countsAsLoss(row["Match Announced"])
  );
  losses.sort((a, b) => a.Timestamp - b.Timestamp || a[ROWNUM] - b[ROWNUM]);
  const index = losses.findIndex((row) => row[ROWNUM] === matchRow);
  if (index < 0) {
    throw new Error(`Match ${matchRow} is not a counted loss`);
  }
  return index + 1;
}

function countsAsLoss(value: unknown): boolean {
  if (
    value === true || value === false || value === undefined ||
    value === null || value === ""
  ) return true;
  return typeof value === "string" && value.trim().toUpperCase() === "TRUE";
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

function poolEntries(pool: SealedDeckPool): SealedDeckEntry[] {
  const entries = new Map<string, SealedDeckEntry>();
  for (const entry of [...pool.sideboard, ...pool.deck, ...pool.hidden]) {
    const key = `${entry.name}|${entry.set ?? ""}`;
    const existing = entries.get(key);
    entries.set(key, {
      name: entry.name,
      set: entry.set,
      count: (existing?.count ?? 0) + entry.count,
    });
  }
  return [...entries.values()];
}

async function packGenChannel(client: djs.Client): Promise<djs.TextChannel> {
  const channel = await client.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID);
  if (!(channel instanceof djs.TextChannel)) {
    throw new Error("Could not find the pack generation channel");
  }
  return channel;
}
