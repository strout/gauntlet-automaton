import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { upcomingSheet } from "../../standings.ts";
import { comebackPackById, packGenCommand } from "./comeback.ts";
import {
  buildMshOriginMessage,
  comebackMenuLabel,
  findPendingMshPool,
  lookupPlayerByDiscordId,
  MSH_ORIGIN_BLURBS,
  MSH_POOL_DONE_COMMENT,
  mshOriginPacks,
  mshPoolSelectCustomId,
  originComment,
  originMenuDescription,
  parseMshPoolDiscordId,
  ROWNUM,
  setHeroScore,
  updatePoolChangeComment,
} from "./msh-pool.ts";

export function buildMshOriginComponents(
  discordId: string,
  disabled = false,
): djs.ActionRowBuilder<djs.StringSelectMenuBuilder>[] {
  const options = mshOriginPacks().map((pack) => ({
    label: comebackMenuLabel(pack),
    value: pack.id,
    description: originMenuDescription(pack),
  }));

  return [
    new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
      new djs.StringSelectMenuBuilder()
        .setCustomId(mshPoolSelectCustomId(discordId))
        .setPlaceholder("Choose your path…")
        .addOptions(options)
        .setDisabled(disabled),
    ),
  ];
}

export const marvelMshPoolSelectHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu()) return;
  const discordId = parseMshPoolDiscordId(interaction.customId);
  if (!discordId) return;
  handle.claim();

  if (!upcomingSheet) {
    await interaction.reply({
      content: "Marvel league sheet is not configured.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.user.id !== discordId) {
    await interaction.reply({
      content: "This menu is not for you.",
      ephemeral: true,
    });
    return;
  }

  const sheet = upcomingSheet;
  const lookup = await lookupPlayerByDiscordId(sheet, discordId);
  if (!lookup) {
    await interaction.reply({
      content: "Could not find your player record.",
      ephemeral: true,
    });
    return;
  }

  const { player, heroScoreCol } = lookup;
  const poolChanges = await sheet.getPoolChanges();
  const pending = findPendingMshPool(poolChanges, player.Identification);
  if (!pending) {
    await interaction.reply({
      content: "This origin choice has expired or already been used.",
      ephemeral: true,
    });
    return;
  }

  const pack = comebackPackById(interaction.values[0]);
  if (!pack || !(pack.id in MSH_ORIGIN_BLURBS)) {
    await interaction.reply({
      content: "That path is not available.",
      ephemeral: true,
    });
    return;
  }

  await interaction.update({
    content: interaction.message.content + "\n\n_Generating your pack…_",
    components: buildMshOriginComponents(discordId, true),
  });

  try {
    const packGenChannel = await interaction.client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel;
    if (!packGenChannel) {
      throw new Error("Pack generation channel not found");
    }

    const sentMessage = await packGenChannel.send(
      packGenCommand(pack, discordId),
    );

    const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
    if ("error" in result) {
      throw new Error(result.error);
    }

    await sheet.recordPackAddition(
      player.Identification,
      result.success,
      originComment(pack),
    );

    if (heroScoreCol !== undefined) {
      await setHeroScore(
        sheet,
        player[ROWNUM],
        heroScoreCol,
        pack.heroScoreDelta,
      );
    }

    await updatePoolChangeComment(
      sheet,
      pending[ROWNUM],
      MSH_POOL_DONE_COMMENT,
    );

    const updatedChanges = await sheet.getPoolChanges();
    const poolLink = await sheet.getExpectedPool(
      player.Identification,
      updatedChanges,
    );

    const deltaNote = pack.heroScoreDelta !== 0
      ? ` Hero score is now **${
        pack.heroScoreDelta > 0 ? "+" : ""
      }${pack.heroScoreDelta}**.`
      : "";

    let poolLinkDmSent = false;
    try {
      const user = await interaction.client.users.fetch(discordId);
      await user.send(
        `Your Marvel starting pool is ready!\n\n**${pack.label} was your chosen origin pack.**\n\n${deltaNote}\n\n**Your pool:** ${poolLink}`,
      );
      poolLinkDmSent = true;
    } catch (e) {
      console.warn(`[marvel] Could not DM pool link to ${discordId}:`, e);
    }

    await interaction.editReply({
      content: interaction.message.content.replace(
        /\n\n_Generating your pack…_$/,
        "",
      ) +
        `\n\n✅ **${pack.label}** — your origin pack is in your pool.${deltaNote}` +
        (poolLinkDmSent
          ? " Check your DMs for your pool link."
          : `\n\n**Your pool:** ${poolLink}`),
      components: [],
    });
  } catch (e) {
    console.error("[Marvel mshpool] origin pack failed:", e);
    await interaction.followUp({
      content:
        "Something went wrong generating your origin pack. Please contact the league committee.",
    });
  }
};

export { buildMshOriginMessage };
