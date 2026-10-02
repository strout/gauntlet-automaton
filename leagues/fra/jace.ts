import * as djs from "discord.js";
import { z } from "zod";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { choice } from "../../random.ts";
import {
  type ScryfallCard,
  searchCards,
  tileCardImages,
} from "../../scryfall.ts";
import {
  fetchSealedDeck,
  formatPool,
  makeSealedDeck,
  type SealedDeckPool,
} from "../../sealeddeck.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { type LeagueSheet, ROWNUM } from "../../standings.ts";
import { resolveFraSheet } from "./constants.ts";
import { isLeagueCommittee, resolveDiscordId } from "./discord-utils.ts";
import {
  cardsForImage,
  expandPool,
  mergeEntries,
  pickTwoUwSets,
  type RebuiltPack,
  replacePackInPool,
  rerollPackCommons,
  rollUwUncommon,
  swapMirroredCards,
  UW_SETS,
  type UwSet,
} from "./jace-cards.ts";
import { mirroredCardsInPack, readMirroredCards } from "./mirrored-cards.ts";
import { imageAttachment, poolAccentColor } from "./posting.ts";
import { playerMatcher, type SamePlayer } from "./rivals.ts";
import { fraRollLock } from "./rolling.ts";

/** Player Database column (AE) holding each player's Jace loyalty. */
export const JACE_LOYALTY_COLUMN = "Jace Loyalty Score";
/** Player Database column (AF): pool ID of the pack awaiting a Jace choice. */
export const JACE_PENDING_COLUMN = "Jace Pending Pack";
/** Player Database column (AG): comeback packs held until Jace's choice. */
export const JACE_HELD_COLUMN = "Jace Held Packs";
/** Loyalty gained per loss. */
export const EMPOWER_AMOUNT = 3;
/** Appended to Pool Changes comments of rows reverted by `!undoloss`. */
export const UNDONE_TAG = "Undone by !undoloss";
const JACE_COLOR = 0x0e68ab;
const BOOSTER_TUTOR_TIMEOUT_MS = 3 * 60_000;

const ABILITY_PREFIX = "fra-jace";
const PACK_PICK_PREFIX = "fra-jace-pick";

type JaceCost = 1 | 2 | 5 | 8;

interface JaceAbility {
  readonly cost: JaceCost;
  readonly name: string;
  readonly rules: string;
  /** Narration shown once the ability has been chosen. */
  readonly flavor: string;
}

/** e.g. `SOS, ECL, EOE, TDM, DFT or DSK` */
const JACE_SET_LIST = UW_SETS.map((s) => s.toUpperCase()).join(", ")
  .replace(/, (?=[^,]+$)/, " or ");

const PARALLEL_PROOF: JaceAbility = {
  cost: 8,
  name: "Parallel Proof",
  rules: `Open 2 different packs from ${JACE_SET_LIST}; choose one to keep.`,
  flavor: "Two realities, two outcomes. Only one survives the experiment.",
};

const JACE_ABILITIES: readonly JaceAbility[] = [
  {
    cost: 1,
    name: "Stray Thought",
    rules: `Add a random uncommon from ${JACE_SET_LIST} to your pool.`,
    flavor:
      "Jace reaches across the fracture and pockets an idea that was never his.",
  },
  {
    cost: 2,
    name: "Revise the Variables",
    rules:
      `Reroll this pack's nonland commons into commons from ${JACE_SET_LIST}.`,
    flavor: "A sound theory survives revision. A great one demands it.",
  },
  {
    cost: 5,
    name: "Inverted Reflection",
    rules:
      "Swap this pack's 3 Mirrored Pair cards for their counterparts. Your Rival isn't affected.",
    flavor:
      "Every mirror has two sides. Jace simply decides which one you stand on.",
  },
  PARALLEL_PROOF,
];

const abilityLabel = (a: JaceAbility) => `−${a.cost}: ${a.name}`;

/**
 * Cost of the Jace ability recorded on a comeback pack's Pool Changes comment
 * (`… · Jace −1`, or `… — Unused: replaced by Jace −2`), if any.
 */
export function jaceCostOnPack(comment: string): JaceCost | undefined {
  const cost = comment.match(/Jace −(\d+)/)?.[1];
  return JACE_ABILITIES.find((a) => String(a.cost) === cost)?.cost;
}

const isUndone = (row: PoolChangeRow): boolean =>
  (row.Comment ?? "").includes(UNDONE_TAG);

