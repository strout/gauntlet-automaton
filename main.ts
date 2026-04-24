import { CONFIG } from "./config.ts";

import { delay } from "@std/async";
import { parseArgs } from "@std/cli/parse-args";
import * as djs from "discord.js";
import { env, initSheets, sheets, sheetsWrite } from "./sheets.ts";

import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckEntry,
} from "./sealeddeck.ts";
import { pendingHandler } from "./pending.ts";
import { dispatch, Handler } from "./dispatch.ts";

import {
  addPoolChange,
  getExpectedPool,
  getPlayers,
  getPoolChanges,
  getPools,
  rebuildPoolContents,
  ROW,
  ROWNUM,
} from "./standings.ts";

import { ScryfallCard } from "./scryfall.ts";
import { handleGuildMemberAdd, manageRoles } from "./role_management.ts";
import { setup } from "./leagues/sos/sos.ts";

export { CONFIG };

// Parse command line arguments
const args = parseArgs(Deno.args, {
  boolean: ["pretend", "once", "help"],
  string: ["_"], // Positional arguments
  default: { pretend: false, once: false, help: false },
});

// Show help if requested
if (args.help) {
  console.log(`Usage: deno task start <command> [options]
   or: deno run main.ts <command> [options]

Commands:
  bot             Run the Discord bot
  pop             Populate pools
  pop-lorwyn      Populate Lorwyn pools only
  pop-shadowmoor  Populate Shadowmoor pools only
  check           Check pools
  rebuild         Rebuild pools

Options:
  --pretend  Run in pretend mode (prevent actual Discord role modifications)
  --once     Run role management once and exit (instead of looping)
  --help     Show this help message
  `);
  Deno.exit(0);
}

const { pretend, once } = args;
const command = args._[0]; // First positional argument is the command

export const DISCORD_TOKEN = env["DISCORD_TOKEN"];

const rebuildHandler: Handler<djs.Message> = async (message, handle) => {
  if (!isDM(message)) return;
  const rebuildPattern = /^\!rebuild /;
  if (!rebuildPattern.test(message.content)) return;
  handle.claim();
  const result = await handleRebuild(
    message.content.replace(rebuildPattern, ""),
  );
  if (result.error) {
    await message.reply(result.error);
  } else if (!result.ok) {
    await message.reply(
      `Rebuilt pool for ${result.name} from pool change log.\n\nRebuilt pool: ${result.newLink}\n\nOld pool: ${result.oldLink}\n\n(Rebuilt pool has **not** been added to the spreadsheet; place it in Pools!G${result.rowNum}.)`,
    );
  } else {
    // TODO why isn't this nerrowed
    await message.reply(
      `Current pool matches pool change log for ${result.name}.`,
    );
  }
};

const populateHandler: Handler<djs.Message> = async (message, handle) => {
  if (
    !isDM(message) || message.content !== "!populate" ||
    message.author.id !== CONFIG.OWNER_ID
  ) return;
  handle.claim();
  await populatePools(
    CONFIG.LIVE_SHEET_ID,
    (await (await message.client.guilds.fetch(CONFIG.GUILD_ID))
      .channels.fetch(CONFIG.STARTING_POOL_CHANNEL_ID))!,
  );
};

const populateLorwynHandler: Handler<djs.Message> = async (message, handle) => {
  if (
    !isDM(message) || message.content !== "!populate-lorwyn" ||
    message.author.id !== CONFIG.OWNER_ID
  ) return;
  handle.claim();
  await populateLorwynPools(
    CONFIG.LIVE_SHEET_ID,
    (await (await message.client.guilds.fetch(CONFIG.GUILD_ID))
      .channels.fetch(CONFIG.STARTING_POOL_CHANNEL_ID))!,
  );
};

const populateShadowmoorHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (
    !isDM(message) || message.content !== "!populate-shadowmoor" ||
    message.author.id !== CONFIG.OWNER_ID
  ) return;
  handle.claim();
  await populateShadowmoorPools(
    CONFIG.LIVE_SHEET_ID,
    (await (await message.client.guilds.fetch(CONFIG.GUILD_ID))
      .channels.fetch(CONFIG.STARTING_POOL_CHANNEL_ID))!,
  );
};

