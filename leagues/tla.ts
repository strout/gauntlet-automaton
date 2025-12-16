import {
  Client,
  DiscordAPIError,
  Interaction,
  Message,
  TextChannel,
} from "discord.js";
import { Handler } from "../dispatch.ts";
import { makeChoice } from "../util/choice.ts";
import { CONFIG } from "../config.ts";
import {
  addPoolChange,
  getAllMatches,
  getPlayers,
  getPoolChanges,
  MATCHTYPE,
  Player,
  ROWNUM,
  readTable,
  parseTable,
} from "../standings.ts";
import { sheets, sheetsWrite } from "../sheets.ts";
import { delay } from "@std/async";
import {
  BoosterSlot,
  formatBoosterPackForDiscord,
  generatePackFromSlots,
} from "../util/booster_generator.ts";

import { ScryfallCard, searchCards } from "../scryfall.ts";
import { fetchSealedDeck, makeSealedDeck } from "../sealeddeck.ts";
import { mutex } from "../mutex.ts";
import z from "zod";

const packgenChannelUrl =
  `https://discord.com/channels/${CONFIG.GUILD_ID}/${CONFIG.PACKGEN_CHANNEL_ID}`;

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
    content:
      "You are at the crossroads of your destiny. It's time for you to choose.",
    options: options,
  });
};

const playerLocks = new Map<string, () => Promise<Disposable>>();

function lockPlayer(discordId: string) {
  let lock = playerLocks.get(discordId);
  if (!lock) {
    lock = mutex();
    playerLocks.set(discordId, lock);
  }
  return lock();
}

async function recordPack(
  id: string,
  packPoolId: string,
  comment?: string,
  alreadyLocked?: boolean
) {
  // TODO this is hacky but locks are not re-entrant
  using _ = alreadyLocked ? ({[Symbol.dispose]() {}}) : await lockPlayer(id);
  const [players, poolChanges] = await Promise.all([
    getPlayers(),
    getPoolChanges(),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === id);
  if (!player) {
    console.warn(`Could not find player with Discord ID ${id} to record pack`);
    return;
  }
  const lastChange = poolChanges.rows.findLast((change) =>
    change["Name"] === player.Identification
  );
  if (!lastChange) {
    console.warn(
      `Could not find last pool change for ${player.Identification}`,
    );
    return;
  }

  const packContents = await fetchSealedDeck(packPoolId);
  // build full pool
  const fullPool = await makeSealedDeck(
    packContents,
    lastChange["Full Pool"] ?? undefined,
  );
  await addPoolChange(
    player.Identification,
    "add pack",
    packPoolId,
    comment ?? "",
    fullPool,
  );
}

const processed = new Set<string>();

const onPackModifyChoice = async (
  chosen: string,
  interaction: Interaction,
) => {
  const [choice, packMessageId] = chosen.split(":");
  const userId = interaction.user.id;
  if (processed.has(packMessageId)) {
    return {
      result: "failure" as const,
      content:
        "Double-press detected. Check #pack-generation and wait a moment for your pack. Contact #league-committee if it does not appear in a few moments.",
    };
  }
  processed.add(packMessageId);

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
  const cardNamesRaw = embed.description.replace(/```\n/g, "").replace(
    /\n```/g,
    "",
  );
  const cardNames = cardNamesRaw.split("\n").filter((name) =>
    name.trim() !== ""
  );

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
        // Remove all 4 uncommons and generate 9 new common cards
        const newCommons = await generateSpecificCards("common", 9, "TLA");

        finalPack = [...raresMythics, ...commons, ...newCommons];
        flavorText = "You swapped your uncommons for more commons. Good luck!";
        break;
      }
      case "SWAP_C_FOR_UC": {
        // Remove all 9 random commons and generate 4 new uncommon cards
        const newUncommons = await generateSpecificCards("uncommon", 4, "TLA");

        finalPack = [...raresMythics, ...uncommons, ...newUncommons];
        flavorText =
          "You swapped your commons for more uncommons. A bold move!";
        break;
      }
      default:
        flavorText = "An unexpected choice was made. Defaulting to keep.";
        finalPack = [...originalPack];
    }

    const discordMessage = await formatBoosterPackForDiscord(
      finalPack,
      `<@${interaction.user.id}> got a week 2 pack!`,
    );
    discordMessage.content = `<@${interaction.user.id}> got a week 2 pack!`;

    const guild = await interaction.client.guilds.fetch(CONFIG.GUILD_ID);
    const packGenChannel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    await packGenChannel.send(discordMessage);

    const packPoolId = await makeSealedDeck({
      sideboard: finalPack.map((x) => ({ name: x.name, set: x.set })),
    });

    await recordPack(interaction.user.id, packPoolId);

    return {
      result: "success" as const,
      content: `${flavorText}\nYour pack has been selected! See ` +
        packgenChannelUrl,
    };
  } catch (error) {
    console.error(`Error processing pack modification for ${userId}:`, error);
    return {
      result: "try-again" as const,
      content:
        "There was an error processing your pack modification. Please try again.",
    };
  }
};

