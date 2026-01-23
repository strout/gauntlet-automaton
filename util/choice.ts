import * as djs from "discord.js";
import { Handler } from "../dispatch.ts";
import { CONFIG } from "../config.ts";
import { Buffer } from "node:buffer";

export function makeChoice<T extends unknown[]>(
  prefix: string,
  makeMessage: (
    ...args: T
    ) => Promise<
      {
        content: string;
        options: djs.APISelectMenuOption[];
        embeds?: djs.APIEmbed[];
        image?: string | Buffer;
        files?: (string | Buffer | djs.AttachmentBuilder)[];
      }
  >,
    onChoice: (
    chosen: string,
    interaction: djs.Interaction,
  ) => Promise<
    {
      result: "success" | "failure" | "try-again";
      content?: string;
      updatedOptions?: { value: string; label: string }[];
      image?: string | Buffer;
      files?: (string | Buffer | djs.AttachmentBuilder)[];
      embeds?: djs.APIEmbed[];
    }
  >,
): {
  sendChoice: (
    client: djs.Client,
    userId: djs.Snowflake,
    ...args: T
  ) => Promise<void>;
  responseHandler: Handler<djs.Interaction>;
} {
  const processingMessages = new Set<djs.Snowflake>();
  const sendChoice = async (
    client: djs.Client,
    userId: djs.Snowflake,
    ...args: T
  ): Promise<void> => {
    console.debug(`sendChoice called for userId: ${userId}`);
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    const dmChannel = await member.createDM();

    const { content, options, embeds, image, files } = await makeMessage(...args);

    const selectCustomId = `${prefix}:select`;
    const submitCustomId = `${prefix}:submit:null`;

    const selectMenu = new djs.StringSelectMenuBuilder()
      .setCustomId(selectCustomId)
      .setPlaceholder("Make a choice...")
      .addOptions(options);

    const submitButton = new djs.ButtonBuilder()
      .setCustomId(submitCustomId)
      .setLabel("Submit Choice")
      .setStyle(djs.ButtonStyle.Primary)
      .setDisabled(true);

    const actionRow = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>()
      .addComponents(selectMenu);
    const buttonRow = new djs.ActionRowBuilder<djs.ButtonBuilder>()
      .addComponents(submitButton);

    const allFiles = [...(files || [])];
    if (image) allFiles.push(image);

    await dmChannel.send({
      content: content,
      embeds: embeds,
      components: [actionRow, buttonRow],
      files: allFiles,
    });
  };

  const responseHandler: Handler<djs.Interaction> = async (
    interaction,
    handle,
  ) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
    console.debug(
      `responseHandler called for customId: ${interaction.customId}`,
    );

    const customId = interaction.customId;
    if (!customId.startsWith(prefix)) return;

    const parts = customId.split(":");
    console.debug(`CustomId parts: ${parts.join(", ")}`);

    const interactionType = parts[1];

    handle.claim();

    try {
      if (interaction.isStringSelectMenu() && interactionType === "select") {
        if (processingMessages.has(interaction.message.id)) {
          await interaction.reply({
            content: "Please wait for your previous choice to finish processing.",
            ephemeral: true,
          });
          return;
        }
        const selectedValue = interaction.values[0];
        console.debug(
          `Handling select menu interaction. Selected value: ${selectedValue}`,
        );

        const { selectMenu, submitButton, selectMenuRow, submitButtonRow } =
          parseComponents(interaction);

        console.debug("Selecting", interaction.values[0]);

        selectMenu.setOptions(selectMenu.options.map((opt) => ({
          ...opt.toJSON(),
          default: opt.toJSON().value === selectedValue,
        })));

        const newSubmitCustomId = `${prefix}:submit:${selectedValue}`;

        submitButton.setCustomId(newSubmitCustomId);
        submitButton.setDisabled(false);

        // Update the action rows with the modified components
        selectMenuRow.setComponents(selectMenu);
        submitButtonRow.setComponents(submitButton);

        await interaction.update({
          components: [selectMenuRow, submitButtonRow],
        });
      } else if (interaction.isButton() && interactionType === "submit") {
        if (processingMessages.has(interaction.message.id)) {
          await interaction.reply({
            content: "Your previous choice is still being processed.",
            ephemeral: true,
          });
          return;
        }

        const selectedValue = parts.slice(2).join(":");
        console.debug(
          `Handling submit button interaction. Selected value: ${selectedValue}`,
        );

        if (selectedValue === "null") {
          await interaction.reply({
            content: "Please select an option first.",
            ephemeral: true,
          });
          return;
        }

        processingMessages.add(interaction.message.id);
        try {
          const {
            submitButton,
            selectMenu,
            selectMenuRow,
            submitButtonRow,
          } = parseComponents(interaction);

          // Disable select menu and submit button
          selectMenu.setDisabled(true);
          selectMenuRow.setComponents(selectMenu);
          submitButton.setDisabled(true).setLabel("Processing...");
          submitButtonRow.setComponents(submitButton);

          await interaction.update({
            components: [selectMenuRow, submitButtonRow],
          });

          const choiceResult = await onChoice(
            selectedValue,
            interaction,
          );
          const { result, content: responseContent, updatedOptions, image, files, embeds } = choiceResult;
          console.debug(`onChoice result: ${result}`);
          let finalContent = responseContent ||
            `Your choice "${selectedValue}" was processed.`;

          const hasNewFiles = ("files" in choiceResult) || ("image" in choiceResult);
          const allFiles = [...(files || [])];
          if (image) allFiles.push(image);
          const filesArg = hasNewFiles ? allFiles : undefined;

          if (result === "failure") {
            finalContent = responseContent ||
              `There was an error processing your choice "${selectedValue}". Please try again.`;
             // Re-enable select menu and submit button on failure
            selectMenu.setDisabled(false);
            selectMenuRow.setComponents(selectMenu);
            submitButton.setDisabled(false).setLabel("Submit Choice");
            submitButtonRow.setComponents(submitButton);
            await interaction.editReply({
              content: finalContent,
              components: [selectMenuRow, submitButtonRow],
              files: filesArg,
            });
            return;
          } else if (result === "try-again") {
            finalContent = responseContent ||
              `Your choice "${selectedValue}" requires further action or failed temporarily. Please try again.`;

            // Re-enable select menu and submit button on try-again
            selectMenu.setDisabled(false);
            selectMenuRow.setComponents(selectMenu);
            if (updatedOptions) {
              selectMenu.setOptions(updatedOptions.map((opt) => ({
                ...opt,
                default: opt.value === selectedValue,
              })));
            } else {
              selectMenu.setOptions(selectMenu.options.map((opt) => ({
                ...opt.toJSON(),
                default: opt.toJSON().value === selectedValue,
              })));
            }
            submitButton.setCustomId(
              `${prefix}:submit:${selectedValue}`,
            );
            submitButton.setDisabled(false).setLabel("Submit Choice");
            submitButtonRow.setComponents(submitButton);

            await interaction.editReply({
              content: finalContent,
              components: [selectMenuRow, submitButtonRow],
              files: filesArg,
            });
            return;
          }

          // If success, clear all components and files (unless new files provided or explicitly omitted)
          await interaction.editReply({
            content: finalContent,
            components: [],
            embeds: embeds,
            files: filesArg,
          });
        } finally {
          processingMessages.delete(interaction.message.id);
        }
      }
    } catch (error) {
      console.error(`Error in ${prefix} choice handler:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "An unexpected error occurred.",
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: "An unexpected error occurred.",
        });
      }
    }
  };

  return { sendChoice, responseHandler };

  function parseComponents(
    interaction: djs.MessageComponentInteraction<djs.CacheType>,
  ) {
    console.debug("parseComponents called.");
    const selectMenuRow: djs.ActionRowBuilder<
      djs.StringSelectMenuBuilder
    > = djs.ActionRowBuilder.from(
      (interaction.message.components[0] as djs.ActionRow<
        djs.StringSelectMenuComponent
      >).toJSON(),
    );
    const submitButtonRow: djs.ActionRowBuilder<djs.ButtonBuilder> = djs
      .ActionRowBuilder.from(
        (interaction.message.components[1] as djs.ActionRow<
          djs.ButtonComponent
        >)
          .toJSON(),
      );

    const selectMenu = djs.StringSelectMenuBuilder.from(
      selectMenuRow.components[0],
    );
    const submitButton = djs.ButtonBuilder.from(
      submitButtonRow.components[0],
    );
    return { selectMenu, submitButton, selectMenuRow, submitButtonRow };
  }
}
