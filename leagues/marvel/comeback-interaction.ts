import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { waitForBoosterTutor } from "../../pending.ts";
import { ROWNUM, upcomingSheet } from "../../standings.ts";
import {
  comebackComment,
  comebackMenuDescription,
  comebackMenuLabel,
  ComebackOffers,
  formatHeroScore,
  isComebackAwaitingChoice,
  marvelMatchBotColumns,
  MarvelMatchRow,
  marvelPlayerExtras,
  MSH_PACK,
  PACK_CHOSEN_COLUMN,
  packGenCommand,
  parseOffersFromNotes,
  resolveOfferedPack,
  updateHeroScore,
} from "./comeback.ts";

export const MARVEL_COMEBACK_SELECT_ID = "marvel-comeback-select";

export function comebackSelectCustomId(matchRowNum: number): string {
  return `${MARVEL_COMEBACK_SELECT_ID}:${matchRowNum}`;
}

function parseMatchRowNum(customId: string): number | undefined {
  if (!customId.startsWith(`${MARVEL_COMEBACK_SELECT_ID}:`)) return undefined;
  const rowNum = Number.parseInt(customId.split(":")[1] ?? "", 10);
  return Number.isFinite(rowNum) ? rowNum : undefined;
}

export function buildComebackComponents(
  matchRowNum: number,
  offers: ComebackOffers,
  mshAvailable: boolean,
  disabled = false,
): djs.ActionRowBuilder<djs.StringSelectMenuBuilder>[] {
  const options: djs.APISelectMenuOption[] = [];
  if (mshAvailable) {
    options.push({
      label: comebackMenuLabel(MSH_PACK),
      value: MSH_PACK.id,
      description: comebackMenuDescription(MSH_PACK),
    });
  }
  options.push(
    {
      label: comebackMenuLabel(offers.heroPack),
      value: offers.heroPack.id,
      description: comebackMenuDescription(offers.heroPack),
    },
    {
      label: comebackMenuLabel(offers.villainPack),
      value: offers.villainPack.id,
      description: comebackMenuDescription(offers.villainPack),
    },
  );

  return [
    new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
      new djs.StringSelectMenuBuilder()
        .setCustomId(comebackSelectCustomId(matchRowNum))
        .setPlaceholder("What is your next step?")
        .addOptions(options)
        .setDisabled(disabled),
    ),
  ];
}

export const marvelComebackSelectHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu()) return;
  const matchRowNum = parseMatchRowNum(interaction.customId);
  if (matchRowNum === undefined) return;
  handle.claim();

  if (!upcomingSheet) {
    await interaction.reply({
      content: "Marvel league sheet is not configured.",
      ephemeral: true,
    });
    return;
  }

  const sheet = upcomingSheet;
  const announcer = getMatchAnnouncer(sheet, "marvel");

  const [players, matches] = await Promise.all([
    sheet.getPlayers(marvelPlayerExtras),
    sheet.getAllMatches(undefined, undefined, undefined, marvelMatchBotColumns),
  ]);

  const match = matches.rows.find((m) =>
    m.MATCHTYPE === "match" && m[ROWNUM] === matchRowNum
  ) as MarvelMatchRow | undefined;
  const packChosenCol = matches.headerColumns.match[PACK_CHOSEN_COLUMN];

  if (!match || !isComebackAwaitingChoice(match)) {
    await interaction.reply({
      content: "This comeback offer has expired or already been used.",
      ephemeral: true,
    });
    return;
  }

  const loserInfo = players.rows.find((p) =>
    p.Identification === match["Loser Name"]
  );
  if (!loserInfo || interaction.user.id !== loserInfo["Discord ID"]) {
    await interaction.reply({
      content: "This menu is not for you.",
      ephemeral: true,
    });
    return;
  }

  const parsedOffers = parseOffersFromNotes(match.Notes);
  if (!parsedOffers) {
    await interaction.reply({
      content:
        "Could not read pack offers for this match. Please contact the league committee.",
      ephemeral: true,
    });
    return;
  }

  const pack = resolveOfferedPack(
    parsedOffers.offers,
    parsedOffers.mshOffered,
    interaction.values[0],
  );
  if (!pack) {
    await interaction.reply({
      content: "That pack is not available.",
      ephemeral: true,
    });
    return;
  }

  await interaction.update({
    content: interaction.message.content + "\n\n_Generating your pack…_",
    components: buildComebackComponents(
      matchRowNum,
      parsedOffers.offers,
      parsedOffers.mshOffered,
      true,
    ),
  });

  try {
    const packGenChannel = await interaction.client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel;
    if (!packGenChannel) {
      throw new Error("Pack generation channel not found");
    }

    const sentMessage = await packGenChannel.send(
      packGenCommand(pack, loserInfo["Discord ID"]),
    );

    const result = await waitForBoosterTutor(Promise.resolve(sentMessage));
    if ("error" in result) {
      throw new Error(result.error);
    }

    await sheet.recordPackAddition(
      match["Loser Name"],
      result.success,
      comebackComment(pack),
    );

    const heroScoreCol = players.headerColumns["Hero Score"];
    const newHeroScore = (loserInfo["Hero Score"] ?? 0) + pack.heroScoreDelta;
    if (pack.heroScoreDelta !== 0 && heroScoreCol !== undefined) {
      await updateHeroScore(
        sheet,
        loserInfo[ROWNUM],
        heroScoreCol,
        loserInfo["Hero Score"] ?? 0,
        pack.heroScoreDelta,
      );
    }

    if (packChosenCol !== undefined) {
      await announcer.markMatchHandled(matchRowNum, packChosenCol, true);
    }

    await interaction.editReply({
      content: interaction.message.content.replace(
        /\n\n_Generating your pack…_$/,
        "",
      ) +
        `\n\n✅ **${pack.label}**. Hero score is now **${
          formatHeroScore(newHeroScore)
        }**. Check <#${CONFIG.PACKGEN_CHANNEL_ID}> for your cards.`,
      components: [],
    });
  } catch (e) {
    console.error("[Marvel comeback] pack generation failed:", e);
    await interaction.followUp({
      content:
        "Something went wrong generating your pack. Please contact the league committee.",
    });
  }
};