const {
  sendChoice: sendPackModifyChoice,
  responseHandler: packModifyChoiceHandler,
} = makeChoice("TLA_week2", makePackModifyMessage, onPackModifyChoice);

const { sendChoice: sendSetChoice, responseHandler: setChoiceHandler } =
  makeChoice("TLA_week1", makeSetMessage, onSetChoice);

const { sendChoice: sendBonusChoice, responseHandler: bonusChoiceHandler } =
  makeChoice("TLA_week3", makeBonusMessage, onBonusChoice);

function makeBonusMessage(bonusCount: number) {
  return Promise.resolve({
    content: "Take your bonus now, or endure and take it later?",
    options: [
      {
        label: "Bonus: Get " + bonusCount + " shrines and " + bonusCount +
          " Learn cards now",
        value: "bonus",
        description: "Get You can only choose Bonus once",
      },
      {
        label: "Endure",
        value: "endure",
        description: "Collect a bigger bonus after a future match",
      },
    ],
  });
}

async function onBonusChoice(chosen: string, interaction: Interaction) {
  if (chosen === "endure") {
    return { result: "success" as const, content: "You have endured" };
  }
  if (chosen === "bonus") {
    const matches = await getTlaMatches();
    const players = await getPlayers();
    const player = players.rows.find((p) =>
      p["Discord ID"] === interaction.user.id
    );
    if (!player) return { result: "try-again" as const };
    const bonusCount = Math.min(
      5,
      matches.rows.filter((m) =>
        m["Your Name"] === player.Identification ||
        m["Loser Name"] === player.Identification
      ).length - 10,
    );
    if (bonusCount < 0) {
      return {
        result: "failure" as const,
        content: "You have fewer than 11 matches played.",
      };
    }
    const sent = await sendBonus(interaction.client, player, bonusCount);
    if (!sent) return { result: "try-again" as const };
    return {
      result: "success" as const,
      content: "Your pack is in #pack-generation",
    };
  }
  return { result: "try-again" as const };
}

async function sendBonus(client: Client, player: Player, bonusCount: number) {
  using _ = await lockPlayer(player["Discord ID"]);
  const poolChanges = await getPoolChanges();
  const hasBonus = poolChanges.rows.some((r) =>
    r.Name === player.Identification && r.Comment === "Bonus"
  );
  if (hasBonus) {
    console.log(`Player ${player.Identification} already received bonus.`);
    return false; // Player already received bonus
  }

  const bonusSlots: BoosterSlot[] = [
    // Shrines: Use the combined Scryfall query directly
    { scryfallQuery: "t:shrine r:u (s:neo OR s:m21)", count: bonusCount },
    // Learn Cards: Use the Scryfall query directly
    { scryfallQuery: "o:learn r<r s:stx", count: bonusCount }, // r<r means common or uncommon
  ];

  let bonusPack: ScryfallCard[] = [];
  try {
    bonusPack = await generatePackFromSlots(bonusSlots);
  } catch (error) {
    console.error(
      `Error generating bonus pack for player ${player.Identification}:`,
      error,
    );
    return false;
  }

  if (bonusPack.length === 0) {
    console.warn(
      `No cards generated for bonus pack for player ${player.Identification}.`,
    );
    return false;
  }

  // 2. Format for Discord and send to pack generation channel
  const discordMessageContent = `<@${
    player["Discord ID"]
  }> received a bonus pack! (${bonusCount} Shrines, ${bonusCount} Learn Cards)`;
  const discordMessage = await formatBoosterPackForDiscord(
    bonusPack,
    discordMessageContent,
  );
  discordMessage.content = discordMessageContent;

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const packGenChannel = await guild.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as TextChannel;

  try {
    await packGenChannel.send(discordMessage);
  } catch (e) {
    console.error(
      `Error sending bonus pack message to Discord for player ${player.Identification}:`,
      e,
    );
    return false;
  }

  // 3. Record it (with recordPack) with comment "Bonus"
  const packPoolId = await makeSealedDeck({
    sideboard: bonusPack.map((x) => ({ name: x.name, set: x.set })),
  });

  // TODO this is hacky but locks are not re-entrant
  await recordPack(player["Discord ID"], packPoolId, "Bonus", true);

  return true;
}

