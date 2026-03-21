import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import { CONFIG } from "../../config.ts";
import { ScryfallCard, searchCards, tileCardImages } from "../../scryfall.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "../../sealeddeck.ts";
import { addPoolChange, getPoolChanges, getPlayers, ROWNUM } from "../../standings.ts";
import {
  decrementMutagenTokens,
  getMutagenTokens,
  getPoolPendingRows,
  markPoolPendingCompleted,
  markPoolPendingDMedForPacks,
} from "./standings-tmt.ts";

/**
 * Posts the final match pack link and card image to the pack-generation channel.
 * Call this after the player has chosen to mutate or not.
 */
export async function postFinalMatchPackToPackGeneration(
  client: djs.Client,
  discordId: string,
  poolId: string,
  mutated: boolean,
): Promise<void> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel | null;
    if (!channel?.isSendable()) return;

    const packLink = `https://sealeddeck.tech/${poolId}`;
    const mutationNote = mutated ? "mutated" : "did not mutate";
    const content = `<@${discordId}> ${mutationNote} their pack: ${packLink}`;
    const files: djs.AttachmentBuilder[] = [];

    const pool = await fetchSealedDeck(poolId);
    const entries = [
      ...pool.sideboard,
      ...(pool.deck ?? []),
      ...(pool.hidden ?? []),
    ];
    const expanded = expandEntries(entries);
    const scryfallCards: ScryfallCard[] = [];
    for (const entry of expanded) {
      const card = await getScryfallCard(entry.name, entry.set);
      if (card) scryfallCards.push(card);
    }
    if (scryfallCards.length > 0) {
      try {
        const tiledBlob = await tileCardImages(scryfallCards, "small");
        const buffer = Buffer.from(await tiledBlob.arrayBuffer());
        files.push(
          new djs.AttachmentBuilder(buffer, {
            name: "pack.png",
            description: "Pack cards",
          }),
        );
      } catch (e) {
        console.error("[pool-dm] Error tiling match pack for pack-gen:", e);
      }
    }

    await channel.send({
      content,
      files: files.length > 0 ? files : undefined,
    });
  } catch (e) {
    console.error("[pool-dm] Failed to post final match pack to pack-generation:", e);
  }
}

/** Pack info for DM display */
export interface PackInfo {
  poolId: string;
  packEntries: readonly SealedDeckEntry[];
}

/** Selection state for mutate dropdown: userId:messageId -> { playerName, selectedPoolId, poolIds } */
const mutateSelection = new Map<
  string,
  { selectedPoolId: string }
>();

/** Pending mutations: mutationChannelMessageId (our message) -> { userId, playerName, originalPoolId, dmChannelId, poolIds, isMatchPack } */
const pendingMutations = new Map<
  string,
  {
    userId: string;
    playerName: string;
    originalPoolId: string;
    dmChannelId: string;
    rowNum: number;
    isMatchPack?: boolean;
  }
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
      "**Select a pack and click Mutate** to send it for mutation.",
    components: [selectRow, buttonRow],
  });

  const key = `${discordId}:${dropdownMsg.id}`;
  mutateSelection.set(key, {
    selectedPoolId: packs[0]?.poolId ?? ""
  });

  await markPoolPendingDMedForPacks(playerName, packs.map((p) => p.poolId));
}

/**
 * Sends only the dropdown + Mutate button (no pack images).
 * Used when resending for remaining packs after the user has already seen them.
 * Pack numbers are preserved from the original 6 (e.g. if Pack 4 was mutated, choices show Pack 1, 2, 3, 5, 6).
 */