export const makeClient = () =>
  new djs.Client({
    intents: [
      "Guilds",
      "GuildMembers",
      "DirectMessages",
      "GuildMessages",
      "GuildMessageTyping",
      "MessageContent",
    ],
    partials: [djs.Partials.Channel, /* needed for DMs */ djs.Partials.Message],
  });

async function handleMessage(
  message: djs.Message<boolean>,
  messageHandlers: Handler<djs.Message<boolean>>[],
) {
  if (
    isDM(message) ||
    [CONFIG.PACKGEN_CHANNEL_ID, CONFIG.BOT_BUNKER_CHANNEL_ID].includes(
      message.channelId,
    )
  ) {
    // Skip logging bot messages with no text (e.g. Booster Tutor sends multiple empty messages + attachments)
    const isBotWithNoText = message.author.bot && !message.content?.trim();
    if (!isBotWithNoText) {
      console.log(
        `${message.author.displayName} in ${
          message.inGuild()
            ? "#" + message.channel.name + "@" + message.guild.name
            : message.channel.isDMBased()
            ? "a DM with " +
              ((): string => {
                const ch = message.channel as djs.DMChannel;
                return (
                  ch.recipient?.displayName ??
                    ch.recipient?.username ??
                    ch.recipientId ??
                    "unknown"
                );
              })()
            : "channel " + message.channel.name
        }: ${message.content}`,
      );
    }
  }
  const { claimed, finish } = await dispatch(message, [
    speakHandler,
    rebuildHandler,
    populateHandler,
    populateLorwynHandler,
    populateShadowmoorHandler,
    pendingHandler,
    deckCheckHandler,
    ...messageHandlers,
  ]);
  await finish;
  if (claimed) return;
}

const speakHandler: Handler<djs.Message> = async (message, handle) => {
  if (
    /^!say /.test(message.content) && !message.inGuild()
  ) {
    handle.claim();
    await speakAsBot(message);
  }
};

function isDM(message: djs.Message<boolean>): message is djs.Message<false> {
  return !message.inGuild();
}

async function onReady(
  client: djs.Client<true>,
  watch: (client: djs.Client<true>) => Promise<void>,
) {
  await Promise.all([manageRoles(client, pretend, once), watch(client)]);
}

async function handleRebuild(input: string) {
  const pools = await getPools();
  const changes = await getPoolChanges();
  for (const p of pools.filter((p) => (p.name + " ").startsWith(input + " "))) {
    console.log(p.name);
    const expected = await getExpectedPool(p.name, pools, changes);
    if (expected !== p.currentPoolLink) {
      return {
        name: p.name,
        rowNum: p.rowNum,
        ok: false,
        oldLink: p.currentPoolLink,
        newLink: expected,
      };
    } else {
      return { name: p.name, rowNum: p.rowNum, ok: true };
    }
  }
  return { ok: false, error: "No player found named " + input };
}

if (import.meta.main) {
  if (command === "bot") {
    await initSheets();

    const djs_client = makeClient();

    const { watch, messageHandlers, interactionHandlers } = await setup();

    configureClient(djs_client, watch, messageHandlers, interactionHandlers);

    await djs_client.login(DISCORD_TOKEN);
  }
  if (command === "pop") {
    console.log("init sheets");
    await initSheets();
    console.log("login");
    const djs_client = makeClient();
    await djs_client.login(DISCORD_TOKEN);
    console.log("populate");
    const guild = await djs_client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels
      .fetch(CONFIG.STARTING_POOL_CHANNEL_ID);
    await populatePools(CONFIG.LIVE_SHEET_ID, channel!);
  }
  if (command === "pop-lorwyn") {
    console.log("init sheets");
    await initSheets();
    console.log("login");
    const djs_client = makeClient();
    await djs_client.login(DISCORD_TOKEN);
    console.log("populate lorwyn");
    const guild = await djs_client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels
      .fetch(CONFIG.STARTING_POOL_CHANNEL_ID);
    await populateLorwynPools(CONFIG.LIVE_SHEET_ID, channel!);
  }
  if (command === "pop-shadowmoor") {
    console.log("init sheets");
    await initSheets();
    console.log("login");
    const djs_client = makeClient();
    await djs_client.login(DISCORD_TOKEN);
    console.log("populate shadowmoor");
    const guild = await djs_client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels
      .fetch(CONFIG.STARTING_POOL_CHANNEL_ID);
    await populateShadowmoorPools(CONFIG.LIVE_SHEET_ID, channel!);
  }
  if (command === "check") {
    await initSheets();
    await checkPools();
  }
  if (command === "rebuild") {
    await initSheets();
    const poolChanges = await getPoolChanges();
    const client = makeClient();
    client.once(djs.Events.ClientReady, async (client) => {
      await fullRebuild(client, poolChanges);
      await client.destroy();
    });
    await client.login(DISCORD_TOKEN);
  }
}

