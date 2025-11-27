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
      console.warn(
        `Unidentified loser ${match["Loser Name"]} for ${match[MATCHTYPE]} ${
          match[ROWNUM]
        }`,
      );
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
      // Logic for matches 6-10: DM a booster pack
      try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(loser["Discord ID"]);

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
          // Send the pack as a DM
          await member.user.send(discordMessage);
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes("10007")) {
            blocked = true;
            console.warn(
              `Player ${loser.Identification} (${loser["Discord ID"]}) blocked DMs.`,
            );
          } else {
            throw e;
          }
        }

        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          `Matches!R${match[ROWNUM]}C${
            matches.headerColumns["Bot Messaged"] + 1
          }`,
          [[blocked ? "-1" : "1"]], // -1 for blocked, 1 for sent (consistent with choice messages)
        );
      } catch (error) {
        console.error(
          `Error sending TLA booster to ${loser.Identification} (${
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
    interactionHandlers: [setChoiceHandler],
  });
}