async function checkForMatches(client: Client<boolean>) {
  const matches = await getTlaMatches();
  const players = await getPlayers();

  for (const match of matches.rows) {
    // Check if the match is handled by script and not yet messaged by bot
    if (!match["Script Handled"]) continue;

    if (!match["Bot Messaged"]) {
      await handleLoser(client, matches, players, match);
    }

    if (match[MATCHTYPE] === "match" && !match["Bot Messaged Winner"]) {
      await handleWinner(client, matches, players, match);
    }
  }
}

async function checkForCometOptOut(client: Client<boolean>) {
  const players = await getPlayers();
  
  // Read the Pools tab to check COMET MESSAGED column
  // Headers are on row 6; data starts on row 7
  const poolsTable = await readTable("Pools!A6:Z", 6);
  
  // Find the COMET MESSAGED column index
  const cometMessagedColIndex = poolsTable.headerColumns["COMET MESSAGED"];
  if (cometMessagedColIndex === undefined) {
    console.warn("COMET MESSAGED column not found in Pools tab");
    console.warn(poolsTable.headerColumns);
    return;
  }
  
  // Find the Name/Identification column (try common column names)
  const nameColIndex = poolsTable.headerColumns["NAME"];
  console.log(nameColIndex);
  if (nameColIndex === undefined) {
    console.warn("Name/Identification column not found in Pools tab");
    return;
  }

  for (const player of players.rows) {
    // Check if player has 10+ wins
    if (player.Wins < 10) continue;
    // Check if player has Discord ID
    if (!player["Discord ID"]) continue;
    
    // Find the corresponding row in Pools tab
    const poolRow = poolsTable.rows.find((row) => {
      const rowName = row.NAME;
      return rowName === player.Name
    });
    
    if (!poolRow) {
      console.warn(`Could not find pool row for player ${player.Identification}`);
      continue;
    }
    
    // Check if already messaged (COMET MESSAGED column should be empty or falsy)
    const cometMessaged = poolRow["COMET MESSAGED"];
    if (cometMessaged) {
      continue; // Already messaged
    }
    
    // Send DM message with form link
    try {
      const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
      const member = await guild.members.fetch(player["Discord ID"]);
      
      // TODO: Replace with actual form link
      const formLink = "https://docs.google.com/forms/d/e/1FAIpQLSfjjwP_FhpomMd4fvyU3F1n7Xf5vVy2ADBj5H8UWcRjibh7Ew/viewform";
      const messageContent = `Congratulations on surviving the Fire Nation Attack (by reaching 10 or more wins)! At the end of Week 4, you will be placed randomly into a team of 3 players with the same number of wins. If, for any reason, you do not wish (or are not available) to participate in the team portion (from December 19th to January 2nd) you may choose to opt out now by filling out this [form](${formLink}). Players who opt out now will still receive the $10CAD/$7USD prizing for surviving until Week 5.`;
      
      await member.user.send(messageContent);
      
      // Mark as messaged in the sheet (using R1C1 notation)
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `Pools!R${poolRow[ROWNUM]}C${cometMessagedColIndex + 1}`,
        [["1"]],
      );
    } catch (e: unknown) {
      if (e instanceof DiscordAPIError && e.code === 10007) {
        console.warn(
          `Player ${player.Identification} (${
            player["Discord ID"]
          }) blocked DMs. Cannot send comet opt-out message.`,
        );
        // Mark as blocked in the sheet (using R1C1 notation)
        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          `Pools!R${poolRow[ROWNUM]}C${cometMessagedColIndex + 1}`,
          [["-1"]],
        );
      } else {
        console.error(
          `Error sending comet opt-out message to ${player.Identification} (${
            player["Discord ID"]
          }):`,
          e,
        );
      }
    }
  }
}

