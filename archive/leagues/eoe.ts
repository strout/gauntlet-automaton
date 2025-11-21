/* Edge of Eternities: Ships! Planets!
 * Notes:
 * * There's a starmap, which is a hex grid with radius ~44 (exact # to be determined), planets,
 *   and ships. Planets might be randomly discovered (i.e. created) when a player moves to an
 *   unseen space. Planets can also be destroyed.
 * * Grid configuration, planet creation/destruction, ship positioning all exist in a log in
 *   the league's sheet. That is the source of truth.
 * * On each loss, players get a prompt to pick a pack from any discvoered unexploded planet.
 *   * Unresolved: is it picked from planets _at the time of loss_ or _at the time of choice_?
 *     What happens if a player banks a choice over a week boundary or waits for a discovery?
 * * On each win, players get a prompt to move their ship (or place it then move it, if it
 *   hasn't been placed). They move 3 spaces, specifying directions.
 *   * The message prompting their moves should have a preview of the map with the move,
 *     to make it easier to visualize.
 *   * Unclaimed moves get transferred to the ship's captain at the end of the week. They can
 *     still be made by the player. So we'll need to track 2 messages potentially.
 *     * Allowing both removes awkward edge cases around just-before-end-of-week matches.
 * * On planet discovery (part of the movement implementation) each player on that ship gets
 *   an identical rare/mythic from that set.
 */

/* TODO
  * [~] draw planets -- still need to get text or set symbols or something working
  * [x] track state within ship placement
  * [x] submit ship placement
  * [x] submit move
  * [x] track available ship moves
  * [x] random chance of planet discovery on move
  * [x] reward cards for planets
  * [x] use messages from sheet for planet discovery
  * [x] add locks for interaction handlers etc
  * [x] pack selection & generation
  * [x] prevent double-messaging
  * [x] (external) make sawyer's bot use the right sheet
  * [x] planet destruction (POST-LAUNCH)
  * [ ] don't send pack msg to elim'd players (POST-LAUNCH)
  * [x] make sure ship shows up during placement
  */

import { delay } from "@std/async";
import {
  addPoolChanges,
  getAllMatches,
  getEntropy,
  getMatches,
  getPlayers,
  getPoolChanges,
  getQuotas,
  MATCHTYPE,
  parseTable,
  Player,
  readTable,
  ROW,
  ROWNUM,
  Table,
} from "../../standings.ts";
import { z } from "zod";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  Interaction,
  InteractionUpdateOptions,
  Message,
  MessageCreateOptions,
  StringSelectMenuBuilder,
  TextChannel,
} from "discord.js";
import { CONFIG } from "../../config.ts";
import {
  CanvasRenderingContext2D,
  createCanvas,
  Image,
  loadImage,
} from "@gfx/canvas-wasm";
import { Buffer } from "node:buffer";
import { Handler } from "../../dispatch.ts";
import {
  initSheets,
  readSheetsDate,
  sheets,
  sheetsAppend,
  sheetsWrite,
  utcOffsetMs,
} from "../../sheets.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckPool,
} from "../../sealeddeck.ts";
import { mutex } from "../../mutex.ts";
import { DISCORD_TOKEN, makeClient } from "../../main.ts";
import { extractPool } from "../../pending.ts";

const mapLock = mutex();

export const playerExtra = { Ship: z.string(), "EOE Packs Opened": z.number() };
type EOEPlayer = Player<typeof playerExtra>;

async function makeChangesToAddPack(
  pack: SealedDeckPool,
  player: Player,
  poolChanges: Awaited<ReturnType<typeof getPoolChanges>>["rows"],
  comment?: string,
) {
  console.log("locking pool");
  using _ = await lockPool(player);
  const previousPoolId =
    poolChanges.findLast((r) => r.Name === player.Identification)
      ?.["Full Pool"] ?? undefined;
  const newPoolId = await makeSealedDeck(
    { ...pack, poolId: undefined } as Omit<SealedDeckPool, "poolId"> & {
      poolId: undefined;
    },
    previousPoolId,
  );
  console.log("new pool", newPoolId);
  const row: [string, string, string, string, string | undefined] = [
    player.Identification,
    "add pack",
    pack.poolId,
    comment ?? "",
    undefined,
  ];
  const ret = new Array<typeof row>(1).fill(row);
  ret[ret.length - 1][4] = newPoolId;
  return ret;
}

export async function repopPacks() {
  const client = makeClient();
  client.once("ready", async (client) => {
    console.log("connected, getting players");
    const players = await getPlayers(CONFIG.LIVE_SHEET_ID, playerExtra);
    const startMessageId = "1400949783966908529";
    const endMessageId = "1400963491564617780";
    console.log("getting messages");
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const channel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as TextChannel;
    const messages = await channel.messages.fetch({
      before: endMessageId,
      after: startMessageId,
      limit: 100,
    });
    console.log(messages.size);
    for (const m of messages.values()) {
      if (m.author.id !== CONFIG.BOOSTER_TUTOR_USER_ID) continue;
      try {
        const ref = await m.fetchReference();
        const refUserId = ref.content.match(/<@!?(\d+)>/)![1];
        const player = players.rows.find((x) => x["Discord ID"] === refUserId);
        const pack = await extractPool(m);
        console.log(player?.Identification, pack?.poolId);
        if (!pack || !player) continue;
        console.log("getitng pool changes");
        const newLocal = await getPoolChanges();
        console.log("making new changes");
        const newLocal_1 = await makeChangesToAddPack(
          pack,
          player,
          newLocal.rows,
          "recovered pack",
        );
        console.log("recording");
        await addPoolChanges(newLocal_1);
      } catch (e) {
        console.error(e);
        continue;
      }
    }
    await client.destroy();
    Deno.exit(0);
  });
  await client.login(DISCORD_TOKEN);
}