async function checkPools() {
  const pools = await getPools();
  const changes = await getPoolChanges();
  for (const p of pools) {
    console.log(p.name);
    const expected = await getExpectedPool(p.name, pools, changes);
    if (expected !== p.currentPoolLink) {
      console.log(p.name, "expected", expected, "but got", p.currentPoolLink);
    }
  }
}

function configureClient(
  djs_client: djs.Client<boolean>,
  watch: (client: djs.Client<true>) => Promise<void>,
  messageHandlers: Handler<djs.Message>[],
  interactionHandlers: Handler<djs.Interaction>[],
) {
  djs_client.once(djs.Events.ClientReady, (c) => onReady(c, watch));

  djs_client.on(djs.Events.GuildMemberAdd, async (member) => {
    await handleGuildMemberAdd(member, pretend);
  });

  // whenever we receive a message, log it and what channel it came from
  djs_client.on(
    djs.Events.MessageCreate,
    (message) => handleMessage(message, messageHandlers),
  );

  // treat message edits from booster tutor as new
  djs_client.on(djs.Events.MessageUpdate, async (oldMessage, _newMessage) => {
    const message = await oldMessage.fetch();
    if (message.author.id === CONFIG.BOOSTER_TUTOR_USER_ID) {
      await handleMessage(message, messageHandlers);
    }
  });

  djs_client.on(
    djs.Events.InteractionCreate,
    async (interaction) => {
      const { finish } = await dispatch(interaction, interactionHandlers);
      await finish;
    },
  );
}

async function speakAsBot(message: djs.Message) {
  const { args, body } = parseSay(message);
  const client = message.client;
  const [guild, channel, replyTo, user] = [
    args.get("guild"),
    args.get("channel"),
    args.get("replyTo"),
    args.get("user"),
  ];
  if (guild && channel) {
    const g = await client.guilds.fetch(guild);
    const c = await g.channels.fetch(channel) as djs.TextChannel;
    await c.sendTyping();
    console.log(
      "sending after " + Math.min(body.length * 300 / 60, 5_000) + "ms",
    );
    await delay(Math.min(body.length * 300 / 60, 5_000));
    if (replyTo) {
      const m = await c.messages.fetch(replyTo);
      await m.reply(body);
      await message.reply("Replied.");
    } else {
      await c.send(body);
      await message.reply("Sent.");
    }
    console.log("sent");
  } else if (user) {
    const u = await client.users.fetch(user);
    await u.dmChannel?.sendTyping();
    await delay(body.length / 300 * 60_000);
    if (replyTo) {
      const m = await u.dmChannel?.messages.fetch(replyTo);
      const reply = await m?.reply(body);
      await message.reply(reply ? "Replied." : "Couldn't reply.");
    } else {
      await u.send(body);
      await message.reply("Sent.");
    }
  } else {
    await message.reply(
      "I didn't understand that. `!say [link to a channel or message]` or `!say user:[user id]`",
    );
  }
}

function parseSay(message: djs.Message<boolean>) {
  const [command, ...bod] = message.content.split("\n");
  const body = bod.join("\n");
  let args;
  const match = command.match(
    /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/,
  );
  if (match) {
    args = new Map([["guild", match[1]], ["channel", match[2]], [
      "replyTo",
      match[3],
    ]]);
  } else {
    args = new Map(
      command.split(" ").slice(1).map((x) => x.split(":") as [string, string]),
    );
  }
  return { args, body };
}

