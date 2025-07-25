import { CONFIG, makeClient, DISCORD_TOKEN } from "./main.ts";
import * as djs from "discord.js";
import { Handler } from "./dispatch.ts";
import process from "node:process";
import { addPoolChanges, getMatches, getPlayers, getPoolChanges, getQuotas } from "./standings.ts";
import { mutex } from "./mutex.ts";
import { fetchSealedDeck, makeSealedDeck } from "./sealeddeck.ts";
import { columnIndex, initSheets, sheets, sheetsRead, sheetsWrite } from "./sheets.ts";
import { delay } from "@std/async/delay";

const lock = mutex();

// Define a participant interface for better type safety
interface TradeParticipant {
  userId: string;
  messageId?: string;
  response?: Action | undefined;
  card: string;
  cardImageUrl?: string;
}

type Action = 'accept' | 'decline';

// Map to track active trades: tradeId -> trade details including participants
const activeTradeMap = new Map<string, { 
  participants: TradeParticipant[];
  rowNum: number;
}>();

async function restoreTradeMap() {
  using _ = await lock();
  // read the Trade Requests sheet and rebuild activeTradeMap; use getPlayers to determine user IDs; deserialize the trade info; look at accepted columns, etc.
  const tradeRequestRows = await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Trade Requests!B2:H",
  );
  const players = await getPlayers();
  activeTradeMap.clear();
  let rowNum = 1;
  for (const row of tradeRequestRows.values ?? []) {
    rowNum++; // TODO is there a less-imperative way to do this?
    const parts = [row.slice(columnIndex("B", "B"), columnIndex("D", "B")), row.slice(columnIndex("D", "B"), columnIndex("H", "B"))] as const;
    const responses = [row[columnIndex("G", "B")] as Action, row[columnIndex("H", "B")] as Action] as const;
    const state = row[columnIndex("F", "B")] && JSON.parse(row[columnIndex("F", "B")]);
    if (!state || state.error || responses.some(r => r === 'decline') || responses.every(r => r === 'accept')) {
      // skip if not started or already processed
      continue;
    }
    console.log(state);
    const participants = parts.map(([name, card], i) => ({
      userId: players.find(player => player.row[columnIndex("B", "A")] === name)?.id ?? (() => { throw new Error(`Could not find user ID for player: ${name}`); })(),
      card: card as string,
      cardImageUrl: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(card)}&format=image&version=small`,
      response: responses[i] || undefined,
      messageId: state.messageIds[i],
    }));
    activeTradeMap.set(state.tradeId, {
      participants,
      rowNum,
    });
  }
}

/**
 * Handler for trade button interactions
 */
export const tradeButtonHandler: Handler<djs.Interaction> = async (interaction, handle) => {
  if (!interaction.isButton() || !(interaction.customId.startsWith("accept_") || interaction.customId.startsWith("decline_"))) return;

  handle.claim();

  using _ = await lock();

  // Get the user who pressed the button
  const user = interaction.user;

  // Extract the trade information from the custom ID
  const [action, tradeId] = interaction.customId.split('_') as [Action, string];

  // Look up the trade info from our map
  const tradeInfo = activeTradeMap.get(tradeId);
  if (!tradeInfo) {
    await interaction.update({
      content: "This trade is no longer valid or has expired.",
      components: [], // Remove the buttons
      embeds: interaction.message.embeds
    });
    return;
  }

  // Find the participant that corresponds to this interaction
  const currentParticipantIndex = tradeInfo.participants.findIndex(p => p.messageId === interaction.message.id);
  const currentParticipant = tradeInfo.participants[currentParticipantIndex];
  if (!currentParticipant) {
    console.log("Message mismatch:", {
      messageId: interaction.message.id,
      participants: tradeInfo.participants.map(p => p.messageId)
    });

    await interaction.reply({
      content: "This message is not associated with the trade.",
      flags: djs.MessageFlagsBitField.Flags.Ephemeral
    });
    return;
  }

  // if we already have a response, don't allow another
  if (currentParticipant.response !== undefined) {
    await interaction.reply({
      content: "You have already responded to this trade.",
      flags: djs.MessageFlagsBitField.Flags.Ephemeral
    });
    return;
  }

  // Only the intended recipient of this message can interact with it
  if (user.id !== currentParticipant.userId) {
    await interaction.reply({
      content: "This confirmation isn't for you!",
      flags: djs.MessageFlagsBitField.Flags.Ephemeral
    });
    return;
  }
  
  // record action in Trade Requests!R{rowNum}C{7 + currentParticipantIndex}
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    `Trade Requests!R${tradeInfo.rowNum}C${7 + currentParticipantIndex}`,
    [[action]]
  );
  currentParticipant.response = action;

  // Handle the different button responses
  if (action === 'accept') {
    // Check if all players have accepted
    const allAccepted = tradeInfo.participants.every(p => p.response === 'accept');

    if (allAccepted) {
      // All players have accepted, execute the trade
      try {
        const guild = await interaction.client.guilds.fetch(CONFIG.AGL_GUILD_ID);

        // Notify all participants
        for (const participant of tradeInfo.participants) {
          const member = await guild.members.fetch(participant.userId);
          await member.send(`The trade has been accepted by all players and will now be processed!`);
        }

        const players = await getPlayers();
        const poolChanges = await getPoolChanges();
        // validate the trade one more time
        const errors = await validateTrade(tradeInfo.participants as [TradeParticipant, TradeParticipant], players, poolChanges);
        if (errors) {
          await interaction.followUp({
            content: `An error occurred while executing the trade:\n\n${errors}`,
            ephemeral: true
          });
          return;
        }

        await executeTrade(tradeInfo.participants, players, poolChanges);

        // Record the final outcome as "completed" in Trade Requests!I{rowNum}
        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          `Trade Requests!I${tradeInfo.rowNum}`,
          [["completed"]]
        );

        // announce in #pack-generation
        const channel = await guild.channels.fetch(CONFIG.PACKGEN_CHANNEL_ID) as djs.TextChannel;
        await channel.send(`Trade completed: <@${tradeInfo.participants[0].userId}> traded ${tradeInfo.participants[0].card} to <@${tradeInfo.participants[1].userId}> for ${tradeInfo.participants[1].card}.`);

        // Clean up
        activeTradeMap.delete(tradeId);
      } catch (error) {
        console.error("Failed to process completed trade:", error);
        await interaction.followUp({
          content: `An error occurred while executing the trade. Please contact the league committee and ping <@${CONFIG.OWNER_ID}>.`,
          ephemeral: true
        });
        // DM owner
        const owner = await interaction.client.users.fetch(CONFIG.OWNER_ID);
        await owner.send(`An error occurred while processing a completed trade: ${error}`);
      }
    } else {
      // Update the message to show this player accepted
      await interaction.update({
        content: "You accepted the trade! Waiting for the other player to respond...",
        components: [], // Remove the buttons after selection
        embeds: interaction.message.embeds // Keep the embeds
      });
    }
  } else if (action === 'decline') {
    await interaction.update({
      content: "You declined the trade. The other player has been notified.",
      components: [], // Remove the buttons after selection
      embeds: interaction.message.embeds // Keep the embeds
    });

    try {
      const guild = await interaction.client.guilds.fetch(CONFIG.AGL_GUILD_ID);

      // Notify all other participants about the rejection
      for (const participant of tradeInfo.participants) {
        if (participant.messageId !== currentParticipant.messageId) {
          const member = await guild.members.fetch(participant.userId);

          // Send notification
          await member.send(`The trade has been declined by <@${user.id}>.`);

          // Update their message if possible
          if (participant.messageId) {
            try {
              const dmChannel = await member.createDM();
              const message = await dmChannel.messages.fetch(participant.messageId);

              await message.edit({
                content: `This trade was declined by <@${user.id}>.`,
                components: [], // Remove the buttons
                embeds: message.embeds // Keep the embeds
              });
            } catch (err) {
              console.error(`Failed to update message for participant ${participant.userId}:`, err);
            }
          }
        }
      }

      // record the final outcome as "declined" in Trade Requests!I{rowNum}
      await sheetsWrite(
        sheets,
        CONFIG.LIVE_SHEET_ID,
        `Trade Requests!I${tradeInfo.rowNum}`,
        [["declined"]]
      );

      // Clean up
      activeTradeMap.delete(tradeId);
    } catch (error) {
      console.error("Failed to notify trade participants about rejection:", error);
    }
  }
};

/**
 * Handler for stipulation choice interactions
 */
export const stipChoiceHandler: Handler<djs.Interaction> = async (interaction, handle) => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith('PLG:stip_week_')) return;
  
  handle.claim();
  using _ = await lock();
  
  // Extract the week number from the custom ID
  const week = +interaction.customId.replace('PLG:stip_week_', '');
  
  if (isNaN(week) || week < 1 || week > 3) {
    console.error(`Invalid week number in custom ID: ${interaction.customId}`);
    await interaction.reply({
      content: "An error occurred processing your stip reward choice. Please contact the league committee.",
      ephemeral: true
    });
    return;
  }
  
  const chosenStip = interaction.values[0];
  console.log(`User ${interaction.user.tag} chose stip reward ${chosenStip} for week ${week}`);

  // Fetch pool changes for this user
  const players = await getPlayers();
  const player = players.find(p => p.id === interaction.user.id);
  if (!player) {
    console.error(`Could not find player for user ID: ${interaction.user.id}`);
    await interaction.reply({
      content: "An error occurred processing your stip reward choice. Please contact the league committee.",
      ephemeral: true
    });
    return;
  }

  const poolChanges = await getPoolChanges();

  // if there is already one named Stip Week {week} for this player, abort and remove the options
  const existingStip = poolChanges.find(pool => pool.name === player.name && pool.comment === `Stip Week ${week}`);
  if (existingStip) {
    await interaction.update({
      content: "You have already chosen a stip reward for this week. Please contact the league committee if you believe this is an error.",
      components: [],
      embeds: []
    });
    return;
  }


  const latestPoolId = poolChanges.findLast(pool => pool.name === player.name && pool.fullPool)?.fullPool;
  if (!latestPoolId) {
    console.error(`Could not find latest pool ID for player: ${player.name}`);
    await interaction.reply({
      content: "An error occurred processing your stip reward choice. Please contact the league committee.",
      ephemeral: true
    });
    return;
  }

  const newPoolId = await makeSealedDeck({ sideboard: [{name: chosenStip, count: 1}]}, latestPoolId);

  await addPoolChanges([
    [player.name, 'add card', chosenStip, `Stip Week ${week}`, newPoolId] satisfies [name: string, type: string, value: string, comment: string, poolId: string]
  ]);

  // Update the message to confirm the choice
  await interaction.update({
    content: `${chosenStip} was added to your pool.`,
    components: [],
    embeds: []
  });
};

/**
 * Interface representing a trade participant input
 */
interface TradeParticipantInput {
  userId: string;
  card: string;
}

// Watch for rows in the spreadsheet "Trade Requests" sheet (B,C,D,E are participant name, card name, participant name, card name; participant user IDs are found in the player database) and initiate trades and record the results in column F
async function checkTradeRequests(client: djs.Client) {
  const tradeRequestRows = await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Trade Requests!B2:F",
  );

  let players: undefined | Awaited<ReturnType<typeof getPlayers>>;

  let rowNum = 1;

  for (const row of tradeRequestRows.values ?? []) {
    rowNum++; // TODO is there a less-imperative way to do this?
    if (!row[columnIndex("E", "B")] || row[columnIndex("F", "B")]) {
      continue; // Skip if no trade request or already processed
    }
  
    const parts = [row.slice(columnIndex("B", "B"), columnIndex("D", "B")), row.slice(columnIndex("D", "B"), columnIndex("F", "B"))] as const;

    players ??= await getPlayers();

    const participants = parts.map((part) => ({
      userId: players!.find(player => player.name === part[0])?.id ?? (() => { throw new Error(`Could not find user ID for player: ${part[0]}`); })(),
      card: part[1]
    })) as [TradeParticipantInput, TradeParticipantInput];

    const result = await initiateTrade(client, participants, rowNum);

    await sheetsWrite(
      sheets,
      CONFIG.LIVE_SHEET_ID,
      `Trade Requests!F${rowNum}`,
      [[JSON.stringify(result)]],
    );
  }
}

/**
 * Initiates a card trade between players
 * @param client Discord client
 * @param participants Array of participants with their user IDs and cards
 * @returns Promise of either an error or the trade ID and message IDs
 */
async function initiateTrade(
  client: djs.Client,
  participants: [TradeParticipantInput, TradeParticipantInput],
  rowNum: number
) {
  if (participants.length < 2) {
    return { error: "At least two participants are required for a trade" };
  }

  using _ = await lock();

  const players = await getPlayers();
  const poolChanges = await getPoolChanges();

  const error = await validateTrade(participants, players, poolChanges);
  if (error) {
    // send the error message to the first participant
    const member = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
    const user = await member.members.fetch(participants[0].userId);
    await user.send(error);
    return { error };
  }

  // Generate a unique trade ID
  const tradeId = Date.now().toString();

  const tradeInfo: NonNullable<ReturnType<typeof activeTradeMap.get>> = {
    participants: participants.map(p => ({
      userId: p.userId,
      card: p.card,
      accepted: false
    })),
    rowNum
  };

  // Store the trade information with participants
  activeTradeMap.set(tradeId, tradeInfo);

  try {
    // Fetch the guild
    const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);

    // Fetch all members and prepare full participant data
    const fullParticipants = await Promise.all(participants.map(async (p) => {
      const member = await guild.members.fetch(p.userId);

      // Get the Scryfall image URL for the card
      const cardUrl = encodeURIComponent(p.card);
      const imageUrl = `https://api.scryfall.com/cards/named?exact=${cardUrl}&format=image&version=small`;

      return {
        member,
        card: p.card,
        cardImageUrl: imageUrl,
        userId: p.userId
      };
    }));

    // Send trade confirmations to each participant
    for (const [[currentParticipant, ctInfo], [otherParticipant]] of rotations(fullParticipants.map((x, i) => [x, tradeInfo.participants[i]] as const))) {
      const message = await sendTradeConfirmation({
        currentParticipant,
        otherParticipant,
        tradeId
      });

      ctInfo.messageId = message.id;
    }
  } catch (error) {
    console.error("Error initiating trade:", error);
    return { error: "Failed to initiate trade" };
  }

  return { tradeId, messageIds: tradeInfo.participants.map(p => p.messageId) };
}