async function makeChangesToAddCard(
  card: { name: string; set?: string; count?: number },
  player: Player,
  poolChanges: Awaited<ReturnType<typeof getPoolChanges>>["rows"],
  comment?: string,
) {
  using _ = await lockPool(player);
  const previousPoolId =
    poolChanges.findLast((r) => r.Name === player.Identification)
      ?.["Full Pool"] ?? undefined;
  const newPoolId = await makeSealedDeck({ sideboard: [card] }, previousPoolId);
  const row: [string, string, string, string, string | undefined] = [
    player.Identification,
    "add card",
    card.name,
    comment ?? "",
    undefined,
  ];
  const ret = new Array<typeof row>(card.count ?? 1).fill(row);
  ret[ret.length - 1][4] = newPoolId;
  return ret;
}

async function checkForMatches(client: Client<boolean>) {
  const matches = await getMatches();
  const entropy = await getEntropy();
  const players = await getPlayers(undefined, playerExtra);
  const allMatches = [...matches.rows, ...entropy.rows].sort((a, b) =>
    a.Timestamp - b.Timestamp
  );
  const mapState = await readMapState();
  let i = -1;
  for (const m of allMatches) {
    i++; // we started at -1 so this is 0-based index of the current match
    if (!m["Script Handled"] || m["Bot Messaged"]) continue;
    const loser = players.rows.find((p) =>
      p.Identification === m["Loser Name"]
    );
    if (!loser) throw new Error("Can't find loser for " + m[ROW]);
    let winner;
    if (m[MATCHTYPE] === "match") {
      winner = players.rows.find((p) => p.Identification === m["Your Name"]);
      if (!winner) throw new Error("Can't find winner for " + m[ROW]);
    } else {
      winner = null;
    }
    const lossCount = allMatches.slice(0, i + 1).filter((m) =>
      m["Loser Name"] === loser!.Identification
    ).length;
    const tasks = [askForPack(client, loser, mapState, m, lossCount)];
    if (winner) {
      tasks.push(askToMove(client, winner, mapState));
    }
    const results = await Promise.allSettled(tasks);
    if (
      !results.every((x) =>
        x.status === "fulfilled"
      )
    ) {
      const errors = results.filter((x) => x.status === "rejected");
      try {
        const owner = await client.users.fetch(CONFIG.OWNER_ID);
        await owner.send(
          `Failed to handle match ${m[MATCHTYPE]}!${m[ROWNUM]}: ${
            errors.map((x) => x.reason?.toString())
          }`,
        );
      } finally {
        console.error(errors);
      }
    }
    await sheetsWrite(
      sheets,
      CONFIG.LIVE_SHEET_ID,
      m[MATCHTYPE] === "match"
        ? `Matches!R${m[ROWNUM]}C${matches.headerColumns["Bot Messaged"] + 1}`
        : `Entropy!R${m[ROWNUM]}C${entropy.headerColumns["Bot Messaged"] + 1}`,
      [[true]],
    );
  }
}

export async function setup() {
  await Promise.resolve();
  return {
    watch: async (client: Client) => {
      while (true) {
        await checkForMatches(client);
        await delay(60_000);
      }
    },
    messageHandlers: [handleMap],
    interactionHandlers: [handlePackChoice, handleMoveChoice],
  };
}

const handleMap: Handler<Message> = async (msg, handle) => {
  if (msg.inGuild() || msg.content !== "!map") return;
  handle.claim();
  const [players, mapState] = await Promise.all([
    getPlayers(CONFIG.LIVE_SHEET_ID, playerExtra),
    readMapState(),
  ]);
  const player = players.rows.find((p) => p["Discord ID"] === msg.author.id);
  if (!player) return;
  const fuel = calcFuel(player, mapState);
  if (!fuel) await msg.reply("You have no fuel.");
  else if (player.Wins === 0) await msg.reply("You have no wins.");
  else {await msg.reply(
      buildMoveMessage(mapState, player.Ship, calcFuel(player, mapState)),
    );}
};

export const test = async () => {
  const [players, mapState] = await Promise.all([
    getPlayers(CONFIG.LIVE_SHEET_ID, playerExtra),
    readMapState(),
  ]);
  const player = players.rows.find((p) =>
    p.Identification.startsWith("James C")
  );
  if (!player) return;
  const fuel = calcFuel(player, mapState);
  if (!fuel) return ("You have no fuel.");
  else if (player.Wins === 0) return ("You have no wins.");
  else {return (buildMoveMessage(
      mapState,
      player.Ship,
      calcFuel(player, mapState),
    ));}
};

const poolLocks = new Map<string, () => Promise<Disposable>>();
const lockPool = (player: Player) => {
  let lock = poolLocks.get(player["Discord ID"]);
  if (!lock) poolLocks.set(player["Discord ID"], lock = mutex());
  return lock();
};