export async function populateLorwynPools(
  sheetId: string,
  channel: djs.GuildBasedChannel,
) {
  if (!channel.isTextBased() || !channel.isSendable()) {
    throw new Error("only valid for text based channels.");
  }
  console.log("read lorwyn pools");
  const players = await getPlayers(sheetId);
  const poolChanges = await getPoolChanges(sheetId, "Lorwyn Pool Changes");
  console.log("got players", players.rows.length);
  console.log("got lorwyn pool changes", poolChanges.rows.length);
  const botId = channel.client.user?.id;
  if (!botId) {
    throw new Error("Could not get bot user ID from client");
  }
  const batches: djs.Collection<djs.Snowflake, djs.Message<true>>[] = [];
  for (const player of players.rows) {
    if (
      poolChanges.rows.some((p) =>
        p.Name === player.Identification && p.Type === "starting pool"
      )
    ) continue; // already there
    const discordId = player["Discord ID"];
    const name = player.Identification;
    if (!discordId) {
      console.warn("No discord id for " + name);
      continue;
    }
    console.log(name);
    // find bot's lorwyn pool message that mentions them; bail after 1000 messages.
    let lastMessageId: djs.Snowflake | undefined = undefined;
    batches: for (let i = 0; i < 10; i++) {
      let batch: djs.Collection<djs.Snowflake, djs.Message<true>>;
      if (batches.length > i) {
        batch = batches[i];
        console.log("reusing batch", i, "of", batches.length);
      } else {
        const options: djs.FetchMessagesOptions = {
          limit: 100,
          before: lastMessageId,
        };
        console.log("fetching batch", i, "with options", options);
        batch = await channel.messages.fetch(options);
        // TODO figure out why it's *slower* if we reuse batche batches.push(batch);
      }
      lastMessageId = batch.last()?.id;
      for (
        const [, msg] of batch.filter((m) => m.author.id === botId)
      ) {
        try {
          const ref = await msg.fetchReference();
          if (
            ref && ref.content.match(new RegExp(`^!lorwyn <@!?${discordId}>`))
          ) {
            // Look for any sealeddeck.tech link in the bot's message
            const sealeddeckMatch = msg.content.match(
              /(https:\/\/sealeddeck\.tech\/\w+)/,
            );
            if (sealeddeckMatch) {
              const sealeddeckLink = sealeddeckMatch[1];
              const sealeddeckId = sealeddeckLink.split("/").pop();
              if (sealeddeckId) {
                console.log(name, sealeddeckLink);
                console.log("fixing...");
                const pool = await fetchSealedDeck(sealeddeckId);
                await addPoolChange(
                  name,
                  "starting pool",
                  pool.poolId,
                  msg.url,
                  pool.poolId,
                  sheetId,
                  "Lorwyn Pool Changes",
                );
                break batches;
              }
            }
          }
        } catch (_e) {
          // Message doesn't reference another message, skip it
          continue;
        }
      }
    }
  }
}