/**
 * Type representing a trade participant with full details
 */
type TradeMessageParticipant = {
  member: djs.GuildMember;
  card: string;
  cardImageUrl: string;
  userId: string;
};

/**
 * Sends a trade confirmation message to a player
 * @param params Object containing all parameters
 */
async function sendTradeConfirmation(params: {
  currentParticipant: TradeMessageParticipant;
  otherParticipant: TradeMessageParticipant;
  tradeId: string;
}): Promise<djs.Message> {
  const { currentParticipant, otherParticipant, tradeId } = params;

  // Create the buttons for responding to the trade
  const buttons = new djs.ActionRowBuilder<djs.ButtonBuilder>()
    .addComponents(
      new djs.ButtonBuilder()
        .setCustomId(`${'accept' satisfies Action}_${tradeId}`)
        .setLabel('Accept Trade')
        .setStyle(djs.ButtonStyle.Success),
      new djs.ButtonBuilder()
        .setCustomId(`${'decline' satisfies Action}_${tradeId}`)
        .setLabel('Decline Trade')
        .setStyle(djs.ButtonStyle.Danger)
    );

  // Create embeds for the trade
  const embeds: djs.APIEmbed[] = [
    {
      title: `Trade with ${otherParticipant.member.displayName}`,
      description: `Do you want to trade with <@${otherParticipant.userId}>?`,
      thumbnail: {
        url: otherParticipant.member.displayAvatarURL()
      },
      color: 0x0099FF
    },
    {
      title: `You Send: ${currentParticipant.card}`,
      image: {
        url: currentParticipant.cardImageUrl
      },
      color: 0xDD2222 // Red for sending
    },
    {
      title: `You Receive: ${otherParticipant.card}`,
      image: {
        url: otherParticipant.cardImageUrl
      },
      color: 0x22DD22 // Green for receiving
    }
  ];

  // Send the trade confirmation message
  return await currentParticipant.member.send({
    content: "Card Trade Offer",
    embeds: embeds,
    components: [buttons]
  });
}

