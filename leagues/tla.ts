import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../dispatch.ts";
import { makeChoice } from "../util/choice.ts";
import { CONFIG } from "../config.ts";
import { getMatches, getPlayers, MATCHTYPE, ROWNUM } from "../standings.ts";
import { sheets, sheetsWrite } from "../sheets.ts";
import { delay } from "@std/async";

const makeSetMessage = () => {
  const options = ["SPM", "EOE", "FIN", "TDM", "DFT", "FDM"].map((set) => ({
    label: set,
    value: set,
  }));
  return Promise.resolve({
    content: "Which set do you choose?",
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

  if (channel && channel.isTextBased()) {
    await channel.send(`!${chosen} <@${userId}>`);
  } else {
    console.error(`Could not find or send to pack generation channel.`);
  }

  return {
    result: "success" as const,
    content:
      `You chose ${chosen}. A request has been sent to the pack generation channel.`,
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
    const lossCount = matches.rows.slice(0, matchIndex + 1).filter((m) =>
      m["Loser Name"] === loser.Identification
    ).length;

    // Only send the choice message if the loss count is between 1 and 5
    if (lossCount >= 1 && lossCount <= 5) {
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