/** Opening narration for an Empower Jace prompt. */
const EMPOWER_FLAVOR: readonly string[] = [
  "Defeat is only data. The Theorist studies your loss and finds a flaw in reality worth exploiting.",
  "As your opponent celebrates, Jace Beleren is already rewriting the equation.",
  "Somewhere between one universe and the next, Jace takes note of your defeat, and grows stronger for it.",
  "The fracture widens. Jace leans closer, eager to test another hypothesis.",
  "Every loss is an experiment. Jace has been taking very careful notes.",
];

const JACE_NAME = "The Theorist, Jace Beleren";
let jaceArt: Promise<string | undefined> | undefined;

/** Jace's card image for embeds (cached; retried after a failure). */
function jaceArtUrl(): Promise<string | undefined> {
  jaceArt ??= searchCards(`set:fra !"${JACE_NAME}"`)
    .then((cards) => cards[0]?.image_uris?.normal)
    .catch((e) => {
      console.warn("[fra] Couldn't load Jace's art:", e);
      jaceArt = undefined;
      return undefined;
    });
  return jaceArt;
}

const narrate = (text: string) => `*${text}*`;

function parseCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const parsePoolId = (value: unknown): string =>
  value == null ? "" : String(value).trim();

const jaceExtras = {
  [JACE_LOYALTY_COLUMN]: z.unknown().transform(parseCount),
  [JACE_PENDING_COLUMN]: z.unknown().transform(parsePoolId),
  [JACE_HELD_COLUMN]: z.unknown().transform(parseCount),
};

export async function loadJacePlayers(sheet: LeagueSheet) {
  try {
    return await sheet.getPlayers(jaceExtras);
  } catch (e) {
    if (e instanceof z.ZodError) {
      const missing = Object.keys(jaceExtras).filter((column) =>
        e.issues.some((i) => i.path.includes(column))
      );
      if (missing.length > 0) {
        throw new Error(
          `Player Database is missing the ${
            missing.map((c) => `"${c}"`).join(", ")
          } header(s)`,
        );
      }
    }
    throw e;
  }
}
export type JacePlayers = Awaited<ReturnType<typeof loadJacePlayers>>;
export type JacePlayer = JacePlayers["rows"][number];

function loadPoolChanges(sheet: LeagueSheet) {
  return sheet.getPoolChanges();
}
export type PoolChangeRow = Awaited<
  ReturnType<typeof loadPoolChanges>
>["rows"][number];

/** Records which Jace ability was used on a comeback pack's row. */
function markJaceUsed(
  sheet: LeagueSheet,
  packRow: PoolChangeRow,
  cost: JaceCost,
): Promise<unknown> {
  return sheetsWrite(
    sheets,
    sheet.sheetId,
    `Pool Changes!E${packRow[ROWNUM]}`,
    [[`${packRow.Comment?.trim() ?? ""} · Jace −${cost}`]],
    "RAW",
  );
}

export function setJaceCell(
  sheet: LeagueSheet,
  players: JacePlayers,
  player: JacePlayer,
  column: keyof typeof jaceExtras,
  value: string | number,
): Promise<void> {
  return sheet.updatePlayerCell(
    player[ROWNUM],
    column,
    value,
    players.headerColumns,
  );
}

const sealedDeckUrl = (id: string) => `https://sealeddeck.tech/${id}`;

/** A comeback pack that Jace's abilities can target. */
export interface JacePack {
  readonly poolId: string;
  /** e.g. `Fracture pack #3` */
  readonly label: string;
}

/**
 * Empower Jace 3 after a loss, mark `pack` as awaiting a choice, then prompt
 * the player (by DM, or pack-gen if DMs fail) to activate one ability for it.
 * Call while holding `fraRollLock`.
 *
 * @returns Jace's new loyalty
 */
export async function empowerJace(
  client: djs.Client,
  sheet: LeagueSheet,
  discordId: string,
  pack: JacePack,
): Promise<number> {
  const players = await loadJacePlayers(sheet);
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    throw new Error(`No Player Database row for Discord ID ${discordId}`);
  }
  const loyalty = player[JACE_LOYALTY_COLUMN] + EMPOWER_AMOUNT;
  await setJaceCell(sheet, players, player, JACE_LOYALTY_COLUMN, loyalty);
  await setJaceCell(sheet, players, player, JACE_PENDING_COLUMN, pack.poolId);
  await sendToPlayer(
    client,
    discordId,
    await jacePrompt(
      discordId,
      loyalty,
      pack,
      `Jace's loyalty rises to ${loyalty}`,
    ),
    "activate Jace here",
  );
  return loyalty;
}

/**
 * `!jace @player` — League Committee only, in a DM to the bot. Re-sends the
 * Jace prompt for the player's pending pack (e.g. after a lost DM or a restart
 * mid-activation left the buttons greyed out).
 */