// TODO add a signature for length preservation of tuples
function rotations<T>(values: T[]): T[][] {
  const rotations: T[][] = [];
  for (let i = 0; i < values.length; i++) {
    const rotated = [...values.slice(i), ...values.slice(0, i)];
    rotations.push(rotated);
  }
  return rotations;
}

async function validateTrade(participants: [TradeParticipantInput, TradeParticipantInput], players: Awaited<ReturnType<typeof getPlayers>>, poolChanges: Awaited<ReturnType<typeof getPoolChanges>>): Promise<string | null> {
  // check that each participant actually has the card they're trading
  const errors = [];
  for (const participant of participants) {
    const playerRow = players.find(row => row.id === participant.userId);
    const latestPoolId = poolChanges.findLast(pool => pool.name === playerRow?.name && pool.fullPool)?.fullPool;
    if (!latestPoolId) {
      errors.push(`Could not find a pool for <@${participant.userId}>. Please report this to <@${CONFIG.OWNER_ID}> in #league-committee.`);
      continue;
    }
    const poolContent = await fetchSealedDeck(latestPoolId);
    const hasCard = poolContent.sideboard.some(card => card.name.split(" //")[0].toLowerCase() === participant.card.split(" //")[0].toLowerCase());
    if (!hasCard) {
      console.log(`${participant.userId} is missing card "${participant.card}" in https://sealeddeck.tech/${latestPoolId}`);
      console.log(JSON.stringify(poolContent));
      errors.push(`<@${participant.userId}> does not have the card "${participant.card}" in their pool.`);
    }
  }

  // check stars: if participants have played each other, then they each must have at least one star (silver and/or gold).
  // if they haven't played each other, they must each have a gold star.
  // silver star count is in player db column AD, gold in AE. Opponent list is comma-separated in column R

  const starMap = buildStarMap(players);

  for (const [participant, other] of rotations(participants)) {
    const entry = starMap.get(participant.userId);
    // if entry isn't found, no stars, or no gold stars for non-opponent, error
    if (!entry) {
      continue;
    }

    const star = determineStar(starMap, participant, other);

    if (star === 'Error') {
      errors.push(`<@${participant.userId}> does not have enough stars to trade with <@${other.userId}>. They must have at least one star (silver or gold) if they have played each other, or at least one gold star if they haven't.`);
    }
  }

  // ensure these two haven't traded before; this would show up on the Trade Requests sheet with columns B and D being the players (in any order) and column I being "completed"
  const tradeRequestRows = await sheetsRead(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Trade Requests!B2:I",
  );
  const tradeRequests = tradeRequestRows.values ?? [];
  for (const row of tradeRequests) {
    const [name1, _card1, name2, _card2, _state, _yourResponse, _theirResponse, completed] = row;
    if (completed === "completed") {
      const ids = [name1, name2].map(name => players.find(player => player.name === name)?.id);
      if (ids.every(id => participants.some(p => p.userId === id))) {
        errors.push(`These players have already traded: <@${participants[0].userId}> and <@${participants[1].userId}>`);
        break;
      }
    }
  }

  if (errors.length > 0) {
    return errors.join("\n");
  }
  return null;
}