export async function populateShadowmoorPools(
  sheetId: string,
  channel: djs.GuildBasedChannel,
) {
  if (!channel.isTextBased() || !channel.isSendable()) {
    throw new Error("only valid for text based channels.");
  }
  console.log("read shadowmoor pools");
  const players = await getPlayers(sheetId);
  const poolChanges = await getPoolChanges(sheetId, "Shadowmoor Pool Changes");
  console.log("got players", players.rows.length);
  console.log("got shadowmoor pool changes", poolChanges.rows.length);
  const batches: djs.Collection<djs.Snowflake, djs.Message<true>>[] = [];
  for (const player of players.rows) {
    if (
      poolChanges.rows.some((p) =>
        p.Name === player.Identification && p.Type === "starting pool"
      )
    ) continue; // already there
    const discordId = player["Discord ID"];
    const name = player.Identification;
    if (!discordId) {
      console.warn("No discord id for " + name);
      continue;
    }
    console.log(name);
    // find booster tutor message that mentions them; bail after 1000 messages.
    let lastMessageId: djs.Snowflake | undefined = undefined;
    batches: for (let i = 0; i < 10; i++) {
      let batch: djs.Collection<djs.Snowflake, djs.Message<true>>;
      if (batches.length > i) {
        batch = batches[i];
        console.log("reusing batch", i, "of", batches.length);
      } else {
        const options: djs.FetchMessagesOptions = {
          limit: 100,
          before: lastMessageId,
        };
        console.log("fetching batch", i, "with options", options);
        batch = await channel.messages.fetch(options);
        // TODO figure out why it's *slower* if we reuse batche batches.push(batch);
      }
      lastMessageId = batch.last()?.id;
      for (
        const [, msg] of batch.filter((m) =>
          m.author.id === CONFIG.BOOSTER_TUTOR_USER_ID
        )
      ) {
        const ref = await msg.fetchReference();
        if (ref?.mentions.has(discordId)) { // this is the one!
          const sealeddeckIdField = msg
            .embeds[0]?.fields.find((f) => f.name === "SealedDeck.Tech ID");
          const sealeddeckId = sealeddeckIdField?.value.replace(/`/g, "")
            .trim();
          if (sealeddeckId) {
            const sealeddeckLink = "https://sealeddeck.tech/" + sealeddeckId;
            console.log(name, sealeddeckLink);
            console.log("fixing...");
            const pool = await fetchSealedDeck(sealeddeckId);
            await addPoolChange(
              name,
              "starting pool",
              pool.poolId,
              msg.url,
              pool.poolId,
              sheetId,
              "Shadowmoor Pool Changes",
            );
            break batches;
          }
        }
      }
    }
  }
}

export async function populatePools(
  sheetId: string,
  channel: djs.GuildBasedChannel,
  messagePredicate: (message: djs.Message) => boolean = () => true,
) {
  if (!channel.isTextBased() || !channel.isSendable()) {
    throw new Error("only valid for text based channels.");
  }
  console.log("read pools");
  const players = await getPlayers(sheetId);
  const poolChanges = await getPoolChanges(sheetId);
  console.log("got players", players.rows.length);
  console.log("got pool changes", poolChanges.rows.length);
  let rowNum = 6;
  const batches: djs.Collection<djs.Snowflake, djs.Message<true>>[] = [];
  for (const player of players.rows) {
    rowNum++;
    if (
      poolChanges.rows.some((p) =>
        p.Name === player.Identification && p.Type === "starting pool"
      )
    ) continue; // already there
    const discordId = player["Discord ID"];
    const name = player.Identification;
    if (!discordId) {
      console.warn("No discord id for " + name);
      continue;
    }
    console.log(name);
    // find booster tutor message that mentions them; bail after 1000 messages.
    let lastMessageId: djs.Snowflake | undefined = undefined;
    batches: for (let i = 0; i < 10; i++) {
      let batch: djs.Collection<djs.Snowflake, djs.Message<true>>;
      if (batches.length > i) {
        batch = batches[i];
        console.log("reusing batch", i, "of", batches.length);
      } else {
        const options: djs.FetchMessagesOptions = {
          limit: 100,
          before: lastMessageId,
        };
        console.log("fetching batch", i, "with options", options);
        batch = await channel.messages.fetch(options);
        // TODO figure out why it's *slower* if we reuse batche batches.push(batch);
      }
      lastMessageId = batch.last()?.id;
      for (
        const [, msg] of batch.filter((m) =>
          m.author.id === CONFIG.BOOSTER_TUTOR_USER_ID
        )
      ) {
        const ref = await msg.fetchReference();
        if (ref?.mentions.has(discordId) && messagePredicate(ref)) { // this is the one!
          const sealeddeckIdField = msg
            .embeds[0]?.fields.find((f) => f.name === "SealedDeck.Tech ID");
          const sealeddeckId = sealeddeckIdField?.value.replace(/`/g, "")
            .trim();
          if (sealeddeckId) {
            const sealeddeckLink = "https://sealeddeck.tech/" + sealeddeckId;
            console.log(name, sealeddeckLink);
            console.log("fixing...");
            const pool = await fetchSealedDeck(sealeddeckId);
            await addPoolChange(
              name,
              "starting pool",
              pool.poolId,
              msg.url,
              pool.poolId,
              sheetId,
            );
            break batches;
          }
        }
      }
    }
  }
}

export async function fetchMessageByUrl(client: djs.Client, url: string) {
  const [gid, cid, mid] = url.split("/").slice(-3);
  let channel: djs.TextBasedChannel;
  if (gid === "@me") {
    channel = await client.channels.fetch(cid) as djs.DMChannel;
  } else {
    const guild = await client.guilds.fetch(gid);
    channel = await guild.channels.fetch(cid) as djs.TextChannel;
  }
  return await channel.messages.fetch(mid);
}

export async function fetchChannelByUrl(client: djs.Client, url: string) {
  const [gid, cid] = url.split("/").slice(-2);
  let channel: djs.TextBasedChannel;
  if (gid === "@me") {
    channel = await client.channels.fetch(cid) as djs.DMChannel;
  } else {
    const guild = await client.guilds.fetch(gid);
    channel = await guild.channels.fetch(cid) as djs.TextChannel;
  }
  return channel;
}

