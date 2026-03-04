import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "../../sealeddeck.ts";
import { addPoolChange, getPoolChanges, ROWNUM } from "../../standings.ts";
import {
  decrementMutagenTokens,
  getPoolPendingRows,
  markPoolPendingCompleted,
  markPoolPendingDMedForPacks,
} from "./standings-tmt.ts";

/** Pack info for DM display */
export interface PackInfo {
  poolId: string;
  packEntries: readonly SealedDeckEntry[];
}

/** Selection state for mutate dropdown: userId:messageId -> { playerName, selectedPoolId, poolIds } */
const mutateSelection = new Map<
  string,
  { playerName: string; selectedPoolId: string; poolIds: string[] }
>();

/** Pending mutations: mutationChannelMessageId (our message) -> { userId, playerName, originalPoolId, dmChannelId, poolIds, isMatchPack } */
const pendingMutations = new Map<
  string,
  {
    userId: string;
    playerName: string;
    originalPoolId: string;
    dmChannelId: string;
    poolIds: string[];
    rowNum: number;
    isMatchPack?: boolean;
  }
>();

/** Pending match pack choices: userId:messageId -> { playerName, poolId } */
const pendingMatchPackChoices = new Map<
  string,
  { playerName: string; poolId: string }
>();

const MUTATE_SELECT_CUSTOM_ID = "tmt-mutate-select";
const MUTATE_BTN_CUSTOM_ID = "tmt-mutate-btn";
const MATCH_PACK_YES_BTN = "tmt-matchpack-yes";
const MATCH_PACK_NO_BTN = "tmt-matchpack-no";

async function getScryfallCard(
  name: string,
  set?: string,
): Promise<ScryfallCard | null> {
  const setFilter = set ? ` set:${set.toLowerCase()}` : "";
  const query = `!"${name.replace(/"/g, '\\"')}"${setFilter} game:arena`;
  const results = await searchCards(query, { unique: "cards" });
  return results[0] ?? null;
}

/**
 * Computes the Full Pool ID: either the pack ID if first, or a new merged pool.
 */
export async function computeFullPool(
  previousFullPoolId: string | null | undefined,
  newPackId: string,
): Promise<string> {
  if (!previousFullPoolId) return newPackId;
  const [prev, pack] = await Promise.all([
    fetchSealedDeck(previousFullPoolId),
    fetchSealedDeck(newPackId),
  ]);
  const allEntries = [
    ...prev.sideboard,
    ...(prev.deck ?? []),
    ...(prev.hidden ?? []),
    ...pack.sideboard,
    ...(pack.deck ?? []),
    ...(pack.hidden ?? []),
  ];
  return await makeSealedDeck({ sideboard: allEntries });
}

function expandEntries(entries: readonly SealedDeckEntry[]): SealedDeckEntry[] {
  const expanded: SealedDeckEntry[] = [];
  for (const entry of entries) {
    for (let i = 0; i < (entry.count ?? 1); i++) {
      expanded.push({
        name: entry.name,
        count: 1,
        set: entry.set,
      });
    }
  }
  return expanded;
}

/**
 * Sends DM pack summaries (images + links) and a 7th message with dropdown + Mutate button.
 */