export const jaceResendHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!jace") return;
  handle.claim();

  if (message.inGuild()) {
    await message.reply("`!jace` only works in a DM to me.");
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply("Only League Committee can use `!jace`.");
    return;
  }
  const targetId = parts[1] ? resolveDiscordId(parts[1]) : null;
  if (!targetId) {
    await message.reply("Usage: `!jace @player`");
    return;
  }

  try {
    const sheet = await resolveFraSheet();
    const [players, poolChanges] = await Promise.all([
      loadJacePlayers(sheet),
      loadPoolChanges(sheet),
    ]);
    const player = players.rows.find((p) => p["Discord ID"] === targetId);
    if (!player) {
      await message.reply(
        `<@${targetId}> isn't on the Reality Fracture Player Database.`,
      );
      return;
    }
    const pending = player[JACE_PENDING_COLUMN];
    if (!pending) {
      await message.reply(
        `**${player.Identification}** has no pending Jace choice ("${JACE_PENDING_COLUMN}" is blank).`,
      );
      return;
    }
    const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));
    const packRow = poolChanges.rows.findLast((c) =>
      c.Value === pending && samePlayer(c.Name, player.Identification)
    );
    const pack: JacePack = {
      poolId: pending,
      label: packRow?.Comment?.trim() || "comeback pack",
    };
    const loyalty = player[JACE_LOYALTY_COLUMN];
    const sentTo = await sendToPlayer(
      message.client,
      targetId,
      await jacePrompt(
        targetId,
        loyalty,
        pack,
        `Jace is still waiting (loyalty ${loyalty})`,
      ),
      "activate Jace here",
    );
    await message.reply(
      `Re-sent Jace's prompt for **${player.Identification}**'s ${pack.label} (loyalty ${loyalty}) by ${sentTo}.`,
    );
  } catch (e) {
    console.error(`[fra] !jace failed for ${targetId}:`, e);
    await message.reply(
      `Couldn't re-send Jace's prompt: ${e instanceof Error ? e.message : e}`,
    );
  }
};

/**
 * If the player still owes Jace a choice, holds this comeback pack instead of
 * rolling it (counted in Jace Held Packs; released when they choose). Call
 * while holding `fraRollLock`.
 *
 * @returns the pack-gen message to post if the pack was held
 */
export async function holdFracturePack(
  sheet: LeagueSheet,
  discordId: string,
): Promise<string | undefined> {
  const players = await loadJacePlayers(sheet);
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  const pending = player?.[JACE_PENDING_COLUMN];
  if (!player || !pending) return undefined;
  const held = player[JACE_HELD_COLUMN] + 1;
  await setJaceCell(sheet, players, player, JACE_HELD_COLUMN, held);
  return [
    narrate(
      "Jace refuses to be rushed. No new theory can be built on an unfinished one.",
    ),
    `<@${discordId}>'s comeback pack is on hold until they activate Jace for their [last pack](${
      sealedDeckUrl(pending)
    }). Packs on hold: **${held}**.`,
  ].join("\n");
}

/** Re-posts `!fracture` for one held pack; the handler rolls it as usual. */
async function releaseHeldPack(
  client: djs.Client,
  discordId: string,
): Promise<void> {
  try {
    const packGen = await fetchTextChannel(client, CONFIG.PACKGEN_CHANNEL_ID);
    await packGen.send(
      `!fracture <@${discordId}> — held comeback pack released by Jace's choice.`,
    );
  } catch (e) {
    console.error(`[fra] Failed to release held pack for ${discordId}:`, e);
    await notifyOwner(
      client,
      `[fra] Couldn't release a held Fracture pack for <@${discordId}> (already removed from Jace Held Packs): ${e}.`,
    );
  }
}

async function jaceEmbed(): Promise<djs.EmbedBuilder> {
  const art = await jaceArtUrl();
  return new djs.EmbedBuilder()
    .setColor(JACE_COLOR)
    .setAuthor({ name: JACE_NAME, iconURL: art });
}