const handlePackChoice: Handler<Interaction> = async (interaction, handle) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
  const parsedId = readPackMessageState(interaction.customId);
  if (
    interaction.isButton() && parsedId?.type === "submit"
  ) {
    handle.claim();
    await interaction.deferReply();
    const value = interaction.message.components
      .flatMap((x) => x.type === ComponentType.ActionRow ? x.components : [])
      .filter((x) => x.type === ComponentType.StringSelect)
      .flatMap((x) => x.options)
      .find((o) => o.default)?.value;
    const [players, matches, mapState] = await Promise.all([
      getPlayers(undefined, playerExtra),
      getAllMatches(),
      readMapState(),
    ]);
    // TODO add logic if the player isn't found instead of using `!`
    const player = players.rows.find((x) =>
      x["Discord ID"] === interaction.user.id
    )!;
    // lock the pool just to slow down submissions; idk maybe someone will try to claim many EOEs at once?
    using _ = await lockPool(player);
    // we validate that it's still there by:
    // 1) making sure that planet was present at the time
    // 2) making sure they *currently* have eoe packs allowed if they're choosing it
    // 3) making sure the entropy or match with the timestamp exists & they're the loser
    const planet = value && mapState.planets.get(value);
    const matchRowStamp = parsedId.matchRowStamp;
    const { previousLosses, match } = findLossAndPrevious(
      matches,
      matchRowStamp,
      player,
    );
    const eoeOk = value !== "EOE" ||
      player["EOE Packs Opened"] * 2 < (previousLosses + 1) &&
        player["EOE Packs Opened"] * 2 < player.Losses;
    const timeOk = !planet ||
      match && (planet.discoveredWeek < match.WEEK &&
          (!planet.exhaustedWeek || planet.exhaustedWeek >= match.WEEK));
    console.log({ value, eoeOk, planet, timeOk, match });
    // TODO I know match is possibly undefined but TS doesn't, how to type it better?
    if (!match) {
      // don't rebuild the message for this.
      await interaction.editReply(
        "Hmm, looks like the match report for this selection was deleted.",
      );
    } else if (!value) {
      await interaction.message.edit(
        buildPackMessage(
          player,
          mapState,
          parsedId.includeEoe,
          parsedId.timeFirstSent,
          parsedId.matchRowStamp,
          match.WEEK,
          previousLosses + 1,
          value,
        ),
      );
      await interaction.editReply(
        "Couldn't find your selection, something is wrong, try again.",
      );
    } else if (!eoeOk) {
      await interaction.message.edit(
        buildPackMessage(
          player,
          mapState,
          parsedId.includeEoe,
          parsedId.timeFirstSent,
          parsedId.matchRowStamp,
          match?.WEEK,
          previousLosses + 1,
          value,
        ),
      );
      await interaction.editReply(
        "You've already taken all the EOE packs you're allowed for now. Try another option.",
      );
    } else if (!timeOk) {
      await interaction.message.edit(
        buildPackMessage(
          player,
          mapState,
          parsedId.includeEoe,
          parsedId.timeFirstSent,
          parsedId.matchRowStamp,
          match.WEEK,
          previousLosses + 1,
          value,
        ),
      );
      await interaction.editReply(
        "Hmm, that planet isn't available. Try another option.",
      );
    } else {
      // all validations pass, make the pack!
      const set = value === "MKM" ? "a-MKM" : value;
      const packMsg = `!${set} <@!${player["Discord ID"]}> gets a pack.`;
      const guild = await interaction.client.guilds.fetch(CONFIG.GUILD_ID);
      const channel = await guild.channels.fetch(
        CONFIG.PACKGEN_CHANNEL_ID,
      ) as TextChannel;
      const msg = await channel.send(packMsg);
      await interaction.message.edit({ components: [] });
      await interaction.editReply("Your pack was generated. " + msg.url);
      await sheetsAppend(sheets, CONFIG.LIVE_SHEET_ID, "Packs Chosen!A:C", [[
        new Date().toISOString(),
        player.Identification,
        value,
      ]]);
    }
  } else if (
    interaction.isStringSelectMenu() && parsedId?.type === "select"
  ) {
    handle.claim();
    await interaction.deferReply();
    const [value] = interaction.values;
    const [players, matches, mapState] = await Promise.all([
      getPlayers(undefined, playerExtra),
      getAllMatches(),
      readMapState(),
    ]);
    // TODO add logic if the player isn't found instead of using `!`
    const player = players.rows.find((x) =>
      x["Discord ID"] === interaction.user.id
    )!;
    const { previousLosses, match } = findLossAndPrevious(
      matches,
      parsedId.matchRowStamp,
      player,
    );
    if (!match) {
      // don't rebuild the message for this.
      await interaction.editReply(
        "Hmm, looks like the match report for this selection was deleted.",
      );
      return;
    }
    await interaction.message.edit(
      buildPackMessage(
        player,
        mapState,
        parsedId.includeEoe,
        parsedId.timeFirstSent,
        parsedId.matchRowStamp,
        match.WEEK,
        previousLosses + 1,
        value,
      ),
    );
    await interaction.deleteReply();
  }
};