async function getTlaMatches() {
  return await getAllMatches({ "Bot Messaged Winner": z.coerce.boolean() }, {});
}

function getMatchCount(
  matches: Awaited<ReturnType<typeof getTlaMatches>>,
  player: Awaited<
    ReturnType<typeof getPlayers<Record<string, never>>>
  >["rows"][number],
  match: Awaited<ReturnType<typeof getTlaMatches>>["rows"][number],
) {
  // Calculate total matches played by the player up to this match
  const matchIndex = matches.rows.findIndex((m) =>
    m[ROWNUM] === match[ROWNUM] && m[MATCHTYPE] === match[MATCHTYPE]
  );
  return matches.rows.slice(0, matchIndex + 1).filter((m) =>
    m["Loser Name"] === player.Identification ||
    m["Your Name"] === player.Identification
  ).length;
}

async function handleWinner(
  client: Client<boolean>,
  matches: Awaited<ReturnType<typeof getTlaMatches>>,
  players: Awaited<ReturnType<typeof getPlayers<Record<string, never>>>>,
  match: Awaited<ReturnType<typeof getTlaMatches>>["rows"][number],
) {
  const winner = players.rows.find((p) =>
    p.Identification === match["Your Name"]
  );

  if (!winner) {
    console.warn(
      `Unidentified winner ${match["Your Name"]} for ${match[MATCHTYPE]} ${
        match[ROWNUM]
      }`,
    );
    return;
  }

  const matchCount = getMatchCount(matches, winner, match);

  // Logic for matches 11-15: Week 3
  if (matchCount >= 11 && matchCount <= 15) {
    await handleWeek3(client, winner, match, matches, "Bot Messaged Winner");
  }
}