function buildStarMap(players: Awaited<ReturnType<typeof getPlayers>>) {
  const playerMap = new Map<string, { silverStars: number; goldStars: number; opponentList: string[]; }>();

  for (const player of players) {
    const silverStars = +player.row[columnIndex("AD", "A")];
    const goldStars = +player.row[columnIndex("AE", "A")];
    const opponentList = player.row[columnIndex("R", "A")].split(",").map((opponent: string) => players.find(p => p.name === opponent)?.id).filter(Boolean) as string[];
    playerMap.set(player.id, { silverStars, goldStars, opponentList });
  }

  return playerMap;
}

async function executeTrade(participants: TradeParticipant[], players: Awaited<ReturnType<typeof getPlayers>>, poolChanges: Awaited<ReturnType<typeof getPoolChanges>>) {
  const newPools: { name: string, starUsed: 'Silver' | 'Gold', gave: string, received: string, poolId: string }[] = [];

  const starMap = buildStarMap(players);

  for (const [giver, receiver] of rotations(participants)) {
    const giverPlayer = players.find(player => player.id === giver.userId);
    const receiverPlayer = players.find(player => player.id === receiver.userId);

    if (!giverPlayer || !receiverPlayer) {
      throw new Error(`Could not find player for user ID: ${giver.userId} or ${receiver.userId}`);
    }

    // determine type of star for giver to use ('Silver' or 'Gold' or 'Error')
    const starUsed = determineStar(starMap, giver, receiver);

    if (starUsed === 'Error') {
      throw new Error(`Player <@${giverPlayer.id}> does not have enough stars to trade with <@${receiverPlayer.id}>. They must have at least one star (silver or gold) if they have played each other, or at least one gold star if they haven't.`);
    }
    
    const latestPoolId = poolChanges.findLast(pool => pool.name === giverPlayer.name && pool.fullPool)?.fullPool;
    if (!latestPoolId) {
      throw new Error(`Could not find latest pool ID for player: ${giverPlayer.name}`);
    }
    const pool = await fetchSealedDeck(latestPoolId);
    // make sure the card we're giving is in the sideboard
    const card = pool.sideboard.find(card => card.name.split(" //")[0].toLowerCase() === giver.card!.split(" //")[0].toLowerCase());
    if (!card) {
      console.error(JSON.stringify(pool))
      throw new Error(`Card "${giver.card}" not found in pool for player: ${giverPlayer.name}`);
    }
    // build a new pool, removing the given card and adding the received card
    const newPool = { sideboard: [
      ...pool.sideboard.flatMap(c => c === card ? c.count === 1 ? [] : [{ ...c, count: c.count - 1 }] : [c]),
      { name: receiver.card!, count: 1 }
    ] };
    const realNewPoolId = await makeSealedDeck(newPool);
    newPools.push({ name: giverPlayer.name, starUsed, gave: giver.card!, received: receiver.card!, poolId: realNewPoolId });
  }

  // actually record the pool changes in one batch

  await addPoolChanges([
    ...newPools.flatMap(result => [
      [result.name, 'remove card', result.gave, `Star:${result.starUsed}`] satisfies [name: string, type: string, value: string, comment: string],
      [result.name, 'add card', result.received, "", result.poolId] satisfies [name: string, type: string, value: string, comment: string, poolId: string]
    ])
  ]);
}