const handleMoveChoice: Handler<Interaction> = async (interaction, handle) => {
  // TODO rewrite this a bit; switched to move buttons
  if (interaction.isButton()) console.log(interaction.customId);
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("EOE_place_submit_")
  ) {
    handle.claim();
    await interaction.deferReply();
    // lock the map before read/write operations
    using _ = await mapLock();
    const coord =
      interaction.customId.match(/^EOE_place_submit_(.+,.+)$/)?.[1] ??
        "0,0";
    const [players, mapState] = await Promise.all([
      getPlayers(undefined, playerExtra),
      readMapState(),
    ]);
    // TODO add logic if the player isn't found instead of using `!`
    const player = players.rows.find((x) =>
      x["Discord ID"] === interaction.user.id
    )!;
    const fuel = calcFuel(player, mapState);
    if (!mapState.ships.has(player.Ship)) {
      const parsed = parseCoord(coord);
      await addExpLog([["add_ship", player.Ship, parsed.q, parsed.r]]);
    } else {
      console.warn("Ship already placed", player.Ship);
    }
    const newMapState = await readMapState();
    await interaction.message.edit(
      buildMoveMessage(newMapState, player.Ship, fuel),
    );
    await interaction.deleteReply();
  } else if (
    interaction.isButton() &&
    interaction.customId.startsWith("EOE_place_")
  ) {
    handle.claim();
    await interaction.deferReply();
    const coord =
      interaction.customId.match(/^EOE_place_([^_,]+,[^_]+)_*$/)?.[1] ??
        "0,0";
    const [players, mapState] = await Promise.all([
      getPlayers(undefined, playerExtra),
      readMapState(),
    ]);
    // TODO add logic if the player isn't found instead of using `!`
    const player = players.rows.find((x) =>
      x["Discord ID"] === interaction.user.id
    )!;
    console.log(player.Identification, coord, "placing");
    await interaction.message.edit(
      buildMoveMessage(
        mapState,
        player.Ship,
        calcFuel(player, mapState),
        coord,
      ),
    );
    await interaction.deleteReply();
  } else if (
    interaction.isButton() &&
    interaction.customId.startsWith("EOE_move_")
  ) {
    handle.claim();
    await interaction.deferReply();
    // lock the map before read/write operations
    // it needs to be the whole map because we mgiht discover a planet
    using _ = await mapLock();
    const [players, mapState] = await Promise.all([
      getPlayers(undefined, playerExtra),
      readMapState(),
    ]);
    // TODO add logic if the player isn't found instead of using `!`
    const player = players.rows.find((x) =>
      x["Discord ID"] === interaction.user.id
    )!;
    const oldFuel = calcFuel(player, mapState);
    const [, newCoord, oldCoord] =
      interaction.customId.match(/^EOE_move_(.+,.+)_(.+,.+)$/) ??
        ([] as undefined[]);
    if (
      !newCoord || !oldCoord || !mapState.ships.has(player.Ship) ||
      hexDistance(parseCoord(oldCoord), mapState.ships.get(player.Ship)!) > 0.5
    ) {
      // something's wrong just refresh
      await interaction.message.edit(
        buildMoveMessage(mapState, player.Ship, oldFuel),
      );
      await interaction.editReply("Something was out of date, try again.");
      return;
    }
    const parsed = parseCoord(newCoord);
    if (oldFuel <= 0) {
      await interaction.message.edit({
        components: [],
        files: [makeMapFile(mapState, player.Ship)],
      });
      await interaction.editReply(
        "All done for now! (You were out of fuel somehow?)",
      );
      return;
    }
    const planet = discover(mapState, parsed);
    const logs = [[
      "move_ship",
      player.Ship,
      parsed.q,
      parsed.r,
      player.Identification,
    ]];
    if (planet) {
      // more fun if the planet "appears" first
      logs.unshift(["add_planet", planet, parsed.q, parsed.r, player.Ship]);
    }
    await addExpLog(logs);
    // we've finished writing to the map, so we can dispose a bit early; no need for others to wait on announcements
    _[Symbol.dispose]();
    const newMapState = await readMapState();
    const newFuel = calcFuel(player, newMapState);
    if (newFuel <= 0) {
      // no more moves left
      await interaction.message.edit({
        components: [],
        files: [makeMapFile(newMapState, player.Ship)],
      });
      await interaction.editReply("All done for now!");
    } else {
      // more moves to make!
      await interaction.message.edit(
        buildMoveMessage(newMapState, player.Ship, newFuel),
      );
      await interaction.deleteReply();
    }
    if (planet) {
      await rewardPlanet(players, player.Ship, planet, interaction.client);
    }
  }
};

function findLossAndPrevious(
  matches: Awaited<ReturnType<typeof getAllMatches>>,
  matchRowStamp: number,
  player: EOEPlayer,
) {
  const matchIndex = matches.rows.findIndex((m) =>
    Math.abs(m.Timestamp - matchRowStamp) < /* must be the same second */
      (1 / 24 / 60 / 60 / 1000) &&
    m["Loser Name"] === player.Identification
  );
  const match = matches.rows[matchIndex];
  const previousLosses =
    matches.rows.slice(0, matchIndex).filter((m) =>
      m["Loser Name"] === player.Identification
    ).length;
  return { previousLosses, match };
}

export async function rewardPlanet(
  players: Table<EOEPlayer> | undefined,
  ship: string,
  planet: string,
  client: Client<true>,
) {
  players ??= await getPlayers(CONFIG.LIVE_SHEET_ID, playerExtra);
  const crew = players.rows.filter((p) => p.Ship === ship);
  const card = await getRewardCard(planet);
  await Promise.all([
    announceRewardCard(client, planet, card, crew),
    recordRewardCard(crew, card),
  ]);
}

export async function getRewardCard(planet: string) {
  const cards = await getRewardOptions(planet);
  const card = cards[Math.random() * cards.length | 0];
  return card;
}

export async function getRewardOptions(planet: string) {
  return await searchCards(
    `set:${planet} ${(["PIO", "SIR"].includes(planet)
      ? ""
      : "is:booster ")}(-kw:meld or o:'melds with') game:arena r>=r`,
  );
}

export async function announceRewardCard(
  client: Client,
  planet: string,
  card: ScryfallCard,
  crew: EOEPlayer[],
) {
  const message = messages.rows.find((r) => r.Set === planet);

  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.EOE.ANNOUNCE_CHANNEL_ID,
  ) as TextChannel;
  const imageUrl = card.image_uris?.normal ??
    card.card_faces?.[0]?.image_uris?.normal;
  await channel.send(
    {
      content: `The crew of ${
        crew[0].Ship
      } has discovered the planet ${planet}! They each get ${card.name}.\n${
        crew.map((x) => `<@!${x["Discord ID"]}>`).join(", ")
      }.`,
      embeds: [
        {
          title: planet,
          description: message?.Blurb ?? "???",
          footer: { text: `Written by ${message?.Writer ?? "???"}` },
        },
        { title: card.name, image: imageUrl ? { url: imageUrl } : undefined },
      ],
    },
  );
}