async function jacePrompt(
  discordId: string,
  loyalty: number,
  pack: JacePack,
  title: string,
): Promise<djs.MessageCreateOptions> {
  const art = await jaceArtUrl();
  const embed = (await jaceEmbed())
    .setTitle(title)
    .setDescription(
      [
        narrate(choice(EMPOWER_FLAVOR) ?? EMPOWER_FLAVOR[0]),
        "",
        `Choose one for your [${
          pack.label.replace(/^Fracture pack/, "Comeback Pack")
        }](${sealedDeckUrl(pack.poolId)}) **before** your next match:`,
        "",
        ...JACE_ABILITIES.map((a) => `**${abilityLabel(a)}** — ${a.rules}`),
      ].join("\n"),
    );
  if (art) embed.setThumbnail(art);
  const row = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    JACE_ABILITIES.map((a) =>
      new djs.ButtonBuilder()
        .setCustomId(`${ABILITY_PREFIX}:${discordId}:${a.cost}:${pack.poolId}`)
        .setLabel(abilityLabel(a))
        .setStyle(djs.ButtonStyle.Primary)
        .setDisabled(loyalty < a.cost)
    ),
  );
  return { embeds: [embed], components: [row] };
}

async function fetchTextChannel(
  client: djs.Client,
  channelId: string,
): Promise<djs.TextChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!(channel instanceof djs.TextChannel)) {
    throw new Error(`Channel ${channelId} not found`);
  }
  return channel;
}

/**
 * DMs the player; falls back to tagging them in pack-gen.
 *
 * @returns where the message was sent
 */
async function sendToPlayer(
  client: djs.Client,
  discordId: string,
  payload: djs.MessageCreateOptions,
  fallbackAction: string,
): Promise<"DM" | "pack-gen"> {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(payload);
    return "DM";
  } catch (e) {
    console.warn(`[fra] Couldn't DM ${discordId}; using pack-gen:`, e);
  }
  const packGen = await fetchTextChannel(client, CONFIG.PACKGEN_CHANNEL_ID);
  await packGen.send({
    ...payload,
    content: [
      `<@${discordId}> I couldn't DM you, so ${fallbackAction}.`,
      payload.content,
    ].filter(Boolean).join("\n"),
  });
  return "pack-gen";
}

async function notifyOwner(client: djs.Client, text: string): Promise<void> {
  try {
    const bunker = await fetchTextChannel(client, CONFIG.BOT_BUNKER_CHANNEL_ID);
    await bunker.send(`${text} CC <@${CONFIG.OWNER_ID}>`);
  } catch (e) {
    console.error("[fra] Failed to notify owner:", e);
  }
}

interface Announcement {
  readonly discordId: string;
  readonly ability: JaceAbility;
  readonly identification: string;
  readonly narration: string;
  readonly details: string;
  readonly cards: readonly ScryfallCard[];
  readonly poolId: string;
  readonly packPoolId?: string;
}

/** Best-effort public post in pack-gen. */
async function announce(client: djs.Client, a: Announcement): Promise<void> {
  try {
    const packGen = await fetchTextChannel(client, CONFIG.PACKGEN_CHANNEL_ID);
    const title = `${abilityLabel(a.ability)} — ${a.identification}`;
    const image = a.cards.length > 0
      ? await imageAttachment(
        tileCardImages(a.cards, "small"),
        "jace.png",
        title,
      )
      : undefined;
    const links = [
      `[Combined pool](${sealedDeckUrl(a.poolId)})`,
      ...(a.packPoolId
        ? [`[This pack only](${sealedDeckUrl(a.packPoolId)})`]
        : []),
    ].join(" · ");
    const embed = (await jaceEmbed())
      .setTitle(title)
      .setDescription(`${narrate(a.narration)}\n\n${a.details}\n\n${links}`)
      .setColor(a.cards.length > 0 ? poolAccentColor(a.cards) : JACE_COLOR)
      .setTimestamp();
    if (image) embed.setImage("attachment://jace.png");
    await packGen.send({
      content: `<@${a.discordId}>'s Jace activates **${
        abilityLabel(a.ability)
      }**`,
      embeds: [embed],
      files: image ? [image] : [],
    });
  } catch (e) {
    console.error("[fra] Failed to announce Jace ability:", e);
  }
}

/**
 * `done` and `failed` remove the buttons; `retry` restores them (nothing was
 * changed, so the player can try again or pick another ability).
 */
type Outcome =
  | { readonly done: string }
  | { readonly retry: string }
  | { readonly failed: string };

/**
 * Runs the sheet writes for an ability. Once anything may have been written,
 * errors become `failed` (never `retry`) so the ability can't apply twice.
 */
async function commit(
  client: djs.Client,
  what: string,
  discordId: string,
  writes: () => Promise<string>,
): Promise<Outcome> {
  try {
    return { done: await writes() };
  } catch (e) {
    console.error(`[fra] ${what} failed partway for ${discordId}:`, e);
    await notifyOwner(
      client,
      `[fra] ${what} failed partway for <@${discordId}>: ${e}.`,
    );
    return {
      failed:
        `${what} failed partway through. League Committee has been notified and will fix your pool.`,
    };
  }
}

