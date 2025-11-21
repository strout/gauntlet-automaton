import * as djs from "discord.js";
import { Handler } from "../dispatch.ts";
import {
  applyStatUpgrade,
  BoosterSlot,
  FINPlayerState,
  FINStat,
  getStateLock,
  playerStates,
  recordUpgrade,
  restoreSinglePlayerState,
} from "./state.ts";
import { generateAndSendPack } from "./packs.ts";
import { getPlayers } from "../standings.ts";

// Shared utilities
const STAT_EMOJIS: Record<FINStat, string> = {
  "HP": "❤️",
  "Magic": "🔮",
  "Evasion": "💨",
  "Speed": "⚡",
  "Strength": "💪",
};

const COLOR_OPTIONS = [
  { label: "White", value: "W", emoji: "⚪" },
  { label: "Blue", value: "U", emoji: "🔵" },
  { label: "Black", value: "B", emoji: "⚫" },
  { label: "Red", value: "R", emoji: "🔴" },
  { label: "Green", value: "G", emoji: "🟢" },
];

const COLOR_NAMES: Record<string, string> = {
  "W": "White",
  "U": "Blue",
  "B": "Black",
  "R": "Red",
  "G": "Green",
  "C": "Colorless",
};

function getStatEmoji(stat: FINStat): string {
  return STAT_EMOJIS[stat];
}

function getColorName(color: string): string {
  return COLOR_NAMES[color] || color;
}

const SPECIAL_NAMES: Record<FINStat, string> = {
  "HP": "Saga",
  "Magic": "Big Spell",
  "Evasion": "Surveil",
  "Speed": "Equipment",
  "Strength": "Town",
};

function describeSlot(slot: BoosterSlot, idx: number): string {
  const parts = [`Slot ${idx + 1}:`];
  if (slot.color) parts.push(COLOR_NAMES[slot.color]);
  if (slot.set) parts.push(slot.set);
  if (slot.rarity) parts.push(slot.rarity);
  if (slot.special) parts.push(SPECIAL_NAMES[slot.special]);
  return parts.join(" ");
}

// Selection menu builder utility
class MenuBuilder {
  static createSlotMenu(
    customId: string,
    placeholder: string,
    commonSlots: Array<{ slot: BoosterSlot; idx: number }>,
    selectedIndex?: number,
  ): djs.StringSelectMenuBuilder {
    const selectedSlot = selectedIndex !== undefined
      ? commonSlots.find((s) => s.idx === selectedIndex)
      : undefined;
    const menu = new djs.StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(
        selectedSlot !== undefined
          ? `${describeSlot(selectedSlot.slot, selectedSlot.idx)} selected`
          : placeholder,
      )
      .addOptions(commonSlots.map(({ slot, idx }) => ({
        label: describeSlot(slot, idx),
        value: idx.toString(),
        description: `Select this slot`,
        default: selectedIndex === idx,
      })));
    return menu;
  }

  static createColorMenu(
    customId: string,
    selectedColor?: string,
  ): djs.StringSelectMenuBuilder {
    return new djs.StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(
        selectedColor
          ? `${getColorName(selectedColor)} selected`
          : "Choose new color",
      )
      .addOptions(COLOR_OPTIONS.map((option) => ({
        ...option,
        default: selectedColor === option.value,
      })));
  }

  static createSubmitButton(customId: string): djs.ButtonBuilder {
    return new djs.ButtonBuilder()
      .setCustomId(customId)
      .setLabel("Apply")
      .setStyle(djs.ButtonStyle.Success)
      .setEmoji("✅");
  }
}

// Generic customization flow handler
interface CustomizationFlowConfig<T extends { selectedStat: FINStat }> {
  extractChoicesFromComponents: (components: djs.TopLevelComponent[]) => T;
  createMenus: (
    choices: T,
    upgradableStats: Array<{ stat: FINStat; level: number; nextLevel: number }>,
    commonSlots: Array<{ slot: BoosterSlot; idx: number }>,
  ) =>
    (djs.ActionRowBuilder<djs.StringSelectMenuBuilder | djs.ButtonBuilder>)[];
  formatContent: (
    choices: T,
    commonSlots: Array<{ slot: BoosterSlot; idx: number }>,
  ) => string;
  isComplete: (choices: T) => choices is Required<T>;
  updateChoice(choices: T, value: string, step: string): void;
  getSuccessMessage?: (choices: Required<T>) => string;
}