export async function recordRewardCardForShip(
  ship: string,
  card: { name: string; set: string },
) {
  const players = await getPlayers(CONFIG.LIVE_SHEET_ID, playerExtra);
  const crew = players.rows.filter((x) => x.Ship === ship);
  await recordRewardCard(crew, card);
}

async function recordRewardCard(
  crew: EOEPlayer[],
  card: { name: string; set: string },
) {
  const poolChanges = await getPoolChanges();
  const changes = await Promise.all(
    crew.map((p) =>
      makeChangesToAddCard(
        { name: card.name, set: card.set },
        p,
        poolChanges.rows,
        "Discovered " + card.set,
      )
    ),
  );
  await addPoolChanges(changes.flat());
}

async function askForPack(
  client: Client,
  player: EOEPlayer,
  mapState: MapState,
  match: Awaited<
    ReturnType<typeof getMatches | typeof getEntropy>
  >["rows"][number],
  currentLosses: number,
) {
  if (player["Matches played"] >= 30 || player.Losses >= 11) {
    console.log("Player finished", player.Identification);
    return;
  }
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const member = await guild.members.fetch(player["Discord ID"]);
  const includeEoe = player["EOE Packs Opened"] * 2 < currentLosses;
  await member.send(
    buildPackMessage(
      player,
      mapState,
      includeEoe,
      new Date(),
      match.Timestamp,
      match.WEEK,
      currentLosses,
    ),
  );
}

export async function readMapState(
  sheetId = CONFIG.LIVE_SHEET_ID,
): Promise<MapState> {
  const table = await readTable("Exploration Log!A:F", 1, sheetId);
  const paramSchema = z.union([z.string(), z.number()]).optional();
  const parsed = parseTable({
    Timestamp: z.iso.datetime(),
    Command: z.enum([
      "config",
      "add_ship",
      "move_ship",
      "add_planet",
      "reveal",
      "exhaust_planet",
      "advance_week",
    ]),
    Param1: paramSchema,
    Param2: paramSchema,
    Param3: paramSchema,
    Param4: paramSchema,
  }, table);
  const rows = parsed.rows;
  return await buildMapState(rows);
}

const shipImages = new Map<string, Image>();

export async function buildMapState(
  rows: {
    Timestamp: string;
    Command:
      | "config"
      | "add_ship"
      | "move_ship"
      | "add_planet"
      | "exhaust_planet"
      | "advance_week"
      | "reveal";
    Param1?: string | number;
    Param2?: string | number;
    Param3?: string | number;
    Param4?: string | number;
  }[],
  quotas?: Awaited<ReturnType<typeof getQuotas>>,
): Promise<MapState> {
  quotas ??= await getQuotas();
  const offset = utcOffsetMs("America/New_York"); // TODO don't hardcode at some point; look up tz from CONFIG.LIVE_SHEET_ID
  let radius = 5;
  const planets = new Map<
    string,
    { q: number; r: number; discoveredWeek: number; exhaustedWeek?: number }
  >();
  const ships = new Map<string, { q: number; r: number }>();
  const movesMade = new Map<string, number>();
  const visible = new Set<string>();
  for (const row of rows) {
    switch (row.Command) {
      case "config": {
        if (row.Param1 === "mapsize") radius = row.Param2 as number;
        break;
      }
      case "add_ship":
      case "move_ship": {
        ships.set(row.Param1 as string, {
          q: row.Param2 as number,
          r: row.Param3 as number,
        });
        if (
          !shipImages.has(row.Param1 as string) &&
          SHIP_URLS[row.Param1 as string]
        ) {
          const url = SHIP_URLS[row.Param1 as string];
          try {
            shipImages.set(
              row.Param1 as string,
              await loadImage(url),
            );
          } catch (e) {
            console.error("bad image", url, e);
          }
        }
        visible.add(`${row.Param2},${row.Param3}`);
        if (row.Command === "move_ship") {
          movesMade.set(
            row.Param4 as string,
            1 + (movesMade.get(row.Param4 as string) ?? 0),
          );
        }
        break;
      }
      case "add_planet": {
        const discoveredAt = new Date(row.Timestamp);
        const { week: discoveredWeek } = quotas?.findLast((q) => {
          const weekStart = readSheetsDate(q.fromDate, offset);
          return weekStart <= discoveredAt;
        }) ?? { week: 0 };
        planets.set(row.Param1 as string, {
          q: row.Param2 as number,
          r: row.Param3 as number,
          discoveredWeek,
        });
        visible.add(`${row.Param2},${row.Param3}`);
        break;
      }
      case "reveal": {
        const cq = +(row.Param1 as number);
        const cr = +(row.Param2 as number);
        const rad = +(row.Param3 as number);
        for (
          let q = Math.max(-radius, cq - rad);
          q <= Math.min(radius, cq + rad);
          q++
        ) {
          for (
            let r = Math.min(-radius, cr - rad);
            r <= Math.max(radius, cr + rad);
            r++
          ) {
            if (Math.abs(q + r) > radius) continue;
            const EPSILON = 0.0001; // probably not needed given the ranges used but doesn't hurt
            if (hexDistance({ q: cq, r: cr }, { q, r }) <= rad + EPSILON) {
              visible.add(`${q},${r}`);
            }
          }
        }
        break;
      }
      case "exhaust_planet": {
        // set planet destroyedWeek to the current week
        const planet = planets.get(row.Param1 as string);
        if (planet) {
          planet.exhaustedWeek = quotas?.findLast((q) => {
            const weekStart = readSheetsDate(q.fromDate, offset);
            return weekStart <= new Date(row.Timestamp);
          })?.week;
        }
        break;
      }
      case "advance_week": {
        // for display only; changes exhausted planets to destroyed on the live map, does nothing in this program
        break;
      }
    }
  }
  return { radius, ships, planets, visible, movesMade };
}