interface AbilityRequest {
  readonly discordId: string;
  readonly ability: JaceAbility;
  readonly packPoolId: string;
}

function parseAbilityRequest(
  parts: readonly string[],
): AbilityRequest | undefined {
  const [discordId, cost, packPoolId] = parts;
  const ability = JACE_ABILITIES.find((a) => String(a.cost) === cost);
  return discordId && ability && packPoolId
    ? { discordId, ability, packPoolId }
    : undefined;
}

interface JaceContext {
  readonly sheet: LeagueSheet;
  readonly req: AbilityRequest;
  readonly identification: string;
  readonly loyalty: number;
  readonly samePlayer: SamePlayer;
  /** The Pool Changes row for the pack this prompt was sent for. */
  readonly packRow: PoolChangeRow;
  readonly currentPoolId: string | undefined;
  /**
   * Spends loyalty and resolves this pack's pending choice, releasing one held
   * comeback pack if there is one.
   */
  readonly spendLoyalty: () => Promise<void>;
}

async function loadContext(
  client: djs.Client,
  sheet: LeagueSheet,
  req: AbilityRequest,
): Promise<JaceContext | Exclude<Outcome, { done: string }>> {
  const [players, poolChanges] = await Promise.all([
    loadJacePlayers(sheet),
    loadPoolChanges(sheet),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === req.discordId);
  if (!player) {
    return { failed: "You're not on the Reality Fracture Player Database." };
  }
  const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));
  const playerChanges = poolChanges.rows.filter((c) =>
    samePlayer(c.Name, player.Identification)
  );
  const packRow = playerChanges.findLast((c) => c.Value === req.packPoolId);
  if (!packRow) {
    return {
      failed:
        "I couldn't find that pack on your Pool Changes. Ask League Committee for help.",
    };
  }
  if (isUndone(packRow)) {
    return { failed: "League Committee undid the loss this pack came from." };
  }
  const pending = player[JACE_PENDING_COLUMN];
  if (pending !== req.packPoolId) {
    return {
      failed: pending
        ? "Jace has moved on to a newer pack. Use the prompt for your latest pack instead."
        : "Jace has already acted on this pack.",
    };
  }
  const loyalty = player[JACE_LOYALTY_COLUMN];
  if (loyalty < req.ability.cost) {
    return {
      retry: `Jace only has **${loyalty}** loyalty, not enough for ${
        abilityLabel(req.ability)
      }. Pick another ability.`,
    };
  }
  return {
    sheet,
    req,
    identification: player.Identification,
    loyalty,
    samePlayer,
    packRow,
    currentPoolId:
      playerChanges.findLast((c) => c["Full Pool"])?.["Full Pool"] ??
        undefined,
    spendLoyalty: async () => {
      await setJaceCell(
        sheet,
        players,
        player,
        JACE_LOYALTY_COLUMN,
        loyalty - req.ability.cost,
      );
      await setJaceCell(sheet, players, player, JACE_PENDING_COLUMN, "");
      await markJaceUsed(sheet, packRow, req.ability.cost);
      const held = player[JACE_HELD_COLUMN];
      if (held > 0) {
        await setJaceCell(sheet, players, player, JACE_HELD_COLUMN, held - 1);
        await releaseHeldPack(client, req.discordId);
      }
    },
  };
}

const isContext = (
  c: JaceContext | Exclude<Outcome, { done: string }>,
): c is JaceContext => "sheet" in c;

async function activateAbility(
  client: djs.Client,
  req: AbilityRequest,
): Promise<Outcome> {
  const sheet = await resolveFraSheet();
  if (req.ability.cost === 8) return await activateMinus8(client, sheet, req);

  using _ = await fraRollLock();
  const ctx = await loadContext(client, sheet, req);
  if (!isContext(ctx)) return ctx;
  switch (req.ability.cost) {
    case 1:
      return await activateMinus1(client, ctx);
    case 2:
      return await replacePack(client, ctx, rerollPackCommons);
    case 5:
      return await activateMinus5(client, ctx);
  }
}