class CustomizationFlow<T extends { selectedStat: FINStat }> {
  private config: CustomizationFlowConfig<T>;

  constructor(config: CustomizationFlowConfig<T>) {
    this.config = config;
  }

  async handleInteraction(
    interaction: djs.StringSelectMenuInteraction | djs.ButtonInteraction,
  ) {
    const parts = interaction.customId.split("_");
    const isSubmit = interaction.isButton() && parts[1] === "submit";

    await interaction.deferUpdate();
    if (isSubmit) {
      return this.handleSubmit(interaction as djs.ButtonInteraction);
    } else {
      return this.handleSelection(
        interaction as djs.StringSelectMenuInteraction,
        parts[1],
      );
    }
  }

  private async handleSubmit(
    interaction: djs.ButtonInteraction,
  ) {
    console.log("Handling submit interaction:", interaction.customId);
    const state = playerStates.get(interaction.user.id);
    if (!state) {
      await interaction.editReply({
        content: "Player state not found.",
        components: [],
      });
      return;
    }

    // Extract choices from the current message components
    const message = interaction.message;
    const choices = this.config.extractChoicesFromComponents(
      message.components,
    );

    await this.updateMessage(interaction, state, choices, true);

    if (!this.config.isComplete(choices)) {
      await interaction.editReply({
        content:
          "Error occurred (selections incomplete). Please contact the league committee.",
        components: [],
      });
      return;
    }

    const stat = choices.selectedStat;
    const newLevel = ++state.stats[stat];
    // TODO extract this out into a flow-specific method
    if (newLevel === 2) {
      state.level2Choices[stat] =
        choices as unknown as typeof state.level2Choices[FINStat];
    } else if (newLevel === 3) {
      state.level3Choices[stat] =
        choices as unknown as typeof state.level3Choices[FINStat];
    }
    applyStatUpgrade(state, stat, newLevel);
    await recordUpgrade(state.playerName, stat, newLevel, choices);

    try {
      await generateAndSendPack(interaction.client, state, {
        stat,
        level: newLevel,
      });
    } catch (error) {
      console.error("Error generating pack:", error);
    }

    await interaction.editReply({
      content: this.getSuccessMessage(choices, newLevel),
      embeds: [],
      components: [],
    });
  }

  private async handleSelection(
    interaction: djs.StringSelectMenuInteraction,
    step: string,
  ) {
    const state = playerStates.get(interaction.user.id);
    if (!state) {
      await interaction.editReply({
        content: "Player state not found.",
        components: [],
      });
      return;
    }

    // Extract current choices from components, then update with new selection
    const message = interaction.message;
    const choices = this.config.extractChoicesFromComponents(
      message.components,
    );

    this.config.updateChoice(choices, interaction.values[0], step);

    await this.updateMessage(interaction, state, choices);
  }

  async updateMessage(
    interaction: djs.StringSelectMenuInteraction | djs.ButtonInteraction,
    state: FINPlayerState,
    choices?: T,
    submitButtonDisabled = false,
  ) {
    const upgradableStats = Object.entries(state.stats)
      .filter(([, level]) => level < 4)
      .map(([stat, level]) => ({
        stat: stat as FINStat,
        level,
        nextLevel: level + 1,
      }));

    const commonSlots = state.boosterSlots
      .map((slot, idx) => ({ slot, idx }))
      .filter(({ slot }) => slot.rarity === "common");

    // If choices not provided, extract from current components
    if (!choices) {
      const message = interaction.message;
      choices = this.config.extractChoicesFromComponents(message.components);
    }

    const components = this.config.createMenus(
      choices,
      upgradableStats,
      commonSlots,
    );

    if (this.config.isComplete(choices)) {
      components.push(
        new djs.ActionRowBuilder<djs.ButtonBuilder>().addComponents(
          MenuBuilder.createSubmitButton(
            `FIN:upgrade_submit`,
          ).setDisabled(submitButtonDisabled),
        ),
      );
    }

    const content = this.config.formatContent(choices, commonSlots);
    await interaction.editReply({
      content,
      components,
    });
  }