function determineStar(starMap: Map<string, { silverStars: number; goldStars: number; opponentList: string[]; }>, giver: TradeParticipant, receiver: TradeParticipant) {
  const entry = starMap.get(giver.userId);
  if (!entry) {
    throw new Error(`Could not find star entry for user ID: ${giver.userId}`);
  }
  const hasPlayed = entry.opponentList.includes(receiver.userId);
  const hasGoldStar = entry.goldStars > 0;
  const hasSilverStar = entry.silverStars > 0;
  const starUsed = hasSilverStar && hasPlayed ? 'Silver' : hasGoldStar ? 'Gold' : 'Error';
  return starUsed;
}

export async function setup() {
  await restoreTradeMap();
  return { 
    watch: async (client: djs.Client) => {
      while (true) {
        await checkTradeRequests(client);
        await checkForMatches(client);
        await delay(15_000);
      }
    },
    messageHandlers: [],
    interactionHandlers: [tradeButtonHandler, stipChoiceHandler],
  };
}

const FLAVOR_MESSAGE: Record<string, string> = {
  "BRO": `After a tough day on the playground, Mom picks you up from school. “You got a letter in the mail,” she says.
	  
You make it home and race inside hoping it’s exactly what you’ve been waiting for, and… nope just some letter from your brother. You toss it aside and head upstairs. A few minutes later Mom walks in and asks you to open it. You reluctantly rip it open and start reading.

*Classes are cool…yada yada… not partying too much… yada yada… won’t be home for Christmas, SO HERE’S A LITTLE SOMETHING FROM ME?*

You look up and Mom is holding a pack of Magic cards\! The package says “The Brothers War” and Mom chuckles, “Is there a Mothers War too? I’m feeling left out here.”`,
  "SNC": `This last weekend was a doozy. Dishes, cleaning, yard work. You thought about quitting more than a few times but Dad kept reminding you what was at stake: after dinner, you get to stop for ice cream and then a pack of Magic cards. 

You head to the store to look at all your options and Dad says, “This one looks cool.” He reaches into the back of the display and pulls out a pack with gold trim and a demon on the front. “Huh, must be an extra one.” 

You two check out and head home to see what this place called “New Capenna” is all about.`,
  "STX": `The school bell rings and you race to pick up your cards and head back inside. As you turn around you trip and fall, scattering your cards everywhere. 

Quickly scrambling to get them all back into your box, a teacher comes over and bends down to help. She eventually hands you the pile of cards she’s picked up and says, “Here this might help.” 

Your panic over being late instantly washes away as you realize she has a fresh pack of cards for you\!

“My kids got me into it and I love seeing others have fun as well. Wait until you get home though\!”`,
  "MID": `As you hop off the school bus and head inside you see another car in your driveway. Grandma is here\!
	  
After chatting and dinner, she asks you what you’re going as for Halloween this year. Being so far off you don’t know, maybe a planeswalker or a superhero?

“I thought this might give you some ideas for Halloween” and pulls out a pack of Magic cards\! You hadn’t considered going as a werewolf, but now they seem kinda cool. `,
  "DMU": `Ugh, tonight after school is going to be a long night. Mom wants to go to this museum to look at art. It’s not even supposed to be cool art, just like countrysides, forests, oceans. Basically nothing. 

You keep your mouth shut, but expect things to be super boring all night. 

Eventually Mom takes you to the gift shop and as you’re looking around you see them behind the counter: CARDS\!

They’re all from some set called Dominaria United, and the clerk says, “Our featured artists tonight have art in the set\! It’s supposed to be very colorful.”

That’s cool and all, but playing with the cards is going to be much cooler.`,
  "NEO": `*Would all students please report to the auditorium for today's guest speaker.*

The intercom clicks off and your class funnels into your section of the auditorium. Some guy is supposed to be talking about his mask collection and how old they are. 

He has some cool things to talk about, and anyone who answers his questions gets something from his bag of stuff. 

Eventually he makes his way towards your section and points right at you, “Did you have a good time?” 

“Absolutely\!” 

“Good answer\!” he responds and tosses you a goodie from his goodie bag. A pack of Magic cards? NO WAY\! Your friends are going to be so jealous.`,
}