async function activateMinus1(
  client: djs.Client,
  ctx: JaceContext,
): Promise<Outcome> {
  const card = await rollUwUncommon();
  const poolId = await makeSealedDeck(
    { sideboard: [{ name: card.name, set: card.set, count: 1 }] },
    ctx.currentPoolId,
  );
  const outcome = await commit(
    client,
    "Jace −1",
    ctx.req.discordId,
    async () => {
      await ctx.spendLoyalty();
      await ctx.sheet.addPoolChange(
        ctx.identification,
        "add card",
        card.name,
        `Jace −1 (${ctx.packRow.Comment || ctx.req.packPoolId})`,
        poolId,
      );
      return [
        narrate(ctx.req.ability.flavor),
        `**${
          abilityLabel(ctx.req.ability)
        }:** added **${card.name}** (${card.set.toUpperCase()}) to your pool.`,
        `Jace's loyalty is now **${ctx.loyalty - 1}**. [Your pool](${
          sealedDeckUrl(poolId)
        })`,
      ].join("\n");
    },
  );
  if ("done" in outcome) {
    await announce(client, {
      discordId: ctx.req.discordId,
      ability: ctx.req.ability,
      identification: ctx.identification,
      narration: ctx.req.ability.flavor,
      details: `Added **${card.name}** (${card.set.toUpperCase()}).`,
      cards: [card],
      poolId,
    });
  }
  return outcome;
}

async function activateMinus5(
  client: djs.Client,
  ctx: JaceContext,
): Promise<Outcome> {
  const mirrored = mirroredCardsInPack(
    await readMirroredCards(ctx.sheet),
    ctx.identification,
    ctx.req.packPoolId,
    ctx.samePlayer,
  );
  if (mirrored.length === 0) {
    return {
      retry:
        "I couldn't find this pack's Mirrored Pair cards on Mirrored Cards. Pick another ability, or ask League Committee.",
    };
  }
  return await replacePack(
    client,
    ctx,
    (pack) => swapMirroredCards(pack, mirrored),
  );
}

/** Jace −2 / −5: swap the target pack for a rebuilt one in Pool Changes. */
async function replacePack(
  client: djs.Client,
  ctx: JaceContext,
  rebuild: (pack: SealedDeckPool) => Promise<RebuiltPack>,
): Promise<Outcome> {
  const what = `Jace −${ctx.req.ability.cost}`;
  if (ctx.packRow.Type !== "add pack") {
    return {
      retry:
        `That pack has already been replaced, so ${what} can't target it. Pick another ability.`,
    };
  }
  if (!ctx.currentPoolId) {
    return {
      failed: "Your Pool Changes have no Full Pool. Ask League Committee.",
    };
  }
  const [oldPack, fullPool] = await Promise.all([
    fetchSealedDeck(ctx.req.packPoolId),
    fetchSealedDeck(ctx.currentPoolId),
  ]);
  const rebuilt = await rebuild(oldPack);
  const newPackId = await makeSealedDeck({ sideboard: rebuilt.entries });
  const newPoolId = await makeSealedDeck({
    sideboard: replacePackInPool(fullPool, oldPack, rebuilt.entries),
  });
  const packName = ctx.packRow.Comment?.trim() || "comeback pack";

  const outcome = await commit(client, what, ctx.req.discordId, async () => {
    await ctx.spendLoyalty();
    await ctx.sheet.invalidatePoolChange(
      ctx.packRow[ROWNUM],
      `${packName} — Unused: replaced by ${what}`,
    );
    await ctx.sheet.addPoolChange(
      ctx.identification,
      "add pack",
      newPackId,
      `${packName} (${what})`,
      newPoolId,
    );
    return [
      narrate(ctx.req.ability.flavor),
      `**${abilityLabel(ctx.req.ability)}** applied to your ${packName}.`,
      `Jace's loyalty is now **${ctx.loyalty - ctx.req.ability.cost}**.`,
      `[New pack](${sealedDeckUrl(newPackId)}) · [Your pool](${
        sealedDeckUrl(newPoolId)
      })`,
    ].join("\n");
  });
  if ("done" in outcome) {
    await announce(client, {
      discordId: ctx.req.discordId,
      ability: ctx.req.ability,
      identification: ctx.identification,
      narration: ctx.req.ability.flavor,
      details: formatPool({ sideboard: rebuilt.entries }),
      cards: await cardsForImage(rebuilt.entries, rebuilt.added).catch(
        () => [],
      ),
      poolId: newPoolId,
      packPoolId: newPackId,
    });
  }
  return outcome;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
    ),
  ]);
}

/**
 * Jace −8: spend loyalty, open packs from 2 random Universes Within sets via
 * Booster Tutor in pack-gen, then let the player choose one.
 */