async function askToMove(
  client: Client,
  player: EOEPlayer,
  mapState: MapState,
) {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const member = await guild.members.fetch(player["Discord ID"]);
  const message = buildMoveMessage(
    mapState,
    player.Ship,
    calcFuel(player, mapState),
  );
  await member.send(message);
}

type MapState = {
  readonly radius: number;
  readonly ships: Readonly<Map<string, Readonly<{ q: number; r: number }>>>;
  readonly planets: Readonly<
    Map<
      string,
      Readonly<
        {
          q: number;
          r: number;
          discoveredWeek: number;
          exhaustedWeek?: number;
        }
      >
    >
  >;
  readonly visible: Readonly<Set<string>>;
  readonly movesMade: Readonly<Map<string, number>>;
};

export function draw(mapState: MapState, playerShip: string) {
  // TODO determine good image size
  const WIDTH = 500;
  const HEIGHT = 500;
  const MIN_DIM = Math.min(WIDTH, HEIGHT);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  let centerQ = 0;
  let centerR = 0;
  let radius = mapState.radius;
  if (mapState.ships.has(playerShip)) {
    ({ r: centerR, q: centerQ } = mapState.ships.get(playerShip)!);
    // TODO tweak
    radius = 4;
  } else {
    // if there ship isn't placed, look around the entire visible area
    const qs = [...mapState.visible].map((x) => +x.split(",")[0]);
    const rs = [...mapState.visible].map((x) => +x.split(",")[1]);
    const minQ = Math.min(...qs);
    const maxQ = Math.max(...qs);
    centerQ = (minQ + maxQ) / 2;
    const minR = Math.min(...rs);
    const maxR = Math.min(...rs);
    centerR = (minR + maxR) / 2;
    radius = Math.max(maxQ - centerQ, maxR - centerR) + 5;
  }
  /* scaling: need to make sure that we fit [radius * 2 + 1] hexes */
  // TODO something's not quite right with this or something else
  const HEX_SIZE = MIN_DIM / (radius * 2 + 1) / Math.sqrt(3);
  for (let q = -mapState.radius; q <= mapState.radius; q++) {
    for (let r = -mapState.radius; r <= mapState.radius; r++) {
      /* TODO figure out min r in terms of q to avoid the continue */
      if (Math.abs(q + r) > mapState.radius) continue;
      const { x, y } = hexToXy(q - centerQ, r - centerR);
      // TODO vary fill with visibility
      drawHex(
        ctx,
        x * HEX_SIZE + WIDTH / 2,
        y * HEX_SIZE + HEIGHT / 2,
        HEX_SIZE,
        "#ccc",
        r === centerR && q === centerQ
          ? "#373"
          : mapState.visible.has(`${q},${r}`)
          ? "#000"
          : "#666",
      );
      // TODO draw contents
    }
  }
  for (const [planet, { q, r }] of mapState.planets) {
    // 1. draw a circle, 2. put text on it (TODO make it look good)
    ctx.beginPath();
    ctx.fillStyle = "#ddd"; // TODO planet color
    const { x, y } = hexToXy(q - centerQ, r - centerR);
    const PLANET_RADIUS = HEX_SIZE * 0.75;
    ctx.arc(
      x * HEX_SIZE + WIDTH / 2,
      y * HEX_SIZE + HEIGHT / 2,
      PLANET_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.beginPath();
    // textAlign and textBaseline not supported -- TODO use measureText (only supports width) and figure out best place to put it to center on planet
    ctx.font = "bold " + Math.floor(HEX_SIZE / 2) + "px sans-serif";
    ctx.fillStyle = "#000"; // TODO planet text
    ctx.strokeStyle = "#000"; // TODO planet text
    ctx.fillText(planet, x * HEX_SIZE + WIDTH / 2, y * HEX_SIZE * HEIGHT / 2);
    ctx.strokeText(planet, x * HEX_SIZE + WIDTH / 2, y * HEX_SIZE * HEIGHT / 2);
  }
  // place the ship last so it's never covered up
  for (
    const [ship, { q, r }] of [...mapState.ships].sort(([a], [b]): number =>
      +(a === playerShip) - +(b === playerShip)
    )
  ) {
    const image = shipImages.get(ship);
    if (!image) continue; // TODO do fallback?
    const { x, y } = hexToXy(q - centerQ, r - centerR);
    const IMAGE_WIDTH = HEX_SIZE * 0.8;
    const IMAGE_HEIGHT = IMAGE_WIDTH * image.height() / image.width();
    ctx.drawImage(
      image,
      x * HEX_SIZE + WIDTH / 2 - IMAGE_WIDTH / 2,
      y * HEX_SIZE + HEIGHT / 2 - IMAGE_HEIGHT / 2,
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
    );
  }
  return canvas.toBuffer("image/png");
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  borderColor: string,
  fillColor: string,
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i;
    ctx.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle));
  }
  ctx.closePath();
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function hexToXy(q: number, r: number) {
  const x = 3 / 2 * q;
  const y = Math.sqrt(3) / 2 * q + Math.sqrt(3) * r;
  return { x, y };
}