async function handleLoser(
  client: Client<boolean>,
  matches: Awaited<ReturnType<typeof getTlaMatches>>,
  players: Awaited<ReturnType<typeof getPlayers<Record<string, never>>>>,
  match: Awaited<ReturnType<typeof getTlaMatches>>["rows"][number],
) {
  const loser = players.rows.find((p) =>
    p.Identification === match["Loser Name"]
  );

  if (!loser) {
    console.warn(
      `Unidentified loser ${match["Loser Name"]} for ${match[MATCHTYPE]} ${
        match[ROWNUM]
      }`,
    );
    return;
  }

  if (loser["Losses"] >= 11) {
    return;
  }

  const matchCount = getMatchCount(matches, loser, match);

  // Only send the choice message if the total matches played is between 1 and 5
  if (matchCount >= 1 && matchCount <= 5) {
    try {
      let blocked = false;
      try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(loser["Discord ID"]);

        await sendSetChoice(client, member.user.id);
      } catch (e: unknown) {
        // DiscordAPIError code 10007 means "Cannot send messages to this user"
        if (e instanceof DiscordAPIError && e.code === 10007) {
          blocked = true;
        } else {
          throw e;
        }
      }

      // Mark the match as messaged in the sheet
      await recordMessaged(
        matches,
        match,
        "Bot Messaged",
        blocked ? "-1" : "1",
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
      try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        const member = await guild.members.fetch(loser["Discord ID"]);
        const userId = member.user.id; // Declare userId here

        const slots: BoosterSlot[] = [
          { rarity: "rare/mythic", count: 1, set: "TLA" },
          { rarity: "uncommon", count: 4, set: "TLA" },
          { rarity: "common", count: 9, set: "TLA" },
        ];

        const pack = await generatePackFromSlots(slots);
        const discordMessage = await formatBoosterPackForDiscord(
          pack,
          "Week 2 pack. You must choose an option below before your next match.",
        );

        // Send the initial pack as a DM
        const sentMessage = await member.user.send(discordMessage);

        // Then send the modification choice
        await sendPackModifyChoice(client, userId, sentMessage.id);

        // Mark the match as messaged in the sheet AFTER sending both messages
        await recordMessaged(
          matches,
          match,
          "Bot Messaged",
          "1",
        );
      } catch (e: unknown) {
        if (e instanceof DiscordAPIError && e.code === 10007) {
          console.warn(
            `Player ${loser.Identification} (${
              loser["Discord ID"]
            }) blocked DMs. Cannot send booster or choice.`,
          );
          // If blocked, update sheet immediately as no choice will be made
          await recordMessaged(matches, match, "Bot Messaged", "-1");
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
  } else if (matchCount >= 11 && matchCount <= 15) {
    await handleWeek3(client, loser, match, matches, "Bot Messaged");
  }
  // For other match counts, do nothing and leave "Bot Messaged" untouched
}

async function recordMessaged(
  matches: Awaited<ReturnType<typeof getTlaMatches>>,
  match: Awaited<ReturnType<typeof getTlaMatches>>["rows"][number],
  column: "Bot Messaged" | "Bot Messaged Winner",
  value: "1" | "-1",
) {
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    `${matches.sheetName[match[MATCHTYPE]]}!R${match[ROWNUM]}C${
      matches.headerColumns[match[MATCHTYPE]][column] + 1
    }`,
    [[value]],
  );
}

const manualBonus: Handler<Message> = async (message, handle) => {
  // Not guarding this beyond content because submission logic should prevent ineligible submissions.
  const [cmd, id, count] = message.content.split(" ");
  if (cmd !== "!resend3") return;
  handle.claim();
  await sendBonusChoice(message.client, id, +count);
};

export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: async (client: Client) => {
      while (true) {
        await checkForMatches(client);
        await checkForCometOptOut(client);
        await delay(60_000); // Check every minute
      }
    },
    messageHandlers: [manualBonus],
    interactionHandlers: [
      setChoiceHandler,
      packModifyChoiceHandler,
      bonusChoiceHandler,
    ],
  });
}

async function handleWeek3(
  client: Client,
  player: Awaited<
    ReturnType<typeof getPlayers<Record<string, never>>>
  >["rows"][number],
  match: Awaited<ReturnType<typeof getTlaMatches>>["rows"][number],
  matches: Awaited<ReturnType<typeof getTlaMatches>>,
  messagedColumn: "Bot Messaged" | "Bot Messaged Winner",
) {
  const matchCount = getMatchCount(matches, player, match);
  const poolChanges = await getPoolChanges();
  const hasBonus = poolChanges.rows.some((r) =>
    r.Name === player.Identification &&
    r.Comment === "Bonus"
  );
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const packGen = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    if (match["Loser Name"] === player.Identification) {
      await packGen.send(
        "!TLA <@!" + player["Discord ID"] + ">",
      );
    }
    if (
      !hasBonus &&
      matches.rows.findLast((m) =>
          m["Your Name"] === player.Identification ||
          m["Loser Name"] === player.Identification
        ) === match
    ) {
      const bonusCount = matchCount - 10;
      if (bonusCount < 5) {
        await sendBonusChoice(client, player["Discord ID"], bonusCount);
      } else {
        await sendBonus(client, player, bonusCount);
      }
    }
    if (matchCount === 15) {
      // request 3 TLA boosters
      await packGen.send(
        "!TLA 3 <@!" + player["Discord ID"] +
          "> has completed their 15th match.",
      );
    }
    await recordMessaged(matches, match, messagedColumn, "1");
  } catch (e: unknown) {
    if (e instanceof DiscordAPIError && e.code === 10007) {
      console.warn(
        `Player ${player.Identification} (${
          player["Discord ID"]
        }) blocked DMs. Cannot send booster or choice.`,
      );
      // If blocked, update sheet immediately as no choice will be made
      await recordMessaged(matches, match, messagedColumn, "-1");
    } else {
      throw e;
    }
  }
}