  private getSuccessMessage(choices: Required<T>, level: number): string {
    return this.config.getSuccessMessage?.(choices) ??
      `${choices.selectedStat} upgraded to Level ${level}! Check the pack generation channel for your new pack.`;
  }
}

// TODO type isn't quite perfect; we need Ks to be a _tuple_ of _string constants_, not any array of strings
function hasProperties<Ks extends readonly string[]>(...keys: Ks) {
  return <T extends Record<string, unknown>>(
    obj: T,
  ): obj is T & Required<Pick<T, Ks[number] & keyof T>> =>
    keys.every((key) => key in obj && typeof obj[key] !== "undefined");
}

// Level 2 customization flow
const level2Flow = new CustomizationFlow({
  extractChoicesFromComponents: (components) => {
    const choices: {
      selectedStat: FINStat;
      colorSlotIndex?: number;
      colorChoice?: string;
      upgradeIndex?: number;
    } = {} as any;

    // Extract from select menu default values which show current selections
    for (const row of components) {
      if (!(isActionRowComponent(row))) continue;
      for (const component of row.components) {
        if (isStringSelectComponent(component)) {
          const customId = component.customId;
          const defaultOption = component.options?.find((opt) => opt.default);

          if (defaultOption !== undefined) {
            if (customId.includes("stat")) {
              choices.selectedStat = defaultOption.value as FINStat;
            } else if (customId.includes("colorslot")) {
              choices.colorSlotIndex = parseInt(defaultOption.value);
            } else if (customId.includes("color")) {
              choices.colorChoice = defaultOption.value;
            } else if (customId.includes("upgrade")) {
              choices.upgradeIndex = parseInt(defaultOption.value);
            }
          }
        }
      }
    }
    console.log("Extracted choices:", choices);
    return choices;
  },
  createMenus: (choices, upgradableStats, commonSlots) => {
    const components = [];

    const statsMenu = buildStatSelect(upgradableStats, choices.selectedStat);

    components.push(
      new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
        statsMenu,
      ),
    );

    console.log(choices);

    // Only show level-specific menus if a stat is selected
    if (choices.selectedStat) {
      components.push(
        new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
          MenuBuilder.createSlotMenu(
            `FIN:level2_colorslot`,
            "Choose slot to change color",
            commonSlots,
            choices.colorSlotIndex,
          ),
        ),
        new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
          MenuBuilder.createColorMenu(
            `FIN:level2_color`,
            choices.colorChoice,
          ),
        ),
        new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
          MenuBuilder.createSlotMenu(
            `FIN:level2_upgrade`,
            "Choose slot to upgrade to uncommon",
            commonSlots,
            choices.upgradeIndex,
          ),
        ),
      );
    }

    return components;
  },
  formatContent: (choices, commonSlots) => {
    let content = `Level 2 Stat Upgrade:\n`;

    if (choices.selectedStat) {
      content += `• Stat: ${choices.selectedStat}\n`;

      if (choices.colorSlotIndex !== undefined) {
        const selectedSlot = commonSlots.find((s) =>
          s.idx === choices.colorSlotIndex
        ) ?? (() => {
          throw new Error("Color slot index out of bounds");
        })();
        content += `• Color slot: ${
          describeSlot(selectedSlot.slot, selectedSlot.idx)
        }\n`;
      }
      if (choices.colorChoice) {
        content += `• New color: ${getColorName(choices.colorChoice)}\n`;
      }
      if (choices.upgradeIndex !== undefined) {
        const selectedSlot = commonSlots.find((s) =>
          s.idx === choices.upgradeIndex
        ) ?? (() => {
          throw new Error("Upgrade index out of bounds");
        })();
        content += `• Upgrade slot: ${
          describeSlot(selectedSlot.slot, selectedSlot.idx)
        }\n`;
      }

      content += choices.colorSlotIndex !== undefined && choices.colorChoice &&
          choices.upgradeIndex !== undefined
        ? "\n✅ All choices made! Click Apply to confirm."
        : "\nPlease make all selections below.";
    } else {
      content += "\nPlease select a stat to upgrade.";
    }

    return content;
  },
  isComplete: hasProperties(
    "selectedStat",
    "colorSlotIndex",
    "colorChoice",
    "upgradeIndex",
  ),
  updateChoice: (choices, value, step) => {
    if (step === "stat") {
      choices.selectedStat = value as FINStat;
    } else if (step === "colorslot") {
      choices.colorSlotIndex = parseInt(value);
    } else if (step === "color") {
      choices.colorChoice = value;
    } else if (step === "upgrade") {
      choices.upgradeIndex = parseInt(value);
    }
  },
  // Success message for level 2 upgrade
  getSuccessMessage: (choices) =>
    `${choices.selectedStat} upgraded to Level 2! Slot ${
      choices.colorSlotIndex! + 1
    } color changed to ${getColorName(choices.colorChoice!)}, slot ${
      choices.upgradeIndex! + 1
    } upgraded to uncommon. Check the pack generation channel for your new pack.`,
});

