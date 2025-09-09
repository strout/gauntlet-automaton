import * as djs from "discord.js";
import { sheets, sheetsAppend, sheetsRead, sheetsWrite } from "./sheets.ts";
import { Handler } from "./dispatch.ts";
import { CONFIG } from "./main.ts";
import { mutex } from "./mutex.ts";

const GIFT_SHEET_ID = "___";

const unwrapRegex = /\s*!unwrap (\d+)\s*(?:<@\!?(\d+)>)?.*/;
const wrapRegex = /\s*!wrap (\d+)\s*/;

const giftLock = mutex();

export const unwrapHandler: Handler<djs.Message> = async (message, handle) => {
  let match: RegExpMatchArray | null;
  // TODO REDO BOTH
  const GIFT_CHANNEL_CHOICE_IDs = [
    CONFIG.BOT_BUNKER_CHANNEL_ID,
    CONFIG.STARTING_POOL_CHANNEL_ID,
    CONFIG.GENERAL_CHAT_CHANNEL_ID,
  ];
  const GIFT_CHANNEL_RESULT_ID = CONFIG.STARTING_POOL_CHANNEL_ID;
  if (
    !GIFT_CHANNEL_CHOICE_IDs.includes(message.channelId) ||
    !(match = message.content.match(unwrapRegex))
  ) return;
  handle.claim();
  const recipient = match[2] ?? message.author.id; // TODO allow @
  using _ = await giftLock();
  const chosen = +match[1];
  const gifts = await getGifts();
  const chosenGift = gifts.find((g) => g.unwrappedBy === recipient);
  if (chosenGift) {
    // TODO re-display the gift
    await message.reply(
      (recipient === message.author.id ? "You have" : `<@${recipient}> has`) +
        " already opened present " + chosenGift.number + ": " +
        chosenGift.link,
    );
    return;
  }
  const wantedGift = gifts.find((g) => g.number === chosen);
  const unchosenGifts = gifts.filter((g) => !g.unwrappedBy);
  if (!wantedGift) {
    await message.reply(
      "Sorry, I don't have a present with that number. Choose a number " +
        Math.min(...unchosenGifts.map((x) => x.number)) + " through " +
        Math.max(...unchosenGifts.map((x) => x.number)) + ".",
    );
    return;
  }
  if (wantedGift?.unwrappedBy) {
    const nearestGifts = unchosenGifts.sort((a, z) =>
      Math.abs(a.number - chosen) - Math.abs(z.number - chosen)
    );
    if (nearestGifts.length) {
      await message.reply(
        "Sorry, that present was already unwrapped by someone else. May I recommend number " +
          nearestGifts[0].number + ", which is still available?",
      );
    } else {await message.reply(
        "Sorry, all presents are claimed. The League Committee can wrap more...",
      );}
    return;
  }
  await sheetsWrite(sheets, GIFT_SHEET_ID, "Gifts!D" + (chosen + 1), [[
    recipient,
  ]]);
  await message.reply(
    (recipient === message.author.id
      ? "It's all yours! You get "
      : `<@${recipient}>, <@${message.author.id}> got you something: `) +
      wantedGift.link,
  );
  const destGuild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
  const destChannel = await destGuild.channels.fetch(
    GIFT_CHANNEL_RESULT_ID,
  ) as djs.TextChannel;
  await destChannel.send(`<@${recipient}>'s pool: ${wantedGift.link}`);
  /*
      TODO figure out a way around this breakage!
      unlock();
      const url = wantedGift.messageUrl;
      const client = message.client;
      const botMessage = await getMessageFromUrl(url, client);
      const file = botMessage.attachments.first();
      const image = botMessage.embeds[0].image?.url;
      const embed = new djs.EmbedBuilder().setImage(image!).addFields(botMessage.embeds[0].fields);
      const destGuild = await client.guilds.fetch(AGL_GUILD_ID);
      const destChannel = await destGuild.channels.fetch(GIFT_CHANNEL_RESULT_ID) as djs.TextChannel;
      await destChannel.send({ embeds: [embed], files: [file!.url] });
      */
  // TODO upload image and stuff
};

const deliveries = new Map<
  djs.Snowflake,
  { provide: (entry: { link: string; botMessage: djs.Message }) => void } | {
    link: string;
    botMessage: djs.Message;
  }
>();

export async function getMessageFromUrl(url: string, client: djs.Client) {
  const [guildId, channelId, messageId] = url.split("/").slice(-3);
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(channelId) as djs.TextChannel;
  const message = await channel.messages.fetch(messageId);
  return message;
}

function delivery(request: djs.Message) {
  const entry = deliveries.get(request.id);
  if (!entry || !("link" in entry)) {
    return new Promise<{ link: string; botMessage: djs.Message }>((res) =>
      deliveries.set(request.id, { provide: res })
    );
  }
  return Promise.resolve(entry);
}

// deno-lint-ignore require-await
export const deliveryHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  // TODO handle even if it is inn't in deliveries?
  // TODO channel check if I do that
  const id = message.reference?.messageId;
  const dest = id && deliveries.get(id);
  if (
    message.author.id !== CONFIG.BOOSTER_TUTOR_USER_ID || !dest ||
    !("provide" in dest)
  ) return;
  handle.claim();
  const link = message.embeds.flatMap((e) =>
    e.fields.filter((f) => f.name === "SealeDeck.Tech link")
  )[0]?.value;
  if (link) {
    dest.provide({ link, botMessage: message });
    deliveries.set(id, { link, botMessage: message });
  }
};

export const wrapHandler: Handler<djs.Message> = async (message, handle) => {
  let match: RegExpMatchArray | null;
  if (!(match = message.content.match(wrapRegex))) return;
  handle.claim();

  try {
    const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(message.author.id);
    if (!member?.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID)) return;
  } catch (e) {
    if (e instanceof djs.DiscordAPIError && e.code === 10013) {
      /* not a member */ return;
    }
    throw e;
  }

  using _ = await giftLock();
  const n = +match[1];
  const current = await getGifts();
  await message.reply(`Wrapping ${n} gifts...`);
  const guild = await message.client.guilds.fetch(CONFIG.GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.BOT_BUNKER_CHANNEL_ID,
  ) as djs.TextChannel;
  let num = current.length + 1;
  for (let i = 0; i < n; i++) {
    const request = await channel.send("!pio1 6 (gift!)");
    const { link, botMessage } = await delivery(request);
    await addGift(link, num++, botMessage);
  }
  await message.reply(
    "Wrapped gifts " + (current.length + 1) + " through " + (num - 1) +
      ".",
  );
};

async function getGifts() {
  const content = await sheetsRead(sheets, GIFT_SHEET_ID, "Gifts!A2:D");
  const gifts = content.values?.map((row, index) => ({
    index,
    number: index + 1,
    link: row[1],
    messageUrl: row[2],
    unwrappedBy: row[3],
  })) ?? [];
  return gifts;
}

async function addGift(link: string, number: number, message: djs.Message) {
  await sheetsAppend(sheets, GIFT_SHEET_ID, "Gifts!A:D", [[
    number.toString(),
    link,
    message.url,
    "",
  ]]);
}

export const giftHandlers = [wrapHandler, unwrapHandler, deliveryHandler];