export const deckCheckHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  const [command, arg] = message.content.split(" ");
  if (command.toLowerCase() !== "!deckcheck") return;
  handle.claim();
  try {
    let pool;
    try {
      pool = await fetchSealedDeck(arg.split("/").slice(-1)[0]);
    } catch (e) {
      console.error(e);
      await message.reply("Couldn't look up the pool " + arg);
      return;
    }
    const cardIds = new Map(
      [...pool.deck, ...pool.sideboard].map(
        (x) => [x.name, { name: x.name.split(" //")[0], set: x.set }],
      ),
    );
    const cardEntries = new Map<string, ScryfallCard>();
    let warned = false;
    for (let i = 0; i < cardIds.size; i += 75) {
      const ents = [...cardIds.entries()].slice(i, i + 75);
      const resp = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ents.map((x) => x[1]) }),
      });
      if (!resp.ok) {
        console.error(
          "fetching scryfall collection",
          resp.status,
          resp.statusText,
        );
        await message.reply("Couldn't look up cards on scryfall :(");
        return;
      }
      const body = await resp.json();
      for (
        const newEnt of ents.filter(([, ident]) =>
          !body.not_found?.some((x: { name: string; set?: string }) =>
            x.name === ident.name && x.set === ident.set
          )
        ).map(([name], i) => [name, body.data[i]] as const)
      ) {
        cardEntries.set(...newEnt);
      }
      if (body.not_found?.length) {
        if (!warned) {
          await message.reply(
            ":warning: Couldn't look up all the cards on scryfall. This may cause the check to be wrong.\nNot found: " +
              JSON.stringify(body.not_found),
          );
        }
        warned = true;
      }
      await delay(1000);
    }
    const currentPools = await getPools();
    const currentPool = currentPools.find((x) => x.id === message.author.id);
    const currentPoolContent = currentPool &&
      await fetchSealedDeck(
        currentPool.currentPoolLink.split("/").slice(-1)[0],
      );
    const cards = new Map<string, number>();
    for (
      const ent of [
        ...currentPoolContent?.deck ?? [],
        ...currentPoolContent?.hidden ?? [],
        ...currentPoolContent?.sideboard ?? [],
      ]
    ) {
      cards.set(ent.name, (cards.get(ent.name) ?? 0) + ent.count);
    }
    const cardsWithSb = new Map(cards);
    for (const ent of [...pool.deck, ...pool.sideboard]) {
      cardsWithSb.set(ent.name, (cardsWithSb.get(ent.name) ?? 0) - ent.count);
    }
    for (const ent of [...pool.deck]) {
      cards.set(ent.name, (cards.get(ent.name) ?? 0) - ent.count);
    }
    const extraCardsMain = currentPool &&
      [...cards.entries()].filter((x) => x[1] < 0).map((x) =>
        Math.abs(x[1]) + " " + x[0]
      ).join(", ");
    const extraCardsWithSb = currentPool &&
      [...cardsWithSb.entries()].filter((x) => x[1] < 0).map((x) =>
        Math.abs(x[1]) + " " + x[0]
      ).join(", ");
    const colorIdentity = (cards: readonly SealedDeckEntry[]) =>
      [
        ...new Set(
          cards.map((x) => cardEntries.get(x.name)).flatMap((x) =>
            x?.color_identity ?? []
          ),
        ),
      ].join("") || "no colors";
    await message.reply(
      `Card count: ${
        cardCount(pool.deck)
      } main deck\nLeague decks should be at least 60 cards.\n\nColor identity:\n* ${
        colorIdentity(pool.deck)
      } main deck\n* ${
        colorIdentity([...pool.deck, ...pool.sideboard])
      } including sidebaord\n\nCards not in pool:\n* main deck: ${
        extraCardsMain || "none"
      }\n* including sidebaord: ${
        extraCardsWithSb || "none"
      }\n\n*Please tell <@${CONFIG.OWNER_ID}> if this seems wrong. This tool may give incorrect information, and you are ultimately responsible for ensuring your deck meets league requirements.*`,
    );
  } catch (e) {
    console.error(e);
    await message.reply("Something broke!");
    const owner = await message.client.users.fetch(CONFIG.OWNER_ID);
    await owner.send(
      "Couldn't analyze " + arg + " for <@" + message.author.id + ">",
    );
  }
};