// Level 3 customization flow
const level3Flow = new CustomizationFlow({
  extractChoicesFromComponents: (components) => {
    const choices: { selectedStat: FINStat; upgradeIndex?: number } = {} as any;

    for (const row of components) {
      if (!isActionRowComponent(row)) continue;
      for (const component of row.components) {
        if (isStringSelectComponent(component)) {
          const customId = component.customId;
          const defaultOption = component.options?.find((opt) => opt.default);

          if (defaultOption !== undefined) {
            if (customId.includes("stat")) {
              choices.selectedStat = defaultOption.value as FINStat;
            } else if (customId.includes("upgrade")) {
              choices.upgradeIndex = parseInt(defaultOption.value);
            }
          }
        }
      }
    }
    return choices;
  },
  createMenus: (choices, upgradableStats, commonSlots) => {
    const components = [];

    const statsMenu = buildStatSelect(upgradableStats, choices.selectedStat);

    components.push(
      new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
        statsMenu,
      ),
    );

    // Only show upgrade menu if a stat is selected
    if (choices.selectedStat) {
      const menu = MenuBuilder.createSlotMenu(
        `FIN:level3_upgrade`,
        "Choose slot to upgrade to uncommon",
        commonSlots,
        choices.upgradeIndex,
      );
      components.push(
        new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
          menu,
        ),
      );
    }

    return components;
  },
  formatContent: (choices, commonSlots) => {
    let content = `Level 3 Stat Upgrade:\n`;

    if (choices.selectedStat) {
      content += `• Stat: ${choices.selectedStat}\n`;

      if (choices.upgradeIndex !== undefined) {
        const selectedSlot = commonSlots.find((s) =>
          s.idx === choices.upgradeIndex
        ) ?? (() => {
          throw new Error("Upgrade index out of bounds");
        })();
        content += `• Upgrade slot: ${
          describeSlot(selectedSlot.slot, selectedSlot.idx)
        }\n`;
      }

      content += choices.upgradeIndex !== undefined
        ? "\n✅ All choices made! Click Apply to confirm."
        : "\nPlease make all selections below.";
    } else {
      content += "\nPlease select a stat to upgrade.";
    }

    return content;
  },
  updateChoice: (choices, value, step) => {
    if (step === "stat") {
      choices.selectedStat = value as FINStat;
    } else if (step === "upgrade") {
      choices.upgradeIndex = parseInt(value);
    }
  },
  isComplete: hasProperties("selectedStat", "upgradeIndex"),
  getSuccessMessage: (choices) => {
    const msg = `${choices.selectedStat} upgraded to Level 3! Added special ${
      choices.selectedStat!.toLowerCase()
    } slot and upgraded slot ${
      choices.upgradeIndex! + 1
    } to uncommon. Check the pack generation channel for your new pack.`;
    return msg;
  },
});

