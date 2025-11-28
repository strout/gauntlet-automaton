import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../dispatch.ts";
import { makeChoice } from "../util/choice.ts";
import { CONFIG } from "../config.ts";
import { getMatches, getPlayers, MATCHTYPE, ROWNUM } from "../standings.ts";
import { sheets, sheetsWrite } from "../sheets.ts";
import { delay } from "@std/async";
import {
  BoosterSlot,
  formatBoosterPackForDiscord,
  generatePackFromSlots,
} from "../util/booster_generator.ts";

import { ScryfallCard, searchCards } from "../scryfall.ts";
async function generateSpecificCards(
  rarity: "common" | "uncommon" | "rare" | "mythic",
  count: number,
  set: string,
): Promise<ScryfallCard[]> {
  if (count <= 0) return [];

  const slot: BoosterSlot = {
    rarity: rarity,
    count: count,
    set: set,
  };

  const generatedCards = await generatePackFromSlots([slot]);
  return generatedCards;
}


const makeSetMessage = () => {
  const options = Object.entries({
    "SPM": "Marvel's Spider-Man",
    "EOE": "Edge of Eternities",
    "FIN": "Final Fantasy",
    "TDM": "Tarkir: Dragonstorm",
    "DFT": "Aetherdrift",
    "FDN": "Magic Foundations",
  }).map(([set, name]) => ({
    label: set,
    value: set,
    description: name,
  }));
  return Promise.resolve({
    content: "Now is your moment to choose.",
    options: options,
  });
};

const onSetChoice = async (
  chosen: string,
  interaction: Interaction,
) => {
  const userId = interaction.user.id;
  console.log(`User chose: ${chosen}`);
  const client = interaction.client;
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const channel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID);

  let flavorText = "";
  switch (chosen) {
    case "TDM":
      flavorText =
        "Did I ever tell you how I got the nickname Dragon of the West?";
      break;
    case "FDN":
      flavorText = "Remember your basics, Prince Zuko!";
      break;
    case "EOE":
      flavorText =
        "The Fire Nation needs the moon, too; we all depend on the balance.";
      break;
    case "SPM":
      flavorText =
        "Destiny is a funny thing. You never know how things are going to work out.";
      break;
    case "DFT":
      flavorText =
        "Sometimes, life is like this dark tunnel. You can't always see the light at the end of the tunnel, but if you just keep moving, you will come to a better place.";
      break;
    case "FIN":
      flavorText =
        "Understanding others, the other elements, and the other nations will help you become whole.";
      break;
    default:
      flavorText = "";
  }

  const packgenChannelUrl =
    `https://discord.com/channels/${CONFIG.GUILD_ID}/${CONFIG.PACKGEN_CHANNEL_ID}`;

  if (channel && channel.isTextBased()) {
    await channel.send(`!${chosen} <@${userId}>`);
  } else {
    console.error(`Could not find or send to pack generation channel.`);
  }

  return {
    result: "success" as const,
    content:
      `You chose ${chosen}. A request has been sent to the pack generation channel: ${packgenChannelUrl}${
        flavorText ? `\n*${flavorText}*` : ""
      }`,
  };
};

const makePackModifyMessage = (packMessageId: string) => {
  const options = Object.entries({
    "KEEP": "Keep the pack as is",
    "SWAP_UC_FOR_C": "Swap 4 Uncommons for 9 random Commons",
    "SWAP_C_FOR_UC": "Swap 9 Commons for 4 random Uncommons",
  }).map(([value, label]) => ({
    label,
    value: `${value}:${packMessageId}`, // Encode packMessageId in value
    description: label,
  }));
  return Promise.resolve({
    content: "You received a booster pack! Would you like to modify it?",
    options: options,
  });
};