async function activateMinus8(
  client: djs.Client,
  sheet: LeagueSheet,
  req: AbilityRequest,
): Promise<Outcome> {
  const packGen = await fetchTextChannel(client, CONFIG.PACKGEN_CHANNEL_ID);
  const ctx = await (async () => {
    using _ = await fraRollLock();
    const loaded = await loadContext(client, sheet, req);
    // Spend before rolling so a crash mid-roll can't grant a free −8.
    if (isContext(loaded)) await loaded.spendLoyalty();
    return loaded;
  })();
  if (!isContext(ctx)) return ctx;

  const sets = pickTwoUwSets();
  try {
    const results = await Promise.all(sets.map((set, i) =>
      withTimeout(
        waitForBoosterTutor(
          packGen.send(
            `!${set} <@${req.discordId}> (Jace −8, pack ${i + 1} of 2)`,
          ),
        ),
        BOOSTER_TUTOR_TIMEOUT_MS,
      )
    ));
    const packs = results.map((r, i) => {
      if ("error" in r) {
        throw new Error(`Booster Tutor (${sets[i]}): ${r.error}`);
      }
      return { set: sets[i], pack: r.success };
    });
    await sendToPlayer(
      client,
      req.discordId,
      await packChoicePrompt(req.discordId, req.packPoolId, packs),
      "choose your Jace −8 pack here",
    );
  } catch (e) {
    console.error(`[fra] Jace −8 failed for ${req.discordId}:`, e);
    await notifyOwner(
      client,
      `[fra] Jace −8 for <@${req.discordId}> spent 8 loyalty but rolling the packs failed: ${e}.`,
    );
    return {
      failed:
        "Jace −8 spent 8 loyalty, but rolling the packs failed. League Committee has been notified.",
    };
  }
  return {
    done: [
      narrate(PARALLEL_PROOF.flavor),
      `**${abilityLabel(PARALLEL_PROOF)}:** opened **${
        sets[0].toUpperCase()
      }** and **${
        sets[1].toUpperCase()
      }** packs in pack-gen. Choose one in the message I just sent.`,
      `Jace's loyalty is now **${ctx.loyalty - 8}**.`,
    ].join("\n"),
  };
}

interface PackOption {
  readonly set: UwSet;
  readonly pack: SealedDeckPool;
}

async function packChoicePrompt(
  discordId: string,
  targetPackPoolId: string,
  [first, second]: readonly PackOption[],
): Promise<djs.MessageCreateOptions> {
  const options = [first, second];
  const embeds = await Promise.all(
    options.map(async (o, i) =>
      (await jaceEmbed())
        .setTitle(`Reality ${i + 1} — ${o.set.toUpperCase()}`)
        .setURL(sealedDeckUrl(o.pack.poolId))
        .setDescription(formatPool(o.pack))
    ),
  );
  const row = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    options.map((o, i) =>
      new djs.ButtonBuilder()
        .setCustomId(
          [
            PACK_PICK_PREFIX,
            discordId,
            o.set,
            o.pack.poolId,
            options[1 - i].pack.poolId,
            targetPackPoolId,
          ].join(":"),
        )
        .setLabel(`Choose reality ${i + 1} (${o.set.toUpperCase()})`)
        .setStyle(djs.ButtonStyle.Success)
    ),
  );
  return {
    content: [
      narrate(
        "Two universes hang side by side, each one complete. Jace waits for you to choose which becomes real.",
      ),
      `**${
        abilityLabel(PARALLEL_PROOF)
      }:** choose one of these packs to add to your pool.`,
    ].join("\n"),
    embeds,
    components: [row],
  };
}

const PICK_NARRATION =
  "The other reality collapses quietly. Jace files the result away for later.";

interface PackPick {
  readonly discordId: string;
  readonly set: UwSet;
  readonly packPoolId: string;
  readonly otherPackPoolId: string;
  /** The comeback pack Jace −8 was activated on (absent on older prompts). */
  readonly targetPackPoolId?: string;
}

function parsePackPick(parts: readonly string[]): PackPick | undefined {
  const [discordId, setCode, packPoolId, otherPackPoolId, targetPackPoolId] =
    parts;
  const set = UW_SETS.find((s) => s === setCode);
  return discordId && set && packPoolId && otherPackPoolId
    ? { discordId, set, packPoolId, otherPackPoolId, targetPackPoolId }
    : undefined;
}

