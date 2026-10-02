import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { type LeagueSheet, ROWNUM } from "../../standings.ts";
import { resolveFraSheet } from "./constants.ts";
import { isLeagueCommittee, resolveDiscordId } from "./discord-utils.ts";
import {
  EMPOWER_AMOUNT,
  JACE_HELD_COLUMN,
  JACE_LOYALTY_COLUMN,
  JACE_PENDING_COLUMN,
  jaceCostOnPack,
  type JacePlayer,
  type JacePlayers,
  loadJacePlayers,
  type PoolChangeRow,
  setJaceCell,
  UNDONE_TAG,
} from "./jace.ts";
import {
  markMirroredUndelivered,
  type MirroredCardRow,
  mirroredCardsInPack,
  readMirroredCards,
} from "./mirrored-cards.ts";
import { playerMatcher } from "./rivals.ts";
import { fraRollLock } from "./rolling.ts";

const CONFIRM_PREFIX = "fra-undoloss";
const CANCEL_PREFIX = "fra-undoloss-cancel";

/**
 * A comeback pack's own row (`Fracture pack #N`, maybe with a Jace marker),
 * not a Jace −2/−5 replacement (`Fracture pack #N (Jace −2)`).
 */
const FRACTURE_PACK_ROW = /^Fracture pack #(\d+)(?!\d)(?! \(Jace)/;

const sealedDeckUrl = (id: string) => `https://sealeddeck.tech/${id}`;
const isUndone = (row: PoolChangeRow) =>
  (row.Comment ?? "").includes(UNDONE_TAG);

interface PlayerRef {
  readonly players: JacePlayers;
  readonly player: JacePlayer;
  readonly identification: string;
}

/** The latest loss was held, so only Jace Held Packs changes. */
interface HeldUndo extends PlayerRef {
  readonly kind: "held";
  readonly token: string;
  readonly held: number;
}

/** The latest loss rolled a Fracture pack, possibly with a Jace ability. */
interface PackUndo extends PlayerRef {
  readonly kind: "pack";
  readonly token: string;
  readonly packNumber: number;
  readonly packRow: PoolChangeRow;
  /** Rows Jace's ability on this pack added (−1 card, −2/−5/−8 pack). */
  readonly jaceRows: readonly PoolChangeRow[];
  /** 0 if no ability was used. */
  readonly jaceCost: number;
  readonly priorFullPool: string | undefined;
  readonly mirrored: readonly MirroredCardRow[];
  readonly loyaltyFrom: number;
  readonly loyaltyTo: number;
}

type UndoPlan = HeldUndo | PackUndo | { readonly error: string };

/**
 * Works out how to undo `discordId`'s latest loss. Refuses (rather than
 * guessing) if anything else was added to their pool after that pack.
 */