function cardCount(deck: readonly SealedDeckEntry[]) {
  return deck.reduce((a, b) => a + b.count, 0);
}

async function fullRebuild(
  client: djs.Client<true>,
  _poolChanges: Awaited<ReturnType<typeof getPoolChanges>>,
) {
  // go through each and every entry, identify what's different, and DM CONFIG.OWNER_ID with differences as a table with row number | cards different (+ or -) | old id | new id
  const pools = new Map<
    string,
    {
      sideboard: readonly SealedDeckEntry[];
      poolId: string;
      unsaved: Awaited<ReturnType<typeof getPoolChanges>>["rows"];
    }
  >();
  const changes = await getPoolChanges();
  let differences: string =
    " Row | Name | Type | Value | Comment | Full Pool | Difference\n" +
    "-----|------|------|-------|---------|-----------|-----------\n";
  console.log(differences);
  for (const change of changes.rows) {
    console.log("...");
    if (change["Full Pool"]) {
      const actual = await fetchSealedDeck(change["Full Pool"]);
      const baseId = change.Type === "starting pool"
        ? undefined
        : pools.get(change.Name)!.poolId;
      const expected = change.Type === "starting pool"
        ? (await fetchSealedDeck(change.Value)).sideboard
        : await rebuildPoolContents([
          [change.Timestamp, change.Name, "starting pool", baseId!],
          ...[...pools.get(change.Name)!.unsaved, change].map((c) =>
            c[ROW] as [number | string, string, string, string]
          ),
        ]);
      const difference = diffPools(actual.sideboard, expected);
      if (difference) {
        const expectedPoolId = await makeSealedDeck({ sideboard: expected });
        pools.set(change.Name, {
          sideboard: expected,
          poolId: expectedPoolId,
          unsaved: [],
        });
        const row = ` ${
          change[ROWNUM]
        } | ${change.Name} | ${change.Type} | ${change.Value} | ${change.Comment} | ${expectedPoolId} | ${actual.poolId} | ${
          formatPoolDiffs(difference)
        }\n`;
        console.log(row);
        // save the new value to the sheet; put the old one in column G just in case
        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          "Pool Changes!F" + change[ROWNUM] + ":G" + change[ROWNUM],
          [[
            expectedPoolId,
            actual.poolId,
          ]],
        );
        differences += row;
      } else {
        pools.set(change.Name, {
          sideboard: actual.sideboard,
          poolId: actual.poolId,
          unsaved: [],
        });
      }
    } else {
      const entry = pools.get(change.Name);
      entry?.unsaved.push(change);
    }
  }

  const user = await client.users.fetch(CONFIG.OWNER_ID);
  await user.send(differences);
}

type PoolDiffRow = { name: string; expectedCount: number; actualCount: number };

function diffPools(
  actual: readonly SealedDeckEntry[],
  expected: readonly SealedDeckEntry[],
) {
  // note that in "actual" and "expected" there *may* be duplicate entries (same card, different set) and we want to sum those together
  // Also we should normalize names by stripping off anything after " //" and lowercasing
  const actualCounts = new Map<string, number>();
  for (const entry of actual) {
    const name = entry.name.split(" //")[0].toLowerCase();
    actualCounts.set(name, (actualCounts.get(name) ?? 0) + entry.count);
  }
  const expectedCounts = new Map<string, number>();
  for (const entry of expected) {
    const name = entry.name.split(" //")[0].toLowerCase();
    expectedCounts.set(name, (expectedCounts.get(name) ?? 0) + entry.count);
  }
  const diffs: PoolDiffRow[] = [];
  for (const [name, count] of expectedCounts) {
    const actualCount = actualCounts.get(name);
    if (actualCount !== count) {
      diffs.push({ name, expectedCount: count, actualCount: actualCount ?? 0 });
    }
  }
  // also get any entirely missing from expected
  for (const [name, count] of actualCounts) {
    if (!expectedCounts.has(name)) {
      diffs.push({ name, expectedCount: 0, actualCount: count });
    }
  }
  return diffs.length ? diffs : null;
}

function formatPoolDiffs(diffs: PoolDiffRow[]) {
  return diffs.map((x) => `${x.name}: ${x.expectedCount} vs ${x.actualCount}`)
    .join(", ");
}
