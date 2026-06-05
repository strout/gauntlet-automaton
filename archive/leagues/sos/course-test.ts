import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";
import { Handler } from "../../dispatch.ts";
import { fetchRandomCardForQuery, ScryfallCard } from "../../scryfall.ts";
import {
  fetchSosCourses,
  formatSosCourseOptionLabel,
  SosCourseRow,
} from "./course-sheet.ts";

const SOS_COURSE_TEST_CMD = "!sos-course-test";

/** Select menu `customId` for the SOS course sheet test flow. */
export const SOS_COURSE_TEST_SELECT_CUSTOM_ID = "sos-course-test-select";

const MAX_SELECT_OPTIONS = 25;

const SOS_TEST_COMMAND_CHANNELS = new Set([
  CONFIG.STARTING_POOL_CHANNEL_ID,
  CONFIG.BOT_BUNKER_CHANNEL_ID,
]);

function cardGalleryImage(card: ScryfallCard): string | null {
  const direct = card.image_uris?.large ?? card.image_uris?.normal ??
    card.image_uris?.png;
  if (direct) return direct;
  const face = card.card_faces?.[0]?.image_uris;
  if (!face) return null;
  return face.large ?? face.normal ?? face.png ?? null;
}

function courseRollEmbed(
  row: SosCourseRow,
  card: ScryfallCard,
): djs.EmbedBuilder {
  const page = card.scryfall_uri ?? card.uri;
  const embed = new djs.EmbedBuilder()
    .setTitle(card.name)
    .setDescription(
      `Random card for **${formatSosCourseOptionLabel(row, 200)}**`,
    );
  if (page) embed.setURL(page);
  const img = cardGalleryImage(card);
  if (img) embed.setImage(img);
  return embed;
}

/**
 * `!sos-course-test` — League Committee; starting pools channel or bot bunker.
 * Replies with a select menu of courses from **Course Sheet**; choosing one rolls a random card.
 */
export const sosCourseTestMessageHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (!message.content.startsWith(SOS_COURSE_TEST_CMD)) return;
  handle.claim();

  if (!message.inGuild()) {
    await message.reply("Use this command in the league server.");
    return;
  }

  if (!message.channel.isTextBased() || message.channel.isDMBased()) {
    await message.reply("This command must be used in a server channel.");
    return;
  }

  if (!SOS_TEST_COMMAND_CHANNELS.has(message.channel.id)) {
    await message.reply(
      "Use this command in the starting pools channel or bot bunker.",
    );
    return;
  }

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(message.author.id);
    if (!member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) {
      await message.reply(
        "Only League Committee members can use this command.",
      );
      return;
    }
  } catch {
    await message.reply("Could not verify your roles.");
    return;
  }

  let courses: readonly SosCourseRow[];
  try {
    courses = await fetchSosCourses();
  } catch (e) {
    console.error("[SOS] course sheet read error:", e);
    await message.reply(
      `Failed to read Course Sheet: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return;
  }

  if (courses.length === 0) {
    await message.reply(
      "No courses with a resolvable Scryfall query were found on **Course Sheet**.",
    );
    return;
  }

  const slice = courses.slice(0, MAX_SELECT_OPTIONS);
  const truncated = courses.length > MAX_SELECT_OPTIONS;

  const options = slice.map((row, i) => ({
    label: formatSosCourseOptionLabel(row),
    value: String(i),
  }));

  const selectRow = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>()
    .addComponents(
      new djs.StringSelectMenuBuilder()
        .setCustomId(SOS_COURSE_TEST_SELECT_CUSTOM_ID)
        .setPlaceholder("Choose a course…")
        .addOptions(options),
    );

  try {
    await message.reply({
      content: truncated
        ? `Pick a course (showing first **${MAX_SELECT_OPTIONS}** of **${courses.length}** rows with a valid link):`
        : "Pick a course from the live **Course Sheet** (test):",
      components: [selectRow],
    });
  } catch (e) {
    console.error("[SOS] course test reply error:", e);
    await message.reply(
      `Could not post the menu: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};

export const sosCourseTestSelectHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== SOS_COURSE_TEST_SELECT_CUSTOM_ID) return;
  handle.claim();

  try {
    await interaction.deferUpdate();
  } catch (e) {
    console.error("[SOS] course test deferUpdate:", e);
    return;
  }

  const idx = parseInt(interaction.values[0] ?? "", 10);
  if (!Number.isFinite(idx) || idx < 0) {
    await interaction.editReply({
      content: "Invalid selection.",
      components: [],
      embeds: [],
    });
    return;
  }

  let courses: readonly SosCourseRow[];
  try {
    courses = await fetchSosCourses();
  } catch (e) {
    console.error("[SOS] course sheet read (select):", e);
    await interaction.editReply({
      content: "Could not reload the course list from the sheet.",
      components: [],
      embeds: [],
    });
    return;
  }

  const slice = courses.slice(0, MAX_SELECT_OPTIONS);
  const row = slice[idx];
  if (!row) {
    await interaction.editReply({
      content: "That course is no longer in range. Run the command again.",
      components: [],
      embeds: [],
    });
    return;
  }

  let card: ScryfallCard | null;
  try {
    card = await fetchRandomCardForQuery(row.scryfallQuery);
  } catch (e) {
    console.error("[SOS] course test random card:", e);
    await interaction.editReply({
      content: `Scryfall error: ${e instanceof Error ? e.message : String(e)}`,
      components: [],
      embeds: [],
    });
    return;
  }

  if (!card) {
    await interaction.editReply({
      content: `No card matched the Scryfall query for **${
        formatSosCourseOptionLabel(row, 200)
      }**.`,
      components: [],
      embeds: [],
    });
    return;
  }

  try {
    await interaction.editReply({
      content: null,
      components: [],
      embeds: [courseRollEmbed(row, card)],
    });
  } catch (e) {
    console.error("[SOS] course test editReply:", e);
  }
};