async function planUndo(
  sheet: LeagueSheet,
  discordId: string,
): Promise<UndoPlan> {
  const [players, poolChanges, mirroredRows] = await Promise.all([
    loadJacePlayers(sheet),
    sheet.getPoolChanges(),
    readMirroredCards(sheet),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === discordId);
  if (!player) {
    return {
      error: `<@${discordId}> isn't on the Reality Fracture Player Database.`,
    };
  }
  const identification = player.Identification;
  const ref = { players, player, identification };

  const held = player[JACE_HELD_COLUMN];
  if (held > 0) return { kind: "held", token: `held-${held}`, held, ...ref };

  const samePlayer = playerMatcher(players.rows.map((p) => p.Identification));
  const changes = poolChanges.rows.filter((c) =>
    samePlayer(c.Name, identification)
  );
  const packIndex = changes.findLastIndex((c) =>
    !isUndone(c) && FRACTURE_PACK_ROW.test(c.Comment ?? "")
  );
  if (packIndex < 0) {
    return {
      error: `**${identification}** has no Fracture pack on Pool Changes.`,
    };
  }
  const packRow = changes[packIndex];
  const packComment = packRow.Comment ?? "";
  const packNumber = Number(packComment.match(FRACTURE_PACK_ROW)?.[1]);

  const forThisPack = new RegExp(`Fracture pack #${packNumber}(?!\\d)`);
  const later = changes.slice(packIndex + 1).filter((c) => !isUndone(c));
  const stray = later.filter((c) => {
    const comment = c.Comment ?? "";
    return !(comment.includes("Jace −") && forThisPack.test(comment));
  });
  if (stray.length > 0) {
    return {
      error: [
        `**${identification}**'s pool changed after Fracture pack #${packNumber}, so I won't guess. Undo by hand. Later rows:`,
        ...stray.slice(0, 5).map((c) =>
          `- Row ${c[ROWNUM]}: ${c.Type} ${c.Value} (${c.Comment ?? ""})`
        ),
      ].join("\n"),
    };
  }

  const pending = player[JACE_PENDING_COLUMN];
  const jaceCost = jaceCostOnPack(packComment) ??
    (later.some((c) => c.Comment?.startsWith("Jace −1")) ? 1 : undefined) ??
    (pending === packRow.Value ? 0 : undefined);
  if (jaceCost === undefined) {
    return {
      error:
        `Couldn't tell whether Jace was used on **${identification}**'s Fracture pack #${packNumber}: its row has no Jace marker and "${JACE_PENDING_COLUMN}" doesn't point to it. Undo by hand.`,
    };
  }

  const loyaltyFrom = player[JACE_LOYALTY_COLUMN];
  return {
    kind: "pack",
    token: packRow.Value,
    packNumber,
    packRow,
    jaceRows: later,
    jaceCost,
    priorFullPool: changes.slice(0, packIndex).findLast((c) => c["Full Pool"])
      ?.["Full Pool"] ?? undefined,
    mirrored: mirroredCardsInPack(
      mirroredRows,
      identification,
      packRow.Value,
      samePlayer,
    ),
    loyaltyFrom,
    loyaltyTo: Math.max(0, loyaltyFrom - EMPOWER_AMOUNT + jaceCost),
    ...ref,
  };
}

const describeRow = (c: PoolChangeRow) =>
  `row ${c[ROWNUM]} (${c.Type} ${c.Value}${
    c.Comment ? ` — ${c.Comment}` : ""
  })`;

function describePlan(plan: HeldUndo | PackUndo): string {
  if (plan.kind === "held") {
    return [
      `**Undo ${plan.identification}'s latest loss: a held comeback pack**`,
      `- Jace Held Packs ${plan.held} → ${
        plan.held - 1
      } (no pack was rolled for this loss)`,
      "",
      "_The Matches tab isn't changed; fix the match row by hand._",
    ].join("\n");
  }
  const pickPending = plan.jaceCost === 8 &&
    !plan.jaceRows.some((c) => c.Comment?.startsWith("Jace −8"));
  return [
    `**Undo ${plan.identification}'s latest loss: [Fracture pack #${plan.packNumber}](${
      sealedDeckUrl(plan.packRow.Value)
    })**`,
    `- Pool Changes: mark ${describeRow(plan.packRow)} unused`,
    ...plan.jaceRows.map((c) =>
      `- Pool Changes: mark ${describeRow(c)} unused`
    ),
    plan.priorFullPool
      ? `- Full Pool reverts to [their pool before this pack](${
        sealedDeckUrl(plan.priorFullPool)
      })`
      : "- Full Pool: no earlier Full Pool found; it will be blank",
    plan.mirrored.length > 0
      ? `- Mirrored Cards: ${plan.mirrored.length} rows back to undelivered (they'll be dealt again in their next Fracture pack #${plan.packNumber})`
      : "- Mirrored Cards: no delivered rows found for this pack",
    plan.jaceCost > 0
      ? `- Jace −${plan.jaceCost} was used on this pack${
        pickPending ? " (pack choice not made yet; it will be cancelled)" : ""
      }: refund ${plan.jaceCost}, remove the ${EMPOWER_AMOUNT} from the loss`
      : `- Jace: no ability used yet; remove the ${EMPOWER_AMOUNT} from the loss`,
    `- Jace loyalty ${plan.loyaltyFrom} → ${plan.loyaltyTo}; clear Jace Pending Pack`,
    "",
    "_Eliminations don't roll a pack, so make sure this is the misreported loss. The Matches tab isn't changed; fix the match row by hand._",
  ].join("\n");
}

async function executeUndo(
  sheet: LeagueSheet,
  plan: HeldUndo | PackUndo,
): Promise<void> {
  if (plan.kind === "held") {
    await setJaceCell(
      sheet,
      plan.players,
      plan.player,
      JACE_HELD_COLUMN,
      plan.held - 1,
    );
    return;
  }
  for (const row of [plan.packRow, ...plan.jaceRows]) {
    await sheet.invalidatePoolChange(
      row[ROWNUM],
      `${row.Comment?.trim() ?? ""} — ${UNDONE_TAG}`,
      plan.priorFullPool ?? "",
    );
  }
  await markMirroredUndelivered(sheet, plan.mirrored);
  await setJaceCell(
    sheet,
    plan.players,
    plan.player,
    JACE_LOYALTY_COLUMN,
    plan.loyaltyTo,
  );
  await setJaceCell(sheet, plan.players, plan.player, JACE_PENDING_COLUMN, "");
}

function publicNote(discordId: string, plan: HeldUndo | PackUndo): string {
  if (plan.kind === "held") {
    return `League Committee removed one of <@${discordId}>'s held comeback packs (misreported loss).`;
  }
  return [
    `League Committee undid <@${discordId}>'s Fracture pack #${plan.packNumber} (misreported loss).`,
    plan.jaceCost > 0
      ? `Jace −${plan.jaceCost} on that pack was reversed. Jace's loyalty is now **${plan.loyaltyTo}**.`
      : `Jace's loyalty is now **${plan.loyaltyTo}**.`,
  ].join(" ");
}

/**
 * `!undoloss @player` — League Committee only, in bot-bunker. Shows what
 * undoing the player's latest loss would change, with Confirm / Cancel buttons.
 */
export const undoLossHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "!undoloss") return;
  handle.claim();

  if (message.channelId !== CONFIG.BOT_BUNKER_CHANNEL_ID) {
    await message.reply("`!undoloss` only works in bot-bunker.");
    return;
  }
  if (!await isLeagueCommittee(message.client, message.author.id)) {
    await message.reply("Only League Committee can use `!undoloss`.");
    return;
  }
  const targetId = parts[1] ? resolveDiscordId(parts[1]) : null;
  if (!targetId) {
    await message.reply("Usage: `!undoloss @player`");
    return;
  }

  try {
    const plan = await planUndo(await resolveFraSheet(), targetId);
    if ("error" in plan) {
      await message.reply({
        content: plan.error,
        allowedMentions: { parse: [] },
      });
      return;
    }
    const row = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
      new djs.ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}:${targetId}:${plan.token}`)
        .setLabel("Confirm undo")
        .setStyle(djs.ButtonStyle.Danger),
      new djs.ButtonBuilder()
        .setCustomId(`${CANCEL_PREFIX}:${targetId}`)
        .setLabel("Cancel")
        .setStyle(djs.ButtonStyle.Secondary),
    );
    await message.reply({
      content: describePlan(plan),
      components: [row],
      allowedMentions: { parse: [] },
    });
  } catch (e) {
    console.error(`[fra] !undoloss failed for ${targetId}:`, e);
    await message.reply(
      `Couldn't plan the undo: ${e instanceof Error ? e.message : e}`,
    );
  }
};