export async function sendPackDropdownOnly(
  client: djs.Client,
  discordId: string,
  playerName: string,
  poolIdToPackNumber: { poolId: string; packNumber: number }[],
): Promise<void> {
  const user = await client.users.fetch(discordId);
  if (!user) return;

  const dmChannel = await user.createDM();

  const options = poolIdToPackNumber.map(({ poolId, packNumber }) => ({
    label: `Pack ${packNumber}`,
    value: poolId,
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
      "**Select a pack and click Mutate** to send it for mutation.",
    components: [selectRow, buttonRow],
  });

  const poolIds = poolIdToPackNumber.map((p) => p.poolId);
  const key = `${discordId}:${dropdownMsg.id}`;
  mutateSelection.set(key, {
    selectedPoolId: poolIds[0] ?? "",
  });

  await markPoolPendingDMedForPacks(playerName, poolIds);
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
    .setCustomId(MATCH_PACK_YES_BTN + ":" + pack.poolId)
    .setLabel("YES")
    .setStyle(djs.ButtonStyle.Success);
  const noBtn = new djs.ButtonBuilder()
    .setCustomId(MATCH_PACK_NO_BTN + ":" + pack.poolId)
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

  console.log(`[pool-dm] Sent ${user.username} ${user.tag} ${msg.url}`)
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
  mutateSelection.set(key, { selectedPoolId });

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

  const { selectedPoolId } = state;
  if (!selectedPoolId) {
    await interaction.reply({
      content: "Please select a pack from the dropdown first.",
      ephemeral: true,
    });
    return true;
  }

  const players = await getPlayers();
  const player = players.rows.find(p => p["Discord ID"] === interaction.user.id);
  if (!player) {
    await interaction.reply({
      content: `Could not find ${interaction.user.tag} in the league spreadsheet.`,
      ephemeral: true
    });
    return true;
  }

  const playerName = player.Identification;

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
  if (!interaction.customId.startsWith(MATCH_PACK_YES_BTN)) return false;

  const [, poolId] = interaction.customId.split(":");
  // deferUpdate is called by parent handler for match pack buttons

  // Remove buttons immediately to prevent double-clicks
  await interaction.editReply({
    content: interaction.message.content,
    components: [],
  });

  const players = await getPlayers();
  const player = players.rows.find(p => p["Discord ID"] === interaction.user.id);
  if (!player) {
    await interaction.followUp({
      content: `Could not find ${interaction.user.tag} in the league spreadsheet.`,
      ephemeral: true
    });
    return true;
  }

  const playerName = player.Identification;

  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === poolId);
  if (!row) {
    await interaction.followUp({
      content:
        `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    return true;
  }

  const tokens = await getMutagenTokens(playerName);
  if (tokens <= 0) {
    await interaction.reply({
      content:
        `You don't have any mutagen tokens! Click NO to accept the pack as-is.`,
      ephemeral: true,
    });
    return true;
  }

  const channel = await interaction.client.channels.fetch(
    mutationChannelId,
  ) as djs.TextChannel;
  if (!channel?.isSendable()) {
    await interaction.followUp({
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
    rowNum: row[ROWNUM],
    isMatchPack: true,
  });

  await decrementMutagenTokens(playerName);

  await interaction.followUp({
    content: "You threw the pack into the Ooze!",
  });

  return true;
}

/**
 * Records a match reward pack (with or without mutation) to Pool Changes
 * and announces it to pack-generation.
 */
export async function recordMatchPackNoMutation(
  client: djs.Client,
  playerName: string,
  discordId: string,
  poolId: string,
  rowNum: number,
): Promise<void> {
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
  await markPoolPendingCompleted(rowNum);
  await postFinalMatchPackToPackGeneration(
    client,
    discordId,
    poolId,
    false,
  );
}

/**
 * Handles match pack NO button: add pack to Pool Changes as-is, remove from Pool Pending.
 */
export async function handleMatchPackNo(
  interaction: djs.ButtonInteraction,
): Promise<boolean> {
  if (!interaction.customId.startsWith(MATCH_PACK_NO_BTN)) return false;
  const [, poolId] = interaction.customId.split(":");
  // deferUpdate is called by parent handler for match pack buttons

  // Remove buttons immediately to prevent double-clicks
  await interaction.editReply({
    content: interaction.message.content,
    components: [],
  });

  const players = await getPlayers();
  const player = players.rows.find(p => p["Discord ID"] === interaction.user.id);
  if (!player) {
    await interaction.followUp({
      content: `Could not find ${interaction.user.tag} in the league spreadsheet.`,
      ephemeral: true,
    });
    return true;
  }

  const playerName = player.Identification;

  const pendingRows = await getPoolPendingRows(playerName);
  const row = pendingRows.find((r) => r.Value === poolId);
  if (!row) {
    await interaction.followUp({
      content:
        `Could not find that pack in Pool Pending for **${playerName}**.`,
      ephemeral: true,
    });
    return true;
  }

  await recordMatchPackNoMutation(
    interaction.client,
    playerName,
    interaction.user.id,
    poolId,
    row[ROWNUM],
  );

  await interaction.followUp({
    content: "✅ Pack recorded without mutation.",
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

  if (isMatchPack) {
    await postFinalMatchPackToPackGeneration(
      message.client,
      userId,
      newPoolId,
      true,
    );
  }

  const poolChanges = await getPoolChanges();
  const userChanges = poolChanges.rows.filter((r) => r.Name === playerName);
  const count = userChanges.length;

  const dmChannel = await message.client.channels.fetch(dmChannelId) as
    | djs.DMChannel
    | null;
  if (dmChannel?.isSendable()) {
    const mutatedPackLink = `https://sealeddeck.tech/${newPoolId}`;
    if (count < 2) {
      // Send dropdown only for remaining packs (user has already seen the pack images)
      const remaining = await getPoolPendingRows(playerName);
      if (remaining.length > 0) {
        // Preserve original pack numbers (e.g. if Pack 4 was mutated, show Pack 1, 2, 3, 5, 6)
        const allRownums = [
          ...remaining.map((r) => r[ROWNUM]),
          rowNum,
        ].sort((a, b) => a - b);
        const poolIdToPackNumber = remaining.map((r) => ({
          poolId: r.Value,
          packNumber: allRownums.indexOf(r[ROWNUM]) + 1,
        }));
        await dmChannel.send(
          `Mutated pack: ${mutatedPackLink} Please select another pack to mutate.`,
        );
        await sendPackDropdownOnly(
          message.client,
          userId,
          playerName,
          poolIdToPackNumber,
        );
      } else {
        await dmChannel.send(
          `Mutated pack: ${mutatedPackLink}`,
        );
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
        `Mutated pack: ${mutatedPackLink}\n\nFull pool: ${fullPoolLink}`,
      );
    }
  }

  return true;
}