export async function sendPackDMs(
  client: djs.Client,
  discordId: string,
  playerName: string,
  packs: PackInfo[],
): Promise<void> {
  const user = await client.users.fetch(discordId);
  if (!user) return;

  // Ensure DM channel exists
  const dmChannel = await user.createDM();

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i];
    const packNum = i + 1;
    const packLink = `https://sealeddeck.tech/${pack.poolId}`;

    // Look up Scryfall cards for tiling
    const expanded = expandEntries(pack.packEntries);
    const scryfallCards: ScryfallCard[] = [];
    for (const entry of expanded) {
      const card = await getScryfallCard(entry.name, entry.set);
      if (card) scryfallCards.push(card);
    }

    try {
      if (scryfallCards.length > 0) {
        const tiledBlob = await tileCardImages(scryfallCards, "small");
        const buffer = Buffer.from(await tiledBlob.arrayBuffer());
        const attachment = new djs.AttachmentBuilder(buffer, {
          name: `pack${packNum}.png`,
          description: `Pack ${packNum} cards`,
        });
        await dmChannel.send({
          content: `**Pack ${packNum}**\n${packLink}`,
          files: [attachment],
        });
      } else {
        await dmChannel.send({
          content: `**Pack ${packNum}**\n${packLink}`,
        });
      }
    } catch (e) {
      console.error(`[pool-dm] Error sending pack ${packNum} DM:`, e);
      await dmChannel.send({
        content: `**Pack ${packNum}**\n${packLink}`,
      });
    }
  }

  // 7th message: dropdown + Mutate button
  const options = packs.map((p, i) => ({
    label: `Pack ${i + 1}`,
    value: p.poolId,
  }));

  const selectRow = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>()
    .addComponents(
      new djs.StringSelectMenuBuilder()
        .setCustomId(MUTATE_SELECT_CUSTOM_ID)
        .setPlaceholder("Choose a pack to mutate…")
        .addOptions(options),
    );

  const buttonRow = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    new djs.ButtonBuilder()
      .setCustomId(MUTATE_BTN_CUSTOM_ID)
      .setLabel("Mutate")
      .setStyle(djs.ButtonStyle.Primary),
  );

  const dropdownMsg = await dmChannel.send({
    content:
      "**Select a pack and click Mutate** to send it for mutation. Once you have 2 mutated packs in Pool Changes, the remaining packs will be added automatically.",
    components: [selectRow, buttonRow],
  });

  const key = `${discordId}:${dropdownMsg.id}`;
  mutateSelection.set(key, {
    playerName,
    selectedPoolId: packs[0]?.poolId ?? "",
    poolIds: packs.map((p) => p.poolId),
  });

  await markPoolPendingDMedForPacks(playerName, packs.map((p) => p.poolId));
}

/**
 * Sends a DM with a single pack image and "Do you want to mutate this pack?" YES/NO buttons.
 * Used for match reward packs.
 */
export async function sendMatchPackMutateDM(
  client: djs.Client,
  discordId: string,
  playerName: string,
  pack: PackInfo,
): Promise<void> {
  const user = await client.users.fetch(discordId);
  if (!user) return;

  // Mark DMed before sending so the minute listener doesn't double-send
  await markPoolPendingDMedForPacks(playerName, [pack.poolId]);

  const dmChannel = await user.createDM();
  const packLink = `https://sealeddeck.tech/${pack.poolId}`;

  const expanded = expandEntries(pack.packEntries);
  const scryfallCards: ScryfallCard[] = [];
  for (const entry of expanded) {
    const card = await getScryfallCard(entry.name, entry.set);
    if (card) scryfallCards.push(card);
  }

  const content =
    `**Match reward pack**\n${packLink}\n\nDo you want to mutate this pack?`;
  const files: djs.AttachmentBuilder[] = [];

  try {
    if (scryfallCards.length > 0) {
      const tiledBlob = await tileCardImages(scryfallCards, "small");
      const buffer = Buffer.from(await tiledBlob.arrayBuffer());
      files.push(
        new djs.AttachmentBuilder(buffer, {
          name: "pack.png",
          description: "Pack cards",
        }),
      );
    }
  } catch (e) {
    console.error("[pool-dm] Error tiling match pack:", e);
  }

  const yesBtn = new djs.ButtonBuilder()
    .setCustomId(MATCH_PACK_YES_BTN)
    .setLabel("YES")
    .setStyle(djs.ButtonStyle.Success);
  const noBtn = new djs.ButtonBuilder()
    .setCustomId(MATCH_PACK_NO_BTN)
    .setLabel("NO")
    .setStyle(djs.ButtonStyle.Secondary);
  const row = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    yesBtn,
    noBtn,
  );

  const msg = await dmChannel.send({
    content,
    files: files.length > 0 ? files : undefined,
    components: [row],
  });

  const key = `${discordId}:${msg.id}`;
  pendingMatchPackChoices.set(key, { playerName, poolId: pack.poolId });
}

/**
 * Handles the mutate select menu interaction (stores selection).
 */