async function pickPack(
  client: djs.Client,
  pick: PackPick,
): Promise<Outcome> {
  const sheet = await resolveFraSheet();
  using _ = await fraRollLock();
  const [players, poolChanges] = await Promise.all([
    loadJacePlayers(sheet),
    loadPoolChanges(sheet),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === pick.discordId);
  if (!player) {
    return { failed: "You're not on the Reality Fracture Player Database." };
  }
  const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));
  const playerChanges = poolChanges.rows.filter((c) =>
    samePlayer(c.Name, player.Identification)
  );
  if (
    playerChanges.some((c) =>
      c.Value === pick.packPoolId || c.Value === pick.otherPackPoolId
    )
  ) {
    return { failed: "You've already chosen a pack from this Jace −8." };
  }
  const targetRow = pick.targetPackPoolId
    ? playerChanges.findLast((c) => c.Value === pick.targetPackPoolId)
    : undefined;
  if (targetRow && isUndone(targetRow)) {
    return {
      failed: "League Committee undid the loss this Jace −8 came from.",
    };
  }
  const targetLabel = targetRow?.Comment?.match(/Fracture pack #\d+/)?.[0];
  const setLabel = pick.set.toUpperCase();
  const pack = await fetchSealedDeck(pick.packPoolId);
  const currentPoolId =
    playerChanges.findLast((c) => c["Full Pool"])?.["Full Pool"] ?? undefined;
  const poolId = await makeSealedDeck(
    { sideboard: mergeEntries(expandPool(pack)) },
    currentPoolId,
  );

  const outcome = await commit(
    client,
    "Jace −8 pack choice",
    pick.discordId,
    async () => {
      await sheet.addPoolChange(
        player.Identification,
        "add pack",
        pick.packPoolId,
        targetLabel
          ? `Jace −8 (${setLabel}) for ${targetLabel}`
          : `Jace −8 (${setLabel})`,
        poolId,
      );
      return [
        narrate(PICK_NARRATION),
        `Added the **${setLabel}** pack to your pool. [Your pool](${
          sealedDeckUrl(poolId)
        })`,
      ].join("\n");
    },
  );
  if ("done" in outcome) {
    await announce(client, {
      discordId: pick.discordId,
      ability: PARALLEL_PROOF,
      identification: player.Identification,
      narration: PICK_NARRATION,
      details: `Chose the **${setLabel}** pack.\n${formatPool(pack)}`,
      cards: [],
      poolId,
      packPoolId: pick.packPoolId,
    });
  }
  return outcome;
}

/** Disables every button, highlighting `chosenId` if given. */
function disabledButtons(
  message: djs.Message,
  chosenId?: string,
): djs.ActionRowBuilder<djs.ButtonBuilder>[] {
  return message.components.flatMap((row) =>
    row.type === djs.ComponentType.ActionRow
      ? [
        new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
          row.components.flatMap((c) => {
            if (c.type !== djs.ComponentType.Button) return [];
            const button = djs.ButtonBuilder.from(c).setDisabled(true);
            if (chosenId && c.customId === chosenId) {
              button.setStyle(djs.ButtonStyle.Success);
            }
            return [button];
          }),
        ),
      ]
      : []
  );
}

const inFlight = new Set<djs.Snowflake>();

/**
 * Buttons on Jace prompts (`fra-jace:…`) and Jace −8 pack choices
 * (`fra-jace-pick:…`). All state lives in the custom IDs and the sheet, so
 * prompts keep working across restarts.
 */
export const jaceInteractionHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton()) return;
  const [prefix, ...parts] = interaction.customId.split(":");
  if (prefix !== ABILITY_PREFIX && prefix !== PACK_PICK_PREFIX) return;
  handle.claim();

  const request = prefix === ABILITY_PREFIX
    ? parseAbilityRequest(parts)
    : parsePackPick(parts);
  if (!request) {
    await interaction.reply({
      content: "That button is no longer valid.",
      ephemeral: true,
    });
    return;
  }
  if (interaction.user.id !== request.discordId) {
    await interaction.reply({
      content: "Only the player this Jace belongs to can use these buttons.",
      ephemeral: true,
    });
    return;
  }
  const messageId = interaction.message.id;
  if (inFlight.has(messageId)) {
    await interaction.reply({
      content: "Still working on your last choice…",
      ephemeral: true,
    });
    return;
  }

  inFlight.add(messageId);
  const original = interaction.message.components;
  try {
    await interaction.update({
      components: disabledButtons(interaction.message),
    });
    let outcome: Outcome;
    try {
      outcome = "ability" in request
        ? await activateAbility(interaction.client, request)
        : await pickPack(interaction.client, request);
    } catch (e) {
      console.error("[fra] Jace button failed before any changes:", e);
      outcome = {
        retry: "Something went wrong and nothing was changed. Try again.",
      };
    }
    await interaction.editReply({
      components: "retry" in outcome
        ? original
        : disabledButtons(interaction.message, interaction.customId),
    });
    await interaction.followUp({
      content: "done" in outcome
        ? outcome.done
        : "retry" in outcome
        ? outcome.retry
        : outcome.failed,
    });
  } catch (e) {
    console.error("[fra] Jace interaction failed:", e);
  } finally {
    inFlight.delete(messageId);
  }
};
