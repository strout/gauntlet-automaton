import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "../../sealeddeck.ts";
import {
  addPoolChange,
  deletePoolPendingRow,
  getPoolChanges,
  getPoolPendingRows,
  ROWNUM,
} from "../../standings.ts";

/** Pack info for DM display */
export interface PackInfo {
  poolId: string;
  packEntries: readonly SealedDeckEntry[];
}

/** Selection state for mutate dropdown: userId:messageId -> { playerName, selectedPoolId, poolIds } */
const mutateSelection = new Map<string, { playerName: string; selectedPoolId: string; poolIds: string[] }>();

/** Pending mutations: mutationChannelMessageId (our message) -> { userId, playerName, originalPoolId, dmChannelId, poolIds } */
const pendingMutations = new Map<
  string,
  { userId: string; playerName: string; originalPoolId: string; dmChannelId: string; poolIds: string[]; rowNum: number }
>();

const MUTATE_SELECT_CUSTOM_ID = "tmt-mutate-select";
const MUTATE_BTN_CUSTOM_ID = "tmt-mutate-btn";

async function getScryfallCard(name: string, set?: string): Promise<ScryfallCard | null> {
  const setFilter = set ? ` set:${set.toLowerCase()}` : "";
  const query = `!"${name.replace(/"/g, '\\"')}"${setFilter} game:arena`;
  const results = await searchCards(query, { unique: "cards" });
  return results[0] ?? null;
}

/**
 * Computes the Full Pool ID: either the pack ID if first, or a new merged pool.
 */
async function computeFullPool(
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

  const selectRow = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
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
    content: "**Select a pack and click Mutate** to send it for mutation. Once you have 2 mutated packs in Pool Changes, the remaining packs will be added automatically.",
    components: [selectRow, buttonRow],
  });

  const key = `${discordId}:${dropdownMsg.id}`;
  mutateSelection.set(key, {
    playerName,
    selectedPoolId: packs[0]?.poolId ?? "",
    poolIds: packs.map((p) => p.poolId),
  });
}

/**
 * Handles the mutate select menu interaction (stores selection).
 */
export async function handleMutateSelect(interaction: djs.StringSelectMenuInteraction): Promise<boolean> {
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
    await interaction.reply({ content: "Please select a pack first.", ephemeral: true });
    return true;
  }

  const { playerName, selectedPoolId, poolIds } = state;
  if (!selectedPoolId) {
    await interaction.reply({ content: "Please select a pack from the dropdown first.", ephemeral: true });
    return true;
  }

  // Find the Pool Pending row for this pack (to get rowNum for deletion later)
  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === selectedPoolId);
  if (!row) {
    await interaction.reply({
      content: `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    return true;
  }

  const link = `https://sealeddeck.tech/${selectedPoolId}`;
  const channel = await interaction.client.channels.fetch(mutationChannelId) as djs.TextChannel;
  if (!channel?.isSendable()) {
    await interaction.reply({ content: "Mutation channel not available.", ephemeral: true });
    return true;
  }

  // Disable the Mutate button
  const disabledBtn = new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
    new djs.ButtonBuilder()
      .setCustomId(MUTATE_BTN_CUSTOM_ID)
      .setLabel("Mutate")
      .setStyle(djs.ButtonStyle.Primary)
      .setDisabled(true),
  );
  await interaction.update({ components: [interaction.message.components![0], disabledBtn] });

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
    content: `Sent pack to mutation channel. Waiting for response…`,
    ephemeral: true,
  });

  return true;
}

/**
 * Parses card names from message content or a text attachment.
 * Returns non-empty array of card names, or null if none found.
 */
async function parseCardListFromMessage(message: djs.Message): Promise<string[] | null> {
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
export async function handleMutationChannelMessage(message: djs.Message): Promise<boolean> {
  const config = CONFIG as { TMT?: { MUTATION_CHANNEL_ID: string } };
  const mutationChannelId = config.TMT?.MUTATION_CHANNEL_ID;
  if (!mutationChannelId || message.channelId !== mutationChannelId) return false;

  const ref = message.reference?.messageId;
  if (!ref) return false;

  const pending = pendingMutations.get(ref);
  if (!pending) return false;

  let newPoolId: string | null = null;

  const linkRegex = /https:\/\/sealeddeck\.tech\/([a-zA-Z0-9_-]+)/;
  const linkMatch =
    message.content?.match(linkRegex) ??
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

  const { userId, playerName, originalPoolId, dmChannelId, poolIds, rowNum } = pending;

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

  // Remove from Pool Pending
  await deletePoolPendingRow(rowNum);

  const poolChanges = await getPoolChanges();
  const userChanges = poolChanges.rows.filter((r) => r.Name === playerName);
  const count = userChanges.length;

  const dmChannel = await message.client.channels.fetch(dmChannelId) as djs.DMChannel | null;
  if (dmChannel?.isSendable()) {
    if (count < 2) {
      // Send new dropdown with remaining packs
      const remaining = await getPoolPendingRows(playerName);
      if (remaining.length > 0) {
        const packs: PackInfo[] = remaining.map((r) => ({
          poolId: r.Value,
          packEntries: [], // We don't have pack entries here - fetch from sealeddeck
        }));
        // We need packEntries to show images - but for the dropdown we only need poolId
        // We can fetch each pack from sealeddeck to get entries
        const { fetchSealedDeck } = await import("../../sealeddeck.ts");
        const packsWithEntries: PackInfo[] = [];
        for (const r of remaining) {
          try {
            const pool = await fetchSealedDeck(r.Value);
            const entries = [...pool.sideboard, ...(pool.deck ?? []), ...(pool.hidden ?? [])];
            packsWithEntries.push({ poolId: r.Value, packEntries: entries });
          } catch {
            packsWithEntries.push({ poolId: r.Value, packEntries: [] });
          }
        }
        await sendPackDMs(message.client, userId, playerName, packsWithEntries);
        await dmChannel.send(`✅ Pack recorded! Select another pack to mutate.`);
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
      // Delete in reverse order (highest row first) to avoid row number shifting
      const sorted = [...remaining].sort((a, b) => b[ROWNUM] - a[ROWNUM]);
      for (const r of sorted) {
        await deletePoolPendingRow(r[ROWNUM]);
      }
      // Final entry: starting pool = the combined full pool
      await addPoolChange(
        playerName,
        "starting pool",
        currentFullPoolId,
        "Complete starting pool",
        currentFullPoolId,
      );
      const fullPoolLink = `https://sealeddeck.tech/${currentFullPoolId}`;
      await dmChannel.send(
        `✅ Pack recorded! \n\nFull pool: ${fullPoolLink}`,
      );
    }
  }

  return true;
}