async function checkForMatches(client: djs.Client<boolean>) {
  // on each person's first stip match (win or loss) ask them to choose a stip; should be similar to other match-watching fns in other leagues
  const matches = await getMatches();

  const players = await getPlayers();

  const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);

  // go through each match; if it has a pack but no message sent, send flavor message to loser (except for entropy loss). If it is a player's first stip match for the week, initiate stip choice.
  for (const m of matches) {
    if (m.pack && !m.botMessaged) {
      // send user the flavor message
      const loser = players.find(p => p.name === m.loser);
      if (!loser) {
        console.error(`Could not find user for loser: ${m.loser}`);
        continue;
      }

      const winner = players.find(p => p.name === m.winner);
      if (!winner) {
        console.error(`Could not find user for winner: ${m.winner}`);
        continue;
      }

      const loserMember = await guild.members.fetch(loser.id);
      if (FLAVOR_MESSAGE[m.pack]) {
        await loserMember.send(FLAVOR_MESSAGE[m.pack]);
      }

      // If this was a stip match, then for each player for whom it's their first stip match of the week, send them a choice of stip rewards
      if (m.wasStip) {
        const quotas = await getQuotas();
        const week = quotas.findLast(q => q.fromDate <= m.timestamp) ?? quotas[0];
        const loserFirstStipForWeek = matches.find(m => [m.loser, m.winner].includes(loser.name) && m.timestamp >= week.fromDate && m.timestamp < week.toDate && m.wasStip);
        const winnerFirstStipForWeek = matches.find(m => [m.loser, m.winner].includes(winner.name) && m.timestamp >= week.fromDate && m.timestamp < week.toDate && m.wasStip);

        if (loserFirstStipForWeek === m && loser.status !== 'Eliminated') {
          await messageStip(week, loserMember);
        }

        if (winnerFirstStipForWeek === m) {
          const winnerMember = await guild.members.fetch(winner.id);
          await messageStip(week, winnerMember);
        }
      }

      // mark message as sent by writing a 1 to column K
      await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, `Matches!K${m.matchRowNum}`, [["1"]]);
    }
  }
}