export async function handleMutateSelect(
  interaction: djs.StringSelectMenuInteraction,
): Promise<boolean> {
  if (interaction.customId !== MUTATE_SELECT_CUSTOM_ID) return false;

  const selectedPoolId = interaction.values[0];
  if (!selectedPoolId) return true;

  const key = `${interaction.user.id}:${interaction.message.id}`;
  const state = mutateSelection.get(key);
  if (!state) return true;

  state.selectedPoolId = selectedPoolId;
  mutateSelection.set(key, state);

  await interaction.deferUpdate();
  return true;
}

/**
 * Handles the Mutate button: disables button, sends link to mutation channel, sets up listener.
 */
export async function handleMutateButton(
  interaction: djs.ButtonInteraction,
  mutationChannelId: string,
): Promise<boolean> {
  if (interaction.customId !== MUTATE_BTN_CUSTOM_ID) return false;

  const key = `${interaction.user.id}:${interaction.message.id}`;
  const state = mutateSelection.get(key);
  if (!state) {
    await interaction.reply({
      content: "Please select a pack first.",
      ephemeral: true,
    });
    return true;
  }

  const { playerName, selectedPoolId, poolIds } = state;
  if (!selectedPoolId) {
    await interaction.reply({
      content: "Please select a pack from the dropdown first.",
      ephemeral: true,
    });
    return true;
  }

  // Find the Pool Pending row for this pack (to get rowNum for deletion later)
  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === selectedPoolId);
  if (!row) {
    await interaction.reply({
      content:
        `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    return true;
  }

  const link = `https://sealeddeck.tech/${selectedPoolId}`;
  const channel = await interaction.client.channels.fetch(
    mutationChannelId,
  ) as djs.TextChannel;
  if (!channel?.isSendable()) {
    await interaction.reply({
      content: "Mutation channel not available.",
      ephemeral: true,
    });
    return true;
  }

  // Disable the Mutate button
  const disabledBtn = new djs.ActionRowBuilder<djs.ButtonBuilder>()
    .addComponents(
      new djs.ButtonBuilder()
        .setCustomId(MUTATE_BTN_CUSTOM_ID)
        .setLabel("Mutate")
        .setStyle(djs.ButtonStyle.Primary)
        .setDisabled(true),
    );
  await interaction.update({
    components: [interaction.message.components![0], disabledBtn],
  });

  const sentMessage = await channel.send(link);

  pendingMutations.set(sentMessage.id, {
    userId: interaction.user.id,
    playerName,
    originalPoolId: selectedPoolId,
    dmChannelId: interaction.channelId,
    poolIds: poolIds.filter((id) => id !== selectedPoolId),
    rowNum: row[ROWNUM],
  });

  mutateSelection.delete(key);

  await interaction.followUp({
    content: `You threw the pack into the Ooze!`,
    ephemeral: true,
  });

  return true;
}

/**
 * Handles match pack YES button: post to mutation channel, wait for result.
 */
export async function handleMatchPackYes(
  interaction: djs.ButtonInteraction,
  mutationChannelId: string,
): Promise<boolean> {
  if (interaction.customId !== MATCH_PACK_YES_BTN) return false;

  const key = `${interaction.user.id}:${interaction.message.id}`;
  const state = pendingMatchPackChoices.get(key);
  if (!state) return false;

  const { playerName, poolId } = state;
  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === poolId);
  if (!row) {
    await interaction.reply({
      content:
        `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    pendingMatchPackChoices.delete(key);
    return true;
  }

  const channel = await interaction.client.channels.fetch(
    mutationChannelId,
  ) as djs.TextChannel;
  if (!channel?.isSendable()) {
    await interaction.reply({
      content: "Mutation channel not available.",
      ephemeral: true,
    });
    return true;
  }

  const link = `https://sealeddeck.tech/${poolId}`;
  const sentMessage = await channel.send(link);

  pendingMutations.set(sentMessage.id, {
    userId: interaction.user.id,
    playerName,
    originalPoolId: poolId,
    dmChannelId: interaction.channelId,
    poolIds: [],
    rowNum: row[ROWNUM],
    isMatchPack: true,
  });
  pendingMatchPackChoices.delete(key);

  await decrementMutagenTokens(playerName);

  const disabledRow = new djs.ActionRowBuilder<djs.ButtonBuilder>()
    .addComponents(
      new djs.ButtonBuilder()
        .setCustomId(MATCH_PACK_YES_BTN)
        .setLabel("YES")
        .setStyle(djs.ButtonStyle.Success)
        .setDisabled(true),
      new djs.ButtonBuilder()
        .setCustomId(MATCH_PACK_NO_BTN)
        .setLabel("NO")
        .setStyle(djs.ButtonStyle.Secondary)
        .setDisabled(true),
    );
  await interaction.update({ components: [disabledRow] });
  await interaction.followUp({
    content: `You threw the pack into the Ooze!`,
    ephemeral: true,
  });

  return true;
}

/**
 * Handles match pack NO button: add pack to Pool Changes as-is, remove from Pool Pending.
 */
export async function handleMatchPackNo(
  interaction: djs.ButtonInteraction,
): Promise<boolean> {
  if (interaction.customId !== MATCH_PACK_NO_BTN) return false;

  const key = `${interaction.user.id}:${interaction.message.id}`;
  const state = pendingMatchPackChoices.get(key);
  if (!state) return false;

  const { playerName, poolId } = state;
  pendingMatchPackChoices.delete(key);

  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === poolId);
  if (!row) {
    await interaction.reply({
      content:
        `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    return true;
  }

  const existingChanges = (await getPoolChanges()).rows.filter(
    (r) => r.Name === playerName,
  );
  const lastFullPool = existingChanges.at(-1)?.["Full Pool"];
  const fullPoolId = await computeFullPool(lastFullPool, poolId);

  await addPoolChange(
    playerName,
    "add pack",
    poolId,
    "Match reward (no mutation)",
    fullPoolId,
  );
  await markPoolPendingCompleted(row[ROWNUM]);

  const disabledRow = new djs.ActionRowBuilder<djs.ButtonBuilder>()
    .addComponents(
      new djs.ButtonBuilder()
        .setCustomId(MATCH_PACK_YES_BTN)
        .setLabel("YES")
        .setStyle(djs.ButtonStyle.Success)
        .setDisabled(true),
      new djs.ButtonBuilder()
        .setCustomId(MATCH_PACK_NO_BTN)
        .setLabel("NO")
        .setStyle(djs.ButtonStyle.Secondary)
        .setDisabled(true),
    );
  await interaction.update({
    content:
      `${interaction.message.content}\n\n✅ Pack recorded without mutation.`,
    components: [disabledRow],
  });

  return true;
}

/**
 * Parses card names from message content or a text attachment.
 * Returns non-empty array of card names, or null if none found.
 */
async function parseCardListFromMessage(
  message: djs.Message,
): Promise<string[] | null> {
  const textParts: string[] = [];
  if (message.content?.trim()) textParts.push(message.content);
  const txtAttachment = message.attachments.find((a) =>
    /\.txt$/i.test(a.name ?? "")
  );
  if (txtAttachment?.url) {
    try {
      const resp = await fetch(txtAttachment.url);
      if (resp.ok) textParts.push(await resp.text());
    } catch {
      // ignore fetch errors
    }
  }
  const text = textParts.join("\n");
  const lines = text
    .replace(/```\w*\n?/g, "")
    .replace(/\n?```/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const skipPattern = /\b(sealeddeck|create|link|you may|here)\b/i;
  const cardNames = lines.filter(
    (l) =>
      l.length >= 2 &&
      l.length <= 100 &&
      !l.startsWith("http") &&
      !skipPattern.test(l),
  );
  return cardNames.length >= 5 ? cardNames : null;
}

/**
 * Handles a message in the mutation channel: if it is a reply to our pack message
 * and contains either a sealeddeck.tech link or a card list, process the mutation.
 */
export async function handleMutationChannelMessage(
  message: djs.Message,
): Promise<boolean> {
  const config = CONFIG as { TMT?: { MUTATION_CHANNEL_ID: string } };
  const mutationChannelId = config.TMT?.MUTATION_CHANNEL_ID;
  if (!mutationChannelId || message.channelId !== mutationChannelId) {
    return false;
  }

  const ref = message.reference?.messageId;
  if (!ref) return false;

  const pending = pendingMutations.get(ref);
  if (!pending) return false;

  let newPoolId: string | null = null;

  const linkRegex = /https:\/\/sealeddeck\.tech\/([a-zA-Z0-9_-]+)/;
  const linkMatch = message.content?.match(linkRegex) ??
    message.embeds.find((e) => e.url)?.url?.match(linkRegex);
  if (linkMatch) {
    newPoolId = linkMatch[1];
  } else {
    const cardNames = await parseCardListFromMessage(message);
    if (cardNames) {
      try {
        newPoolId = await makeSealedDeck({
          sideboard: cardNames.map((name) => ({ name })),
        });
      } catch (e) {
        console.error("Failed to create sealeddeck from card list:", e);
      }
    }
  }

  if (!newPoolId) return false;
  pendingMutations.delete(ref);

  const { userId, playerName, originalPoolId, dmChannelId, rowNum, isMatchPack } =
    pending;

  // Compute Full Pool: first pack = pack ID; otherwise merge with previous
  const existingChanges = (await getPoolChanges()).rows.filter(
    (r) => r.Name === playerName,
  );
  const lastFullPool = existingChanges.at(-1)?.["Full Pool"];
  const fullPoolId = await computeFullPool(lastFullPool, newPoolId);

  // Record in Pool Changes (mutated pack as add pack)
  await addPoolChange(
    playerName,
    "add pack",
    newPoolId,
    `Mutated from ${originalPoolId}`,
    fullPoolId,
  );

  await markPoolPendingCompleted(rowNum);

  const poolChanges = await getPoolChanges();
  const userChanges = poolChanges.rows.filter((r) => r.Name === playerName);
  const count = userChanges.length;

  const dmChannel = await message.client.channels.fetch(dmChannelId) as
    | djs.DMChannel
    | null;
  if (dmChannel?.isSendable()) {
    if (count < 2) {
      // Send new dropdown with remaining packs
      const remaining = await getPoolPendingRows(playerName);
      if (remaining.length > 0) {
        // We need packEntries to show images - but for the dropdown we only need poolId
        // We can fetch each pack from sealeddeck to get entries
        const { fetchSealedDeck } = await import("../../sealeddeck.ts");
        const packsWithEntries: PackInfo[] = [];
        for (const r of remaining) {
          try {
            const pool = await fetchSealedDeck(r.Value);
            const entries = [
              ...pool.sideboard,
              ...(pool.deck ?? []),
              ...(pool.hidden ?? []),
            ];
            packsWithEntries.push({ poolId: r.Value, packEntries: entries });
          } catch {
            packsWithEntries.push({ poolId: r.Value, packEntries: [] });
          }
        }
        await sendPackDMs(message.client, userId, playerName, packsWithEntries);
        await markPoolPendingDMedForPacks(
          playerName,
          packsWithEntries.map((p) => p.poolId),
        );
        await dmChannel.send(
          `✅ Pack recorded! Select another pack to mutate.`,
        );
      } else {
        await dmChannel.send(`✅ Pack recorded!`);
      }
    } else {
      // >= 2 entries: move remaining Pool Pending to Pool Changes
      const remaining = await getPoolPendingRows(playerName);
      let currentFullPoolId = fullPoolId;
      for (const r of remaining) {
        currentFullPoolId = await computeFullPool(currentFullPoolId, r.Value);
        await addPoolChange(
          playerName,
          "add pack",
          r.Value,
          "Remaining from Pool Pending",
          currentFullPoolId,
        );
      }
      for (const r of remaining) {
        await markPoolPendingCompleted(r[ROWNUM]);
      }
      // Final entry: starting pool = the combined full pool (only for starting pool flow, not match packs)
      if (!isMatchPack) {
        await addPoolChange(
          playerName,
          "starting pool",
          currentFullPoolId,
          "Complete starting pool",
          currentFullPoolId,
        );
      }
      const fullPoolLink = `https://sealeddeck.tech/${currentFullPoolId}`;
      await dmChannel.send(
        `✅ Pack recorded! \n\nFull pool: ${fullPoolLink}`,
      );
    }
  }

  return true;
}