/**
 * Confirm / Cancel buttons from `!undoloss`. Re-plans under the roll lock and
 * only proceeds if nothing changed since the summary was posted.
 */
export const undoLossInteractionHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton()) return;
  const [prefix, discordId, token] = interaction.customId.split(":");
  if (prefix !== CONFIRM_PREFIX && prefix !== CANCEL_PREFIX) return;
  handle.claim();

  if (
    interaction.channelId !== CONFIG.BOT_BUNKER_CHANNEL_ID ||
    !await isLeagueCommittee(interaction.client, interaction.user.id)
  ) {
    await interaction.reply({
      content: "Only League Committee can use these buttons.",
      ephemeral: true,
    });
    return;
  }
  if (prefix === CANCEL_PREFIX) {
    await interaction.update({ components: [] });
    await interaction.followUp({ content: "Cancelled; nothing was changed." });
    return;
  }

  await interaction.update({ components: [] });
  let result: string;
  try {
    const sheet = await resolveFraSheet();
    using _ = await fraRollLock();
    const plan = await planUndo(sheet, discordId);
    if ("error" in plan) {
      result = `Nothing undone: ${plan.error}`;
    } else if (plan.token !== token) {
      result =
        "Nothing undone: their pool or Jace state changed since this summary was posted. Run `!undoloss` again.";
    } else {
      await executeUndo(sheet, plan);
      result = `Done. ${publicNote(discordId, plan)}`;
      try {
        const packGen = await interaction.client.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        );
        if (packGen instanceof djs.TextChannel) {
          await packGen.send(publicNote(discordId, plan));
        }
      } catch (e) {
        console.error("[fra] Failed to post !undoloss note:", e);
      }
    }
  } catch (e) {
    console.error(`[fra] !undoloss failed partway for ${discordId}:`, e);
    result = `Undo failed partway: ${
      e instanceof Error ? e.message : e
    }. Check Pool Changes, Mirrored Cards and the Player Database.`;
  }
  await interaction.followUp({
    content: result,
    allowedMentions: { parse: [] },
  });
};