const lesson_text = new Map<string, string>(await fetch("https://api.scryfall.com/cards/search?q=t%3Alesson&unique=cards")
  .then(res => res.json())
  .then(data => data.data.map((card: { name: string, oracle_text: string, mana_cost: string }) => ([card.name, card.mana_cost + ": " + card.oracle_text] as const))));

const STIP_REWARD_CHOICES: Record<number, Array<{name: string, emoji: string}>> = {
  1: [
    {name: "Environmental Sciences", emoji: "🌿"},
    {name: "Expanded Anatomy", emoji: "💪"},
    {name: "Introduction to Annihilation", emoji: "💥"},
    {name: "Introduction to Prophecy", emoji: "🔮"},
  ],
  2: [
    {name: "Elemental Summoning", emoji: "🌋"},
    {name: "Inkling Summoning", emoji: "✒️"},
    {name: "Pest Summoning", emoji: "🐞"},
    {name: "Fractal Summoning", emoji: "🔷"},
    {name: "Spirit Summoning", emoji: "👻"},
  ],
  3: [
    {name: "Academic Probation", emoji: "📝"},
    {name: "Basic Conjuration", emoji: "✨"},
    {name: "Confront the Past", emoji: "⏮️"},
    {name: "Containment Breach", emoji: "🚨"},
    {name: "Illuminate History", emoji: "📚"},
    {name: "Mercurial Transformation", emoji: "🔄"},
    {name: "Necrotic Fumes", emoji: "☠️"},
    {name: "Reduce to Memory", emoji: "🧠"},
    {name: "Start from Scratch", emoji: "🧹"},
    {name: "Teachings of the Archaics", emoji: "🏛️"},
  ],
};