const normalFlow = new CustomizationFlow({
  extractChoicesFromComponents: (components) => {
    const choices: { selectedStat: FINStat } = {} as any;
    for (const row of components) {
      if (!isActionRowComponent(row)) continue;
      for (const component of row.components) {
        if (isStringSelectComponent(component)) {
          const customId = component.customId;
          const defaultOption = component.options?.find((opt) => opt.default);
          if (defaultOption !== undefined) {
            if (customId.includes("stat")) {
              choices.selectedStat = defaultOption.value as FINStat;
            }
          }
        }
      }
    }
    return choices;
  },
  createMenus: (choices, upgradableStats) => {
    const components = [];

    const statsMenu = buildStatSelect(upgradableStats, choices.selectedStat);

    components.push(
      new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>().addComponents(
        statsMenu,
      ),
    );

    return components;
  },
  formatContent: (choices) => {
    let content = `Stat Upgrade:\n`;
    if (choices.selectedStat) {
      content += `• Stat: ${choices.selectedStat}\n`;
      content += "\n✅ All choices made! Click Apply to confirm.";
    } else {
      content += "\nPlease select a stat to upgrade.";
    }
    return content;
  },
  isComplete: hasProperties("selectedStat"),
  updateChoice: (choices, value) => {
    choices.selectedStat = value as FINStat;
  },
  getSuccessMessage: (choices) =>
    `${choices.selectedStat} upgraded! Check the pack generation channel for your new pack.`,
});

// Main handlers
export const finUpgradeHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "FIN:upgrade_stat") return;

  handle.claim();
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  using _ = await getStateLock(userId);
  const state = await restoreSinglePlayerState(userId);
  if (!state) {
    await interaction.editReply({
      content: "Player state not found.",
      components: [],
    });
    return;
  }

  const chosenStat = interaction.values[0] as FINStat;
  const newLevel = state.stats[chosenStat] + 1;

  if (newLevel === 2) {
    await level2Flow.updateMessage(interaction, state, {
      selectedStat: chosenStat,
    });
  } else if (newLevel === 3) {
    await level3Flow.updateMessage(interaction, state, {
      selectedStat: chosenStat,
    });
  } else {
    await normalFlow.updateMessage(interaction, state, {
      selectedStat: chosenStat,
    });
  }
};

export const finLevel2Handler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
  if (!interaction.customId.startsWith("FIN:level2_")) return;

  handle.claim();
  using _ = await getStateLock(interaction.user.id);
  await restoreSinglePlayerState(interaction.user.id);
  await level2Flow.handleInteraction(interaction);
};

export const finLevel3Handler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
  if (!interaction.customId.startsWith("FIN:level3_")) return;

  handle.claim();
  using _ = await getStateLock(interaction.user.id);
  await restoreSinglePlayerState(interaction.user.id);
  await level3Flow.handleInteraction(interaction);
};

export const finUpgradeSubmitHandler: Handler<djs.Interaction> = async (
  interaction,
  handle,
) => {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "FIN:upgrade_submit") return;

  handle.claim();
  using _ = await getStateLock(interaction.user.id);

  // Determine which flow to use based on the selected stat's next level
  const state = await restoreSinglePlayerState(interaction.user.id);
  if (!state) {
    await interaction.reply({
      content: "Player state not found.",
      ephemeral: true,
    });
    return;
  }

  // Don't upgrade if they're at-level already
  const players = await getPlayers();
  const player = players.find((p) => p.id === interaction.user.id);
  if (!player) {
    await interaction.reply({
      content: "Player record not found.",
      ephemeral: true,
    });
    return;
  }

  const totalLevel = Object.values(state.stats).reduce((a, b) => a + b, 0);
  if (player.losses <= totalLevel) {
    await interaction.reply({
      content:
        `You have ${player.losses} losses and are at level ${totalLevel}; you shouldn't have an upgrade unless your losses is greater than your current level.`,
      ephemeral: true,
    });
    return;
  }

  // Extract the selected stat from the message components
  const message = interaction.message;
  let selectedStat: FINStat | undefined;

  for (const row of message.components) {
    if (!isActionRowComponent(row)) continue;
    for (const component of row.components) {
      if (
        isStringSelectComponent(component) &&
        component.customId.includes("stat")
      ) {
        const defaultOption = component.options?.find((opt) => opt.default);
        if (defaultOption) {
          selectedStat = defaultOption.value as FINStat;
          break;
        }
      }
    }
    if (selectedStat) break;
  }

  if (!selectedStat) {
    await interaction.reply({
      content: "Could not determine selected stat.",
      ephemeral: true,
    });
    return;
  }

  const nextLevel = state.stats[selectedStat] + 1;

  if (nextLevel === 2) {
    await level2Flow.handleInteraction(interaction);
  } else if (nextLevel === 3) {
    await level3Flow.handleInteraction(interaction);
  } else {
    await normalFlow.handleInteraction(interaction);
  }
};