const onPackModifyChoice = async (
  chosen: string,
  interaction: Interaction,
) => {
  const [choice, packMessageId] = chosen.split(":");
  const userId = interaction.user.id;

  // Fetch the original pack message
  if (!interaction.channel) {
    return {
      result: "failure" as const,
      content: "Could not find the channel for the pack message.",
    };
  }
  const packMessage = await interaction.channel.messages.fetch(packMessageId);
  const embed = packMessage.embeds[0];
  if (!embed || !embed.description) {
    return {
      result: "failure" as const,
      content: "Could not retrieve pack details from the original message.",
    };
  }

  // Extract card names from the description (assuming format ````\nCard Name\nCard Name\n````)
  const cardNamesRaw = embed.description.replace(/```\n/g, "").replace(/\n```/g, "");
  const cardNames = cardNamesRaw.split("\n").filter((name) => name.trim() !== "");

  if (cardNames.length === 0) {
    return {
      result: "failure" as const,
      content: "No card names found in the original pack message.",
    };
  }

  let originalPack: readonly ScryfallCard[] = [];
  try {
    const allTlaBoosterCards = await searchCards("set:tla is:booster");
    const tlaBoosterCardMap = new Map<string, ScryfallCard>();
    for (const card of allTlaBoosterCards) {
      tlaBoosterCardMap.set(card.name, card);
    }

    // Reconstruct originalPack in the order of cardNames
    originalPack = cardNames.map((name) => tlaBoosterCardMap.get(name)).filter(
      (card) => card !== undefined,
    ) as readonly ScryfallCard[];

    // If some cards couldn't be found, log a warning
    if (originalPack.length !== cardNames.length) {
      console.warn(
        `Could not find all cards for pack message ${packMessageId}. Expected ${cardNames.length}, found ${originalPack.length}. Missing: ${
          cardNames.filter((name) => !tlaBoosterCardMap.has(name)).join(", ")
        }`,
      );
    }
  } catch (error) {
    console.error(
      `Error fetching TLA booster cards for pack message ${packMessageId}:`,
      error,
    );
    return {
      result: "failure" as const,
      content:
        "There was an error retrieving TLA booster card details. Please try again.",
    };
  }
  let finalPack: ScryfallCard[] = [];
  let flavorText = "";

  // Helper to separate cards by rarity
  const separateCardsByRarity = (
    cards: readonly ScryfallCard[],
  ) => {
    const raresMythics = cards.filter((c) =>
      c.rarity === "rare" || c.rarity === "mythic"
    );
    const uncommons = cards.filter((c) => c.rarity === "uncommon");
    const commons = cards.filter((c) => c.rarity === "common");
    return { raresMythics, uncommons, commons };
  };

  const { raresMythics, uncommons, commons } = separateCardsByRarity(
    originalPack,
  );

  try {
    switch (choice) {
      case "KEEP":
        finalPack = [...originalPack];
        flavorText = "You decided to keep your pack as is. Enjoy!";
        break;
      case "SWAP_UC_FOR_C": {
        // Remove 4 random uncommons
        const uncommonsToKeep = [...uncommons];
        const removedUncommons: ScryfallCard[] = [];
        for (let i = 0; i < Math.min(4, uncommons.length); i++) {
          const removed = uncommonsToKeep.splice(
            Math.floor(Math.random() * uncommonsToKeep.length),
            1,
          )[0];
          removedUncommons.push(removed);
        }

        // Generate 9 new common cards
        const newCommons = await generateSpecificCards("common", 9, "TLA");

        finalPack = [...raresMythics, ...uncommonsToKeep, ...commons, ...newCommons];
        flavorText = "You swapped your uncommons for more commons. Good luck!";
        break;
      }
      case "SWAP_C_FOR_UC": {
        // Remove 9 random commons
        const commonsToKeep = [...commons];
        const removedCommons: ScryfallCard[] = [];
        for (let i = 0; i < Math.min(9, commons.length); i++) {
          const removed = commonsToKeep.splice(
            Math.floor(Math.random() * commonsToKeep.length),
            1,
          )[0];
          removedCommons.push(removed);
        }

        // Generate 4 new uncommon cards
        const newUncommons = await generateSpecificCards("uncommon", 4, "TLA");

        finalPack = [...raresMythics, ...uncommons, ...commonsToKeep, ...newUncommons];
        flavorText = "You swapped your commons for more uncommons. A bold move!";
        break;
      }
      default:
        flavorText = "An unexpected choice was made. Defaulting to keep.";
        finalPack = [...originalPack];
    }

    const discordMessage = await formatBoosterPackForDiscord(
      finalPack,
      `Your Modified TLA Booster Pack! (${choice})`,
    );

    let blocked = false;
    try {
      await interaction.user.send(discordMessage);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("10007")) {
        blocked = true;
        console.warn(`Player ${userId} blocked DMs.`);
      } else {
        throw e;
      }
    }



    return {
      result: "success" as const,
      content: `${flavorText}\nYour pack has been sent!`,
    };
  } catch (error) {
    console.error(`Error processing pack modification for ${userId}:`, error);
    return {
      result: "failure" as const,
      content:
        "There was an error processing your pack modification. Please try again.",
    };
  }
};

const {
  sendChoice: sendPackModifyChoice,
  responseHandler: packModifyChoiceHandler,
} = makeChoice("TLA_packmodify", makePackModifyMessage, onPackModifyChoice);