// TODO mention fuel in the embed or something
export function buildMoveMessage(
  mapState: MapState,
  ship: string,
  fuel: number,
  coord?: string,
): MessageCreateOptions & InteractionUpdateOptions {
  const embeds = [
    new EmbedBuilder()
      .setImage("attachment://map.png")
      .setFields([{ name: "Fuel", value: "**" + fuel + "**" }]),
  ];
  const mapToDraw = mapState.ships.has(ship) ? mapState : {
    ...mapState,
    ships: new Map([...mapState.ships.entries(), [
      ship,
      parseCoord(coord ?? "0,0"),
    ]]),
  };
  const files = [
    makeMapFile(mapToDraw, ship),
  ];
  const shipState = mapState.ships.get(ship);
  if (!shipState) {
    const curLocation = coord ?? "0,0";
    let hasBadMove = false;
    const moveOptions = [[{
      label: "↖️",
      value: "-1,0",
    }, {
      label: "⬆️",
      value: "0,-1",
    }, {
      label: "↗️",
      value: "1,-1",
    }], [{
      label: "↙️",
      value: "-1,1",
    }, {
      label: "⬇️",
      value: "0,1",
    }, {
      label: "↘️",
      value: "1,0",
    }], [{
      label: "↖️↖️",
      value: maxMovable(mapState, curLocation, "-1,0"),
    }, {
      label: "⬆️⬆️",
      value: maxMovable(mapState, curLocation, "0,-1"),
    }, {
      label: "↗️↗️",
      value: maxMovable(mapState, curLocation, "1,-1"),
    }], [{
      label: "↙️↙️",
      value: maxMovable(mapState, curLocation, "-1,1"),
    }, {
      label: "⬇️⬇️",
      value: maxMovable(mapState, curLocation, "0,1"),
    }, {
      label: "↘️↘️",
      value: maxMovable(mapState, curLocation, "1,0"),
    }]];
    const known = new Set<string>();
    const fresh = (str: string) => {
      if (!known.has(str)) {
        known.add(str);
        return str;
      }
      return fresh(str + "_");
    };
    return {
      content:
        `Since you're the first person on ${ship} to win a match, you get to pick its starting position on the map. (You'll be able to move it after placing. Click Place Ship when you have your ship where you want it.) [You can see the full map here](https://trout.rocks/agl/eoe/).`,
      components: [
        ...moveOptions.map((row) =>
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            row.map((r) => {
              const isBadMove = r.value === "0,0" || !mapState.visible.has(
                addCoords(curLocation, r.value),
              );
              hasBadMove ||= isBadMove;
              const customId = fresh(
                "EOE_place_" + addCoords(curLocation, r.value),
              );
              console.log(ship, customId);
              return new ButtonBuilder({
                label: r.label,
                customId: customId,
                style: ButtonStyle.Secondary,
                disabled: isBadMove,
              });
            }),
          )
        ),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder({
            customId: "EOE_place_submit_" + curLocation,
            label: "Place Ship",
            style: ButtonStyle.Primary,
            disabled: !hasBadMove,
          }),
        ),
      ],
      embeds,
      files,
    };
  } else {
    const moveOptions = [[{
      label: "↖️",
      value: "-1,0",
    }, {
      label: "⬆️",
      value: "0,-1",
    }, {
      label: "↗️",
      value: "1,-1",
    }], [{
      label: "↙️",
      value: "-1,1",
    }, {
      label: "⬇️",
      value: "0,1",
    }, {
      label: "↘️",
      value: "1,0",
    }]];
    return {
      content:
        `The solar cells have recharged and you can move ${ship}! [You can see the full map here](https://trout.rocks/agl/eoe/).`,
      embeds,
      files,
      components: moveOptions.map((row) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          row.map((r) => {
            const curCoord = `${shipState.q},${shipState.r}`;
            const newCoord = addCoords(
              curCoord,
              r.value,
            );
            console.log(newCoord, curCoord);
            const parsed = parseCoord(newCoord); // lol all this format-shifting
            const disabled = Math.max(
              Math.abs(parsed.r),
              Math.abs(parsed.q),
              Math.abs(parsed.q + parsed.r),
            ) > mapState.radius;
            const customId = "EOE_move_" + newCoord + "_" + curCoord;
            console.log(ship, customId);
            return new ButtonBuilder({
              label: r.label,
              customId: customId,
              style: mapState.visible.has(newCoord)
                ? ButtonStyle.Secondary
                : ButtonStyle.Primary,
              disabled,
            });
          }),
        )
      ),
    };
  }
}

function makeMapFile(mapToDraw: MapState, ship: string) {
  return new AttachmentBuilder(Buffer.from(draw(mapToDraw, ship)), {
    name: "map.png",
    description: "Map",
  });
}

export function readPackMessageState(customId: string) {
  const regex = /^EOE_pack_([^_]+)_([^_]+)_([^_]+)_([^_]+)?$/;
  const match = customId.match(regex);
  if (!match) return undefined;
  const [, type, includeEoe, timeFirstSent, matchRowStamp] = match;
  return {
    type,
    includeEoe: !!(+includeEoe),
    timeFirstSent: new Date(timeFirstSent),
    matchRowStamp: +matchRowStamp,
  };
}