function isActionRowComponent(
  row: djs.TopLevelComponent,
): row is djs.ActionRow<djs.MessageActionRowComponent> {
  return row.type === djs.ComponentType.ActionRow;
}

function isStringSelectComponent(
  component: djs.MessageActionRowComponent,
): component is djs.StringSelectMenuComponent {
  return component.type === djs.ComponentType.StringSelect;
}

export async function sendUpgradeChoice(
  member: djs.GuildMember,
  state: FINPlayerState,
): Promise<djs.Message> {
  const upgradableStats = toUpgradableStats(state);

  const statsMenu = buildStatSelect(upgradableStats);

  const row = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>()
    .addComponents(statsMenu);

  const embed = new djs.EmbedBuilder()
    .setTitle("<:FIN:1379544128852983910> FIN League Stat Upgrade!")
    .setDescription(
      "You've lost a match, but failure breeds strength! Choose a stat to upgrade:",
    )
    .setColor(0xFF6B35)
    .addFields([
      ...upgradableStats.map(({ stat, level }) => ({
        name: `${getStatEmoji(stat)} ${stat}`,
        value: `Level ${level}`,
        inline: true,
      })),
      {
        name: "🎴 Current Booster Slots",
        value: state.boosterSlots.map((slot, idx) =>
          describeSlot(slot, idx)
        ).join("\n") || "No slots",
        inline: false,
      },
    ]);

  return await member.send({ embeds: [embed], components: [row] });
}

function buildStatSelect(
  upgradableStats: { stat: FINStat; level: number; nextLevel: number }[],
  selectedStat?: FINStat,
) {
  return new djs.StringSelectMenuBuilder()
    .setCustomId("FIN:upgrade_stat")
    .setPlaceholder("Choose a stat to upgrade")
    .addOptions(upgradableStats.map(({ stat, level, nextLevel }) => ({
      label: `${stat} (Level ${level} → ${nextLevel})`,
      value: stat,
      description: getStatDescription(stat, nextLevel),
      emoji: getStatEmoji(stat),
      default: selectedStat === stat,
    })));
}

function toUpgradableStats(state: FINPlayerState) {
  return Object.entries(state.stats)
    .filter(([, level]) => level < 4)
    .map(([stat, level]) => ({
      stat: stat as FINStat,
      level,
      nextLevel: level + 1,
    }));
}

function getStatDescription(stat: FINStat, level: number): string {
  const descriptions: Record<FINStat, Record<number, string>> = {
    "HP": {
      1: "Add 2 common BLB slots",
      2: "Customize common slots",
      3: "Add non-rare SAGA slot + upgrade common",
      4: "Add rare BLB slot",
    },
    "Magic": {
      1: "Add 2 common TDM slots",
      2: "Customize common slots",
      3: "Add non-rare BIG SPELL slot + upgrade common",
      4: "Add rare TDM slot",
    },
    "Evasion": {
      1: "Add 2 common DSK slots",
      2: "Customize common slots",
      3: "Add non-rare SURVEIL slot + upgrade common",
      4: "Add rare DSK slot",
    },
    "Speed": {
      1: "Add 2 common DFT slots",
      2: "Customize common slots",
      3: "Add uncommon EQUIPMENT slot + upgrade common",
      4: "Add rare DFT slot",
    },
    "Strength": {
      1: "Add 2 common FDN slots",
      2: "Customize common slots",
      3: "Add non-rare TOWN slot + upgrade common",
      4: "Add rare FDN slot",
    },
  };
  return descriptions[stat][level] || "Unknown upgrade";
}