const { sendChoice: sendSetChoice, responseHandler: setChoiceHandler } =
  makeChoice("TLA_week1", makeSetMessage, onSetChoice);

async function checkForMatches(client: Client<boolean>) {
  const matches = await getMatches();
  const players = await getPlayers();

  for (const match of matches.rows) {
    // Check if the match is handled by script and not yet messaged by bot
    if (!match["Script Handled"] || match["Bot Messaged"]) continue;

    const loser = players.rows.find((p) =>
      p.Identification === match["Loser Name"]
    );

    if (!loser) {
      console.warn(`Unidentified loser ${match["Loser Name"]} for ${match[MATCHTYPE]} ${match[ROWNUM]}`);
      continue;
    }

    // Calculate loss count for the player up to this match
    const matchIndex = matches.rows.findIndex((m) =>
      m[ROWNUM] === match[ROWNUM]
    );
    const matchCount = matches.rows.slice(0, matchIndex + 1).filter((m) =>
      m["Loser Name"] === loser.Identification ||
      m["Your Name"] === loser.Identification
    ).length;

    // Only send the choice message if the loss count is between 1 and 5
    if (matchCount >= 1 && matchCount <= 5) {
      try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(loser["Discord ID"]);

        let blocked = false;
        try {
          await sendSetChoice(client, member.user.id);
        } catch (e: unknown) {
          // DiscordAPIError code 10007 means "Cannot send messages to this user"
          if (e instanceof Error && e.message.includes("10007")) { // Simplified check for DiscordAPIError
            blocked = true;
          } else {
            throw e;
          }
        }

        // Mark the match as messaged in the sheet
        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          `Matches!R${match[ROWNUM]}C${
            matches.headerColumns["Bot Messaged"] + 1
          }`,
          [[blocked ? "-1" : "1"]], // -1 for blocked, 1 for sent
        );
      } catch (error) {
        console.error(
          `Error sending TLA choice to ${loser.Identification} (${
            loser["Discord ID"]
          }) for match ${match[ROWNUM]}:`,
          error,
        );
        // Optionally, send error to owner here if critical
      }
    } else if (matchCount >= 6 && matchCount <= 10) {
      // Logic for matches 6-10: DM a booster pack and offer modification
      try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(loser["Discord ID"]);
        const userId = member.user.id; // Declare userId here
        const rowNum = match[ROWNUM]; // Declare rowNum here

        const slots: BoosterSlot[] = [
          { rarity: "rare/mythic", count: 1, set: "TLA" },
          { rarity: "uncommon", count: 4, set: "TLA" },
          { rarity: "common", count: 9, set: "TLA" },
        ];

        const pack = await generatePackFromSlots(slots);
        const discordMessage = await formatBoosterPackForDiscord(
          pack,
          "Your TLA Booster Pack!",
        );

        let blocked = false;
        try {
          // Send the initial pack as a DM
          const sentMessage = await member.user.send(discordMessage);

          // Then send the modification choice
          await sendPackModifyChoice(client, userId, sentMessage.id);

          // Mark the match as messaged in the sheet AFTER sending both messages
          await sheetsWrite(
            sheets,
            CONFIG.LIVE_SHEET_ID,
            `Matches!R${rowNum}C${
              matches.headerColumns["Bot Messaged"] + 1
            }`,
            [["1"]], // 1 for sent
          );

        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes("10007")) {
            blocked = true;
            console.warn(
              `Player ${loser.Identification} (${loser["Discord ID"]}) blocked DMs. Cannot send booster or choice.`,
            );
            // If blocked, update sheet immediately as no choice will be made
            await sheetsWrite(
              sheets,
              CONFIG.LIVE_SHEET_ID,
              `Matches!R${rowNum}C${
                matches.headerColumns["Bot Messaged"] + 1
              }`,
              [["-1"]], // -1 for blocked
            );
          } else {
            throw e;
          }
        }

      } catch (error) {
        console.error(
          `Error sending TLA booster or choice to ${loser.Identification} (${
            loser["Discord ID"]
          }) for match ${match[ROWNUM]}:`,
          error,
        );
      }
    }
    // For other loss counts, do nothing and leave "Bot Messaged" untouched
  }
}

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: async (client: Client) => {
      while (true) {
        await checkForMatches(client);
        await delay(60_000); // Check every minute
      }
    },
    messageHandlers: [],
    interactionHandlers: [setChoiceHandler, packModifyChoiceHandler],
  });
}