async function messageStip({ week }: { week: number }, user: djs.GuildMember) {
  /* TODO do a delayed pack choice thing waiting for a response */
  const options = STIP_REWARD_CHOICES[week];
  // let's use a dropdown for the options
  const selectMenu = new djs.StringSelectMenuBuilder()
    .setCustomId("PLG:stip_week_" + week)
    .setPlaceholder("Choose your week " + week + " reward")
    .addOptions(options.map(({name, emoji}) => ({
      label: name,
      value: name,
      description: lesson_text.get(name)?.slice(0, 100) ?? "",
      emoji,
    })));

  const row = new djs.ActionRowBuilder<djs.StringSelectMenuBuilder>()
    .addComponents(selectMenu);
  
  const message = await user.send({
    content: `You have a stip reward to choose for week ${week}!\n\nPlease select your choice from the dropdown below.`,
    components: [row],
  });
  console.log(`Sent stip message to ${user.user.tag}: ${message.url}`);
}

// assert that all stip rewards have a lesson entry
for (const week of Object.keys(STIP_REWARD_CHOICES)) {
  for (const {name} of STIP_REWARD_CHOICES[+week as keyof typeof STIP_REWARD_CHOICES]) {
    if (!lesson_text.has(name)) {
      throw new Error(`Stip reward ${name} for week ${week} does not have a lesson entry`);
    }
  }
}

// if this is the main module, send a stip reward to OWNER_ID
if (import.meta.main) {
  await initSheets();
  const client = makeClient();

  client.once(djs.Events.ClientReady, async (client) => {
    const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
    const owner = await guild.members.fetch(CONFIG.OWNER_ID);
    await messageStip({ week: 1 }, owner);
    // and quit
    process.exit(0);
  });

  await client.login(DISCORD_TOKEN);
}
