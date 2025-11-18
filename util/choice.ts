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
      options: { value: string; label: string }[];
      image?: string | Buffer;
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
  const sendChoice = async (
    client: djs.Client,
    userId: djs.Snowflake,
    ...args: T
  ): Promise<void> => {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    const dmChannel = await member.createDM();

    const { content, options, image } = await makeMessage(...args);

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

    await dmChannel.send({
      content: content,
      components: [actionRow, buttonRow],
      files: image ? [image] : [],
    });
  };

  const responseHandler: Handler<djs.Interaction> = async (
    interaction,
    handle,
  ) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId.startsWith(prefix)) return;

    const parts = customId.split(":");

    const interactionType = parts[1];
    const _interactingUserId = interaction.user.id;

    handle.claim();

    try {
      if (interaction.isStringSelectMenu() && interactionType === "select") {
        const selectedValue = interaction.values[0];

        const selectMenuRow = djs.ActionRowBuilder.from(
          interaction.message.components[0]
            .toJSON() as djs.APIActionRowComponent<
              djs.APIStringSelectComponent
            >,
        ) as djs.ActionRowBuilder<djs.StringSelectMenuBuilder>;
        const submitButtonRow = djs.ActionRowBuilder.from(
          interaction.message.components[1]
            .toJSON() as djs.APIActionRowComponent<djs.APIButtonComponent>,
        ) as djs.ActionRowBuilder<djs.ButtonBuilder>;

        const selectMenu = djs.StringSelectMenuBuilder.from(
          selectMenuRow.components[0],
        );
        const submitButton = djs.ButtonBuilder.from(
          submitButtonRow.components[0],
        );

        selectMenu.setOptions(selectMenu.options.map((opt) => ({
          ...opt.toJSON(),
          default: opt.toJSON().value === selectedValue,
        })));

        const newSubmitCustomId = `${prefix}:submit:${selectedValue}`;

        submitButton.setCustomId(newSubmitCustomId);
        submitButton.setDisabled(false);

        await interaction.update({
          components: [selectMenuRow, submitButtonRow],
        });
      } else if (interaction.isButton() && interactionType === "submit") {
        const selectedValue = parts[2];

        if (selectedValue === "null") {
          await interaction.reply({
            content: "Please select an option first.",
            ephemeral: true,
          });
          return;
        }

        await interaction.deferUpdate();

        const { result, content: responseContent, updatedOptions, image } =
          await onChoice(
            selectedValue,
            interaction,
          );

        let finalContent = responseContent ||
          `Your choice "${selectedValue}" was processed.`;

        if (result === "failure") {
          finalContent = responseContent ||
            `There was an error processing your choice "${selectedValue}". Please try again.`;
        } else if (result === "try-again") {
          finalContent = responseContent ||
            `Your choice "${selectedValue}" requires further action or failed temporarily. Please try again.`;

          const selectMenuRow = djs.ActionRowBuilder.from(
            interaction.message.components[0]
              .toJSON() as djs.APIActionRowComponent<
                djs.APIStringSelectComponent
              >,
          ) as djs.ActionRowBuilder<djs.StringSelectMenuBuilder>;
          const submitButtonRow = djs.ActionRowBuilder.from(
            interaction.message.components[1]
              .toJSON() as djs.APIActionRowComponent<djs.APIButtonComponent>,
          ) as djs.ActionRowBuilder<djs.ButtonBuilder>;

          const selectMenu = djs.StringSelectMenuBuilder.from(
            selectMenuRow.components[0],
          );
          const submitButton = djs.ButtonBuilder.from(
            submitButtonRow.components[0],
          );

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
          submitButton.setDisabled(false);

          await interaction.editReply({
            content: finalContent,
            components: [selectMenuRow, submitButtonRow],
            files: image ? [image] : undefined,
          });
          return;
        }

        await interaction.editReply({
          content: finalContent,
          components: [],
          embeds: [],
          files: image ? [image] : undefined,
        });
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
}