function buildPackMessage(
  player: EOEPlayer,
  mapState: MapState,
  includeEoe: boolean,
  timeFirstSent: Date,
  matchRowStamp: number,
  matchWeek: number,
  lossNumber: number,
  selectedCode?: string,
): MessageCreateOptions & InteractionUpdateOptions {
  const state =
    `${+includeEoe}_${timeFirstSent.toISOString()}_${matchRowStamp}`;
  const sets = [...mapState.planets.entries()]
    .filter((x) =>
      x[0] !== "EOE" && x[1].discoveredWeek < matchWeek &&
      (!x[1].exhaustedWeek || x[1].exhaustedWeek >= matchWeek)
    )
    .map((x) => x[0]);
  const availableSetCodes = [
    ...includeEoe && player["EOE Packs Opened"] * 2 < player.Losses
      ? ["EOE"]
      : [],
    ...sets,
  ];
  console.log("sending", player.Identification, "sets", availableSetCodes);
  return {
    content: "Pick a Set (loss " + lossNumber + ")",
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(
            "EOE_pack_select_" + state,
          )
          .addOptions(
            ...availableSetCodes.map((code) => ({
              label: code,
              value: code,
              default: selectedCode === code,
            })),
          ),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder({
          customId: "EOE_pack_submit_" + state,
          label: "Open Pack",
          disabled: !selectedCode || !availableSetCodes.includes(selectedCode),
          style: ButtonStyle.Primary,
        }),
      ),
    ],
  };
}

// yes I know we're bouncing between strings and parsed coordinate objects a lot...
function addCoords(a: string, b: string): string {
  const [q1, r1] = a.split(",").map((x) => +x);
  const [q2, r2] = b.split(",").map((x) => +x);
  return [q1 + q2, r1 + r2].join(",");
}

export const SETS = [
  "BLB",
  "OTJ",
  "MKM",
  "LCI",
  "WOE",
  "MOM",
  "ONE",
  "BRO",
  "DMU",
  "SNC",
  "NEO",
  "VOW",
  "MID",
  "AFR",
  "STX",
  "SNC",
  "KHM",
  "ZNR",
  "IKO",
  "THB",
  "ELD",
  "WAR",
  "RNA",
  "GRN",
  "DOM",
  "RIX",
  "XLN",
  "AKR",
  "KLR",
  "SIR",
  "PIO",
  "KTK",
  "LTR",
  "M21",
  "M20",
  "M19",
];

// TODO this is a bit hacky
await initSheets();
const table = await readTable(
  "Names!B:C",
  1,
  "1-cgXMvzeCUPXMsuVC2vDQbbTZV8phesud6cqkbsX5Fk",
);
const shipNames = parseTable(
  { "Ship name": z.string().optional(), "Ship image": z.string().optional() },
  table,
);
const SHIP_URLS = Object.fromEntries(
  shipNames.rows.filter((x) => x["Ship name"] && x["Ship image"]).map(
    (x) => [x["Ship name"], x["Ship image"]],
  ),
);

function parseCoord(coord: string) {
  const [q, r] = coord.split(",");
  return { q: +q, r: +r };
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) +
    Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
}

async function addExpLog(values: (string | number)[][]) {
  await sheetsAppend(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    "Exploration Log!A:F",
    values.map((row) => [new Date().toISOString(), ...row]),
  );
}

// TODO this is awful
function maxMovable(mapState: MapState, coord: string, diff: string) {
  let off = "0,0";
  let next = coord;
  let nextOff = off;
  do {
    coord = next;
    off = nextOff;
    next = addCoords(coord, diff);
    nextOff = addCoords(off, diff);
  } while (mapState.visible.has(next));
  return off;
}

function discover(
  mapState: MapState,
  { q, r }: { q: number; r: number },
) {
  if (mapState.visible.has(`${q},${r}`)) return;
  const undiscovered = SETS.filter((s) => !mapState.planets.has(s));
  const spacesLeft = 1 + 3 * mapState.radius +
    3 * mapState.radius * mapState.radius - mapState.visible.size;
  const roll = Math.random() * spacesLeft | 0;
  return undiscovered[roll]; // if roll >= undiscovered.length this is undefined i.e. no discovery
}

function calcFuel(
  player: EOEPlayer,
  mapState: MapState,
) {
  const fuel = player.Wins * 3 -
    (mapState.movesMade.get(player.Identification) ?? 0);
  console.log(player.Identification, "has", fuel, "fuel");
  return fuel;
}

export async function fixPool(
  pool: SealedDeckPool,
) {
  const substitutions: Partial<Record<string, string>> = {
    "Eerie Ultimatum": "Warping Wail",
    "Emergent Ultimatum": "Deafening Silence",
    "Genesis Ultimatum": "Robe of Stars",
    "Inspired Ultimatum": "Nexus of Fate",
    "Ruinous Ultimatum": "Paradox Haze",
    "Arid Mesa": "Darkness",
    "Marsh Flats": "Magus of the Moon",
    "Misty Rainforest": "Burgeoning",
    "Scalding Tarn": "Green Sun's Zenith",
    "Verdant Catacombs": "Sliver Overlord",
  };

  let wasFixed = false;
  const subs: { out: string; in: string }[] = [];
  const newSideboard = pool.sideboard.map((card) => {
    const sub = substitutions[card.name];
    if (sub) {
      wasFixed = true;
      subs.push({ out: card.name, in: sub });
      return { ...card, name: sub, set: "SPG" };
    }
    return card;
  });

  if (wasFixed) {
    const newPoolId = await makeSealedDeck({
      ...pool,
      sideboard: newSideboard,
    });
    pool = await fetchSealedDeck(newPoolId);
  }

  return {
    pool,
    wasFixed,
    subs,
  };
}

const messages = parseTable({
  Set: z.string(),
  Writer: z.string(),
  Blurb: z.string(),
}, await readTable("Blurbs!B4:D", 4, CONFIG.EOE.MESSAGE_SHEET_ID));
