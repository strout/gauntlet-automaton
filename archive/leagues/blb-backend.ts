import * as djs from "discord.js";
import { BLBBackend, fastForward, initState, tryRun } from "./blb-replay.ts";
import { Sheets } from "sheets";
import { delay } from "@std/async";
import { Animal, blbConfig, EXPLORER_SETS, onLoss } from "./blb.ts";
import { readStringPool } from "./fix-pool.ts";
import { sheetsRead, sheetsWrite } from "./sheets.ts";
import { mutex } from "./mutex.ts";
import { searchCards } from "./scryfall.ts";

// TODO refresh occasionally?
export const BOT_BUNKER_CHANNEL_ID: djs.Snowflake = blbConfig.get(
  "BOT_BUNKER_CHANNEL_ID",
)!;
export const BLB_SHEET_ID = blbConfig.get("SHEET_ID")!;
export const TEST_USER_ID = "___";
const AGL_GUILD_ID = blbConfig.get("AGL_GUILD_ID")!;
const PACKGEN_CHANNEL_ID = blbConfig.get("PACK_GENERATION_CHANNEL_ID")!;
const OWNER_ID: djs.Snowflake = "218773207337926656";

const MAX_RETRY_DELAY = 128;

const lock = mutex();

const blbCommons = await searchCards("s:BLB r:c")
  .then((r) => r.map((x) => x.name));

const ANIMAL_ROLES = {
  "BAT": "___",
  "BIRD": "___",
  "FROG": "___",
  "LIZARD": "___",
  "MOUSE": "___",
  "OTTER": "___",
  "RABBIT": "___",
  "RACCOON": "___",
  "RAT": "___",
  "SQUIRREL": "___",
};

export const LC_ROLE_ID = "___";

type BE = {
  sheets: Sheets;
  discord: djs.Client;
};

export async function onMatchEntry(
  be: BE,
  playerId: string,
  standings: Awaited<ReturnType<typeof getStandings>>,
) {
  using _ = await lock();
  try {
    console.info("Found match for " + playerId);
    const guild = await be.discord.guilds.fetch(AGL_GUILD_ID);
    const member = await guild.members.fetch(playerId);
    await catchUp(be, member, standings);
  } catch (e) {
    console.error(e);
    const ownerDm = await be.discord.users.fetch(OWNER_ID);
    await ownerDm?.send("Something went wrong: " + e);
  }
}

export async function forceExplore(be: BE, message: djs.Message) {
  using _ = await lock();
  const standingsData = await getStandings(be.sheets);
  const { playerLogs } = await fetchLogs(
    be.sheets,
    Object.keys(standingsData).length,
  );
  const [, playerId, oldPackId] = message.content.split(" ");
  console.warn("forcing reroll", playerId, oldPackId);
  await doReroll(message, be, playerLogs[playerId], oldPackId);
  const ownerDm = await be.discord.users.fetch(OWNER_ID);
  await ownerDm?.send(
    message.author.tag + "forced a reroll: " + message.content,
  );
}

export async function onMessage(be: BE, message: djs.Message) {
  using _ = await lock();
  try {
    if (message.inGuild()) {
      // could be reroll or std id
      if (
        (message.channelId === BOT_BUNKER_CHANNEL_ID ||
          message.channelId === PACKGEN_CHANNEL_ID) &&
        message.reference
      ) {
        const standingsData = await getStandings(be.sheets);
        const { trashLogs, playerLogs } = await fetchLogs(
          be.sheets,
          Object.keys(standingsData).length,
        );
        // This is getting messy so let's think it through.
        // first check if it's a reroll request.
        // if not, do all this crap
        if (message.content.startsWith("!explore")) {
          try {
            await handleRerollRequest(be.sheets, message, playerLogs, be);
          } catch (e) {
            console.error(e);
            const ownerDm = await be.discord.channels.fetch(
              OWNER_ID,
            ) as djs.DMChannel;
            await ownerDm?.send("Something went wrong: " + e);
            await message.reply("Something went wrong, I'll call for help.");
          }
          return;
        }
        await handleNewPack(message, playerLogs, be, trashLogs, standingsData);
        return;
      } else {
        console.info("Ignoring message " + message.id);
      }
    } else {
      await (message.channel as djs.DMChannel).sendTyping?.();
      let match;
      // deno-lint-ignore no-cond-assign
      const event = (match = message.content.match(/\!choose (.+)$/))
        ? { type: "choice" as const, key: match[1] }
        : undefined;
      // DM; find guild member
      const guild = await be.discord.guilds.fetch(AGL_GUILD_ID);
      const member = await guild.members.fetch(message.author.id);
      const standingsData = await getStandings(be.sheets);
      await catchUp(be, member, standingsData, event);
    }
  } catch (e) {
    console.error(e);
    const ownerDm = await be.discord.channels.fetch(OWNER_ID) as djs.DMChannel;
    await ownerDm?.send("Something went wrong: " + e);
  }
}

async function handleNewPack(
  message: djs.Message<true>,
  playerLogs: {
    [k: string]: {
      readonly name: string;
      readonly rerolls: string[];
      readonly playerLogs: string[];
      readonly columnIndex: number;
    };
  },
  be: BE,
  trashLogs: string[],
  standingsData: {
    [k: string]: { name: string; wins: number; losses: number };
  },
) {
  console.info("handling pack creation");
  const sdtId = await extractSdtId(message);
  if (!sdtId) {
    console.info("No sdt id in message " + message.id);
    return;
  }

  console.info("Found sdt id " + sdtId);

  if (message.reactions.resolve("🆗")?.me) {
    console.info("Already processed message " + message.id);
    return;
  }

  const referenceId = message.reference?.messageId;
  if (referenceId && message.channelId === BOT_BUNKER_CHANNEL_ID) {
    const logToFind = "requestPack " + referenceId;
    const log = Object.entries(playerLogs)
      .find(([_, { playerLogs, rerolls }]) =>
        rerolls.some((e) => e.endsWith(" " + referenceId)) ||
        playerLogs.some((l) => l === logToFind)
      );
    if (log) {
      const rerollIndex = log[1].rerolls.findIndex((r) =>
        r.endsWith(" " + referenceId)
      );
      if (rerollIndex >= 0) {
        const [_x, old, _y] = log[1].rerolls[rerollIndex].split(" ");
        const newEntry = `swap ${old} ${sdtId} ${Date.now()}`;
        log[1].rerolls[rerollIndex] = newEntry;
        await sheetsWrite(
          be.sheets,
          BLB_SHEET_ID,
          `${blbConfig.get("LOG_SHEET_NAME")}!R${3 + rerollIndex}C${
            log[1].columnIndex + 1
          }`,
          [[newEntry]],
        );
        await sheetsWrite(
          be.sheets,
          BLB_SHEET_ID,
          `${blbConfig.get("LOG_SHEET_NAME")}!R${trashLogs.length + 2}C1`,
          [["add " + old]],
        );
        await writePool(
          await getPoolRow(be.sheets, log[0]),
          replaceRerolls(getPoolPacks(log[1].playerLogs), log[1].rerolls),
          getPoolSingles(log[1].playerLogs),
          be.sheets,
        );
        const channel = await message.guild.channels.fetch(
          PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        if (!channel) throw new Error("NO PACKGEN CHANNEL?!?");
        // TODO better message?
        // TODO attach image
        const content = await fetchSealedDeck(sdtId);
        await channel.send(
          `<@!${
            log[0]
          }> got a pack: https://sealeddeck.tech/${sdtId} (rerolled from https://sealeddeck.tech/${old})\n\n` +
            formatCardList([
              ...content.sideboard,
              ...content.hidden,
              ...content.deck,
            ]),
        );
        const member = await message.guild.members.fetch(log[0]);
        await catchUp(be, member, standingsData, {
          type: "pack",
          for: referenceId,
          packId: sdtId,
        });
      } else {
        const member = await message.guild.members.fetch(log[0]);
        await catchUp(be, member, standingsData, {
          type: "pack",
          for: referenceId,
          packId: sdtId,
        });
      }
      await message.react("🆗");
      return;
    }
  }
  console.info(
    "Ignoring message " + message.id + " from " +
      message.author.displayName,
  );
}

async function handleRerollRequest(
  sheets: Sheets,
  message: djs.Message<true>,
  playerLogs: {
    [k: string]: {
      readonly name: string;
      readonly rerolls: string[];
      readonly playerLogs: string[];
      readonly columnIndex: number;
    };
  },
  be: BE,
) {
  const ref = await message.fetchReference();
  const sdtId = await extractSdtId(ref);
  if (!sdtId) {
    console.info("No sdt id in message " + ref.id);
    return;
  }

  const plog = playerLogs[message.author.id];
  const shouldReroll = await checkReroll(sheets, plog, message, sdtId);
  if (!shouldReroll) return;
  await message.react("🆗");
  await doReroll(message, be, plog, sdtId);
}

async function doReroll(
  message: djs.Message,
  be: BE,
  plog: {
    readonly name: string;
    readonly rerolls: string[];
    readonly playerLogs: string[];
    readonly columnIndex: number;
  },
  sdtId: string,
) {
  const guild = await be.discord.guilds.fetch(AGL_GUILD_ID);
  const channel = await guild.channels.fetch(
    BOT_BUNKER_CHANNEL_ID,
  ) as djs.TextChannel;
  if (!channel) throw new Error("NO BOT BUNKER CHANNEL?!?");
  let packReq;
  if (blbConfig.get("BLB_PACKGEN_BROKEN")) {
    packReq = EXPLORER_SETS[Math.random() * EXPLORER_SETS.length | 0];
    packReq = packReq === "MKM"
      ? "a-mkm"
      : packReq === "BLB"
      ? "cube BLBBT"
      : packReq;
  } else {
    packReq = "explorer";
  }
  const req = await channel.send(`!${packReq} reroll: ${message.url}`);
  await sheetsWrite(
    be.sheets,
    BLB_SHEET_ID,
    `${blbConfig.get("LOG_SHEET_NAME")}!R${plog.rerolls.length + 3}C${
      plog.columnIndex + 1
    }`,
    [[`req ${sdtId} ${req.id}`]],
  );
}

async function checkReroll(
  sheets: Sheets,
  plog: {
    readonly name: string;
    readonly rerolls: string[];
    readonly playerLogs: string[];
    readonly columnIndex: number;
  },
  message: djs.Message<true>,
  sdtId: string,
) {
  if (message.reactions.resolve("🆗")?.me) {
    console.info("Already processed message " + message.id);
    return false;
  }
  const allowed = rerollsLeft(plog) > 0;
  if (!allowed) {
    await message.reply("Sorry, you don't have any rerolls available");
    return false;
  }
  // TODO check if _this pack_ is reroll eligible!
  // Can do that by checking:
  // 2. do they have as many boons as losses?
  // 3. was it generated during their last boon?
  // 4. is it still in their pool? [x]
  // if so we're fine, otherwise bail
  const matchLogs = await sheetsRead(
    sheets,
    BLB_SHEET_ID,
    "Matches!A9:C",
    "UNFORMATTED_VALUE",
  );
  const entropyLogs = await sheetsRead(
    sheets,
    BLB_SHEET_ID,
    "Entropy!D5:I",
    "UNFORMATTED_VALUE",
  );
  const lastWinTimestamp = matchLogs.values?.findLast((x) => x[1] === plog.name)
    ?.[0];
  const lastMatchLossTimestamp = matchLogs.values?.findLast((x) =>
    x[2] === plog.name
  )?.[0];
  const lastEntropyTimestamp = entropyLogs.values?.findLast((x) =>
    x[0] === plog.name
  )?.[5];
  const lastLossTimestamp = Math.max(
    ...[lastMatchLossTimestamp, lastEntropyTimestamp].filter((x) => x),
  );
  if (lastWinTimestamp > lastLossTimestamp) {
    console.warn(
      "checo",
      lastWinTimestamp,
      readSheetsDate(lastWinTimestamp),
      lastLossTimestamp,
      readSheetsDate(lastLossTimestamp),
    );
    await message.reply("Sorry, you've played a match since your last loss.");
    return false;
  }
  const boonCount = plog.playerLogs.filter((x) => x.startsWith("done ")).length;
  const lossCount =
    (matchLogs.values?.filter((x) => x[2] === plog.name).length ?? 0) +
    (entropyLogs.values?.filter((x) => x[0] === plog.name)?.length ?? 0);
  if (lossCount !== boonCount) {
    await message.reply(
      "Sorry, can only reroll packs from your latest loss. *(Check your DMs in case there's a pending choice to make.)*",
    );
    return false;
  }
  const curPacks = replaceRerolls(getPoolPacks(plog.playerLogs), plog.rerolls);
  if (!curPacks.includes(sdtId)) {
    await message.reply("Sorry, that pack isn't in your pool.");
    return false;
  }

  const boonIndices = plog.playerLogs.flatMap((x, i) => {
    if (x.startsWith("done ")) return [i];
    else return [];
  });

  // convert from google sheets EDT timestamp to JS timestamp
  const convertedTimestamp = readSheetsDate(lastLossTimestamp).getTime();

  // 1. packs between second-to-last and last boons
  // 2. packs from rerolls since last loss
  const eligiblePacks = plog.rerolls.flatMap((x) => {
    const [type, _oldPack, newPack, timestamp] = x.split(" ");
    if (type === "swap" && +timestamp > convertedTimestamp) {
      return [newPack];
    } else {
      return [];
    }
  }).concat(
    plog.playerLogs.slice(
      boonIndices[boonIndices.length - 2] ?? 0,
      boonIndices[boonIndices.length - 1],
    ).flatMap((x) => {
      const [type, ...packs] = x.split(" ");
      if (type === "pack") return packs;
      else return [];
    }),
  );

  if (!eligiblePacks.includes(sdtId)) {
    await message.reply(
      "Sorry, that pack isn't eligible to reroll. *Only packs from your latest loss or their rerolls can be rerolled.*",
    );
    return false;
  }

  return true;
}

export function readSheetsDate(date: number) {
  return new Date(
    date * 1000 * 24 * 60 * 60 + Date.UTC(1899, 11, 30) +
      4 * 1000 * 60 * 60, // TODO how to detect time zone?
  );
}

function rerollsLeft(
  plog: {
    readonly name: string;
    readonly rerolls: string[];
    readonly playerLogs: string[];
    readonly columnIndex: number;
  },
) {
  const rerollsUsed = plog.rerolls.length;
  const boonsUsed = plog.playerLogs.flatMap((x) => {
    const [boon, animal] = x.split(" ");
    if (boon === "done") {
      return [animal as Animal];
    } else {
      return [];
    }
  });
  const batIndex = boonsUsed.indexOf("Bat");
  const rerollsAllowed = batIndex >= 0 && boonsUsed[batIndex - 1] !== "Frog"
    ? 2
    : 0;
  return rerollsAllowed - rerollsUsed;
}

async function catchUp(
  be: BE,
  member: djs.GuildMember,
  standings: Awaited<ReturnType<typeof getStandings>>,
  event?:
    | { type: "choice"; key: string }
    | { type: "pack"; for: string; packId: string },
) {
  try {
    if (
      blbConfig.get("LC_ONLY") === "yes" && !isLeagueCommittee(member)
    ) {
      console.info(`NOT catching up for ${member.displayName}`);
      return;
    }
    console.info("Catching up for " + member.displayName);
    const dbe = await discordBackendFor(
      be.sheets,
      member,
      Object.keys(standings).length,
    );
    const state = fastForward(await initState(dbe));
    const numDones = state.pastPlayerLogs.filter((x) =>
      x.startsWith("done ")
    ).length;
    const numLosses = standings[member.id].losses;
    const numWins = standings[member.id].wins;
    if (numLosses > numDones) {
      console.info(
        (numLosses - numDones) + " losses to catch up with for " +
          member.displayName,
      );
      await tryRun(dbe, state, (blb) => {
        for (let i = numDones; i < numLosses; i++) {
          onLoss(blb, +numWins, +numLosses);
        }
      }, event);
    }
  } catch (e) {
    console.error(e);
    const ownerDm = await be.discord.users.fetch(OWNER_ID);
    await ownerDm?.send("Something went wrong: " + e);
    await member.send("Something went wrong, I'll call for help.");
  }
}

export async function getStandings(sheets: Sheets) {
  const data = await sheetsRead(
    sheets,
    BLB_SHEET_ID,
    `${blbConfig.get("STANDINGS_SHEET_NAME")}!D6:T`,
  );
  return Object.fromEntries<{ name: string; wins: number; losses: number }>(
    data.values?.map((
      [
        name,
        _status,
        _rank,
        wins,
        losses,
        _record,
        _winPct,
        _winPctNoE,
        _played,
        _underMin,
        _underMax,
        _omw,
        _toPlay,
        _tourneyStatus,
        _rankWins,
        _rankWinPct,
        discordId,
      ],
    ) => [discordId, { name, wins, losses }] as const).filter((x) =>
      /^\d+$/.test(x[0])
    ) ??
      [],
  );
}

export async function discordBackendFor(
  sheets: Sheets,
  player: djs.GuildMember,
  playerCount: number,
): Promise<BLBBackend> {
  const TRASH_COL_NUM = 1;
  const botChannel = await player.guild.channels
    .fetch(BOT_BUNKER_CHANNEL_ID) as djs.TextChannel;
  const playerId = player.id;
  const animalRoleName = Object.entries(ANIMAL_ROLES).find(([_, role]) =>
    player.roles.cache.has(role)
  )?.[0];
  const animal = animalRoleName
    ? animalRoleName[0] + animalRoleName.slice(1).toLowerCase() as Animal
    : "Mouse";
  const seed = xmur3(playerId);
  if (blbConfig.get("LC_ONLY") === "yes") {
    // reseed if testing to avoid cheating
    seed();
  }
  let trashLogs: string[];
  let playerColIdx: number;
  let playerLogs: string[];
  let rerolls: string[];
  // TODO ugh
  let playerPoolRow: PoolRow;
  return {
    isBlbCommon(card) {
      return blbCommons.includes(card);
    },
    playerId,
    animal,
    playerRandomSeed: seed(),
    async start() {
      playerPoolRow = await getPoolRow(sheets, playerId);
      let allPlayerLogs;
      ({ playerLogs: allPlayerLogs, trashLogs } = await fetchLogs(
        sheets,
        playerCount,
      ));
      ({ playerLogs, columnIndex: playerColIdx, rerolls } =
        allPlayerLogs[playerId]);
      return { playerLogs, trashLogs };
    },
    async readPack(id) {
      const resp = await fetchSealedDeck(id);
      return resp.sideboard.map((x: { name: string }) => x.name);
    },
    async requestPack(message) {
      if (blbConfig.get("BLB_PACKGEN_BROKEN") === "yes") {
        message = message.replace("!BLB", "!cube BLBBT");
      }
      message = message.replace("!MKM", "!a-mkm"); // avoid MKM packs with not-on-arena cards
      const msg = await botChannel.send(message);
      return msg.id;
    },
    async finish(
      newTrashLogs,
      newPlayerLogs,
      poolPacks,
      poolSingles,
      messages,
      currentBoon,
    ) {
      for (const message of messages) {
        await player.send(message);
      }
      if (newPlayerLogs.length) {
        const playerLogRange = `${blbConfig.get("LOG_SHEET_NAME")}!R${
          playerLogs.length + 5
        }C${playerColIdx + 1}:R${
          playerLogs.length + newPlayerLogs.length + 5 - 1
        }C${playerColIdx + 1}`;
        await sheetsWrite(
          sheets,
          BLB_SHEET_ID,
          playerLogRange,
          newPlayerLogs.map((x) => [x]),
        );
        if (
          newPlayerLogs.includes("done Squirrel") &&
          newPlayerLogs.includes("chose ELD")
        ) {
          const channel = await player.guild.channels.fetch(
            PACKGEN_CHANNEL_ID,
          ) as djs.TextChannel;
          await channel.send(
            `<@!${playerId}> chose Squirrel and will receive a BLB pack and an ELD pack on their next loss.`,
          );
        }
        const newPacks = getPoolPacks(newPlayerLogs);
        const newSingles = getPoolSingles(newPlayerLogs);
        for (const pack of newPacks) {
          const channel = await player.guild.channels.fetch(
            PACKGEN_CHANNEL_ID,
          ) as djs.TextChannel;
          if (!channel) throw new Error("NO PACKGEN CHANNEL?!?");
          // TODO get pack contents
          // TODO better message
          // TODO attach image
          const content = await fetchSealedDeck(pack);
          await channel.send(
            `<@!${playerId}> ${
              currentBoon ? "chose " + currentBoon + " and " : ""
            }got a pack: https://sealeddeck.tech/${pack}\n\n${
              formatCardList([
                ...content.sideboard,
                ...content.hidden,
                ...content.deck,
              ])
            }`,
          );
        }
        if (newSingles.length) {
          const channel = await player.guild.channels.fetch(
            PACKGEN_CHANNEL_ID,
          ) as djs.TextChannel;
          if (!channel) throw new Error("NO PACKGEN CHANNEL?!?");
          // TODO better message
          // TODO attach image
          await channel.send(
            `<@!${playerId}> got some cards:\n\n${formatCardList(newSingles)}`,
          );
        }
      }
      if (newTrashLogs.length) {
        // if no previous logs, write to row 2
        const startRow = trashLogs.length + 2;
        const endRow = startRow + newTrashLogs.length - 1;
        const trashLogRange = `${
          blbConfig.get("LOG_SHEET_NAME")
        }!R${startRow}C${TRASH_COL_NUM}:R${endRow}C${TRASH_COL_NUM}`;
        await sheetsWrite(
          sheets,
          BLB_SHEET_ID,
          trashLogRange,
          newTrashLogs.map((x) => [x]),
        );
      }
      await updatePool(playerPoolRow, poolPacks, rerolls, poolSingles, sheets);
    },
  };
}

async function updatePool(
  playerPoolRow: PoolRow,
  poolPacks: readonly string[],
  rerolls: string[],
  poolSingles: readonly string[],
  sheets: Sheets,
) {
  const oldPoolValue = playerPoolRow.pool.filter((x) => x).join("|");
  const newPoolPacks = replaceRerolls(poolPacks, rerolls);
  const newPoolValue = [
    ...newPoolPacks,
    poolSingles.join("\n"),
  ].filter((x) => x).join("|");
  if (oldPoolValue != newPoolValue) {
    await writePool(playerPoolRow, newPoolPacks, poolSingles, sheets);
    return true;
  }
  return false;
}

function getPoolSingles(newPlayerLogs: readonly string[]) {
  return newPlayerLogs.flatMap((x) => {
    const [v, ...ws] = x.split(" ");
    if (v === "cards") {
      const cs = ws.join(" ").split("|");
      return cs;
    }
    return [];
  });
}

function getPoolPacks(playerLogs: readonly string[]) {
  return playerLogs.flatMap((x) => {
    const [v, ...ps] = x.split(" ");
    if (v === "pack") return ps;
    return [];
  });
}

type PoolRow = {
  player: string;
  pool: string[];
  starting: string;
  current: string;
  index: number;
  losses: number;
  wins: number;
};

export async function fixPoolRow(sheets: Sheets, playerId: djs.Snowflake) {
  const poolRow = await getPoolRow(sheets, playerId);
  const standingsData = await getStandings(sheets);
  const { playerLogs } = await fetchLogs(
    sheets,
    Object.keys(standingsData).length,
  );
  if (!playerId) return "Couldn't find player";
  const playerLog = playerLogs[playerId];
  const packs = getPoolPacks(playerLog.playerLogs);
  const singles = getPoolSingles(playerLog.playerLogs);
  const updated = await updatePool(
    poolRow,
    packs,
    playerLog.rerolls,
    singles,
    sheets,
  );
  return updated ? "Updated" : "No update needed";
}

async function getPoolRow(
  sheets: Sheets,
  playerId: djs.Snowflake,
): Promise<
  PoolRow
> {
  const poolsRange = await sheetsRead(
    sheets,
    BLB_SHEET_ID,
    `${blbConfig.get("POOL_SHEET_NAME")}!B:S`,
  );
  return poolsRange.values!.map((r, i) => ({
    pool: r.slice(5).map((x) => x),
    current: r[4],
    starting: r[3],
    player: r[0],
    losses: r[1],
    wins: r[2],
    index: i,
  }))
    .find((x) => x.player === playerId) ??
    (() => {
      throw new Error(
        `Missing ${playerId} from ${blbConfig.get("POOL_SHEET_NAME")} tab`,
      );
    })();
}

async function writePool(
  playerPoolRow: {
    player: string;
    pool: string[];
    starting: string;
    current: string;
    index: number;
    losses: number;
    wins: number;
  },
  poolPacks: readonly string[],
  poolSingles: readonly string[],
  sheets: Sheets,
) {
  const newPool = await buildPool(
    playerPoolRow.starting,
    poolPacks,
    poolSingles,
  );
  const range = `${blbConfig.get("POOL_SHEET_NAME")}!R${
    playerPoolRow.index + 1
  }C6:R${playerPoolRow.index + 1}C${newPool.length + 6 - 1}`;
  const values = [newPool];
  await sheetsWrite(sheets, BLB_SHEET_ID, range, values);
}

// base26
function columnToName(number: number) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let ret = "";
  number -= 1;
  if (number < 0) throw new Error("Bad number: " + (number + 1));
  do {
    ret = alpha[number % alpha.length] + ret;
    number = number / alpha.length | 0;
  } while (number);
  return ret;
}

export async function fetchLogs(sheets: Sheets, playerCount: number) {
  const botLogs = await sheetsRead(
    sheets,
    BLB_SHEET_ID,
    `${blbConfig.get("LOG_SHEET_NAME")}!A:${
      columnToName(1 + playerCount /* left col is trash so 1 extra */)
    }`,
  );
  if (!botLogs.values) throw new Error("Couldn't get bot logs!");
  const trashLogs: string[] = botLogs.values.slice(1).flatMap((x) =>
    x.slice(0, 1).filter((x) => x)
  );
  const perPlayer = botLogs.values.map((x) => x.slice(2));
  const names = perPlayer[0];
  const discordIds = perPlayer[1];
  const rerolls = perPlayer.slice(2, 4);
  const boonLogs = perPlayer.slice(4);
  const playerLogs = Object.fromEntries(discordIds.map((
    x,
    i,
  ) =>
    [x as string, {
      name: names[i] as string,
      rerolls: [rerolls[0][i], rerolls[1][i]].filter((x) => x) as string[],
      playerLogs: boonLogs.flatMap((r) =>
        r.slice(i, i + 1).filter((x) => x)
      ) as string[],
      columnIndex: i + 2,
    }] as const
  ));
  return { trashLogs, playerLogs };
}

function xmur3(str: string) {
  let i: number, h: number;
  for ([i, h] = [0, 1779033703 ^ str.length]; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353), h = h << 13 | h >>> 19;
  }
  return function () {
    h = Math.imul(h ^ h >>> 16, 2246822507),
      h = Math.imul(h ^ h >>> 13, 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

type SealedDeckEntry = { readonly name: string; readonly count: number };

type SealedDeckPool = {
  readonly poolId: string;
  readonly sideboard: readonly SealedDeckEntry[];
  readonly hidden: readonly SealedDeckEntry[];
  readonly deck: readonly SealedDeckEntry[];
};

type SealedDeckPoolRequest = Omit<SealedDeckPool, "poolId">;

const sealedDeckCache = new Map<string, SealedDeckPool>();

async function fetchSealedDeck(id: string): Promise<SealedDeckPool> {
  const cached = sealedDeckCache.get(id);
  if (cached) return cached;
  let lastError;
  for (let retryDelay = 1; retryDelay < MAX_RETRY_DELAY; retryDelay *= 2) {
    try {
      const url = `https://sealeddeck.tech/api/pools/${id}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(
          "GET: Bad SealedDeck response: " + resp.status + " (for " + url + ")",
        );
      }
      const json = await resp.json();
      return json;
    } catch (e) {
      lastError = e;
      console.log("delaying", e);
      await delay(retryDelay * 1000 + Math.random() * 64);
    }
  }
  throw lastError;
}

async function makeSealedDeck(
  req: SealedDeckPoolRequest,
): Promise<SealedDeckPool> {
  let lastError;
  for (let retryDelay = 1; retryDelay < MAX_RETRY_DELAY; retryDelay *= 2) {
    try {
      const resp = await fetch(`https://sealeddeck.tech/api/pools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!resp.ok) {
        throw new Error("POST: Bad SealedDeck response: " + resp.status);
      }
      const json = await resp.json();
      const pool: SealedDeckPool = { ...req, poolId: json.poolId };
      sealedDeckCache.set(pool.poolId, pool);
      return pool;
    } catch (e) {
      lastError = e;
      console.log("delaying", e);
      await delay(retryDelay * 1000 + Math.random() * 64);
    }
  }
  throw lastError;
}

async function buildPool(
  starting: string,
  poolPacks: readonly string[],
  poolSingles: readonly string[],
): Promise<string[]> {
  const packs = await Promise.all(
    [starting, ...poolPacks].map(fetchSealedDeck),
  );
  const entries = [
    ...packs.flatMap((x) => [...x.deck, ...x.hidden, ...x.sideboard]),
    ...poolSingles.map((x) => ({ name: x, count: 1 })),
  ];
  const req: SealedDeckPoolRequest = {
    sideboard: Object.entries(Object.groupBy(entries, (e) => e.name)).map((
      [name, es],
    ) => ({ name, count: es!.reduce((acc, e) => acc + e.count, 0) })),
    hidden: [],
    deck: [],
  };
  const newPool = await makeSealedDeck(req);
  const all = [newPool.poolId, ...poolPacks];
  while (all.length < 13) all.push("");
  all.push(poolSingles.join("\n"));
  return all;
}

function replaceRerolls(
  poolPacks: readonly string[],
  rerollLogs: readonly string[],
): string[] {
  const packs = [...poolPacks];
  for (const l of rerollLogs) {
    const m = l.match(/^swap (\w+) (\w+)/);
    if (m) {
      const i = packs.indexOf(m[1]);
      if (i >= 0) packs.splice(i, 1, m[2]);
    }
  }
  return packs;
}

async function extractSdtId(
  message: djs.Message<true>,
): Promise<string | null> {
  const rx = /sealeddeck\.tech\/([a-zA-Z0-9]+)/;
  // TODO figure out how to parse from booster tutor & look at that too!
  const m = message.content.match(rx);
  if (m?.[1]) return m[1];
  const embed = message.embeds.find((x) => x.title?.endsWith("booster"));
  if (embed) {
    const content = embed.description;
    if (!content) return null;
    const parsed = readStringPool(content.replaceAll(/\s*```\s*/g, ""));
    const pool = await makeSealedDeck({
      sideboard: parsed.sideboard,
      hidden: [],
      deck: [],
    });
    return pool.poolId;
  }
  return null;
}

function formatCardList(cards: (SealedDeckEntry | string)[]) {
  return "```\n" +
    cards.map((x) => typeof x === "string" ? x : x.count + " " + x.name).join(
      "\n",
    ) +
    "\n```";
}

function isLeagueCommittee(member: djs.GuildMember) {
  return member.roles.cache.has(LC_ROLE_ID);
}

export async function watchSheet(client: djs.Client<true>, sheets: Sheets) {
  if (!BLB_SHEET_ID) return;

  // TODO also run on entropy not just matches played
  while (true) {
    try {
      let standings = null;
      const data = await sheetsRead(
        sheets,
        BLB_SHEET_ID,
        `${blbConfig.get("MATCHES_SHEET_NAME")}!B9:E`,
      );
      const players = new Set<string>();
      if (data.values) {
        for (let i = 0; i < data.values.length; i++) {
          const [_winner, loser, _result, pack] = data.values[i];
          if (!loser || pack) continue;
          standings ??= await getStandings(sheets);
          const [playerId] = Object.entries(standings).find(([_, x]) =>
            x.name === loser
          )!;
          if (!players.has(playerId)) {
            players.add(playerId);
            await onMatchEntry(
              { discord: client, sheets },
              playerId,
              standings,
            );
          }
          await sheetsWrite(
            sheets,
            BLB_SHEET_ID,
            `${blbConfig.get("MATCHES_SHEET_NAME")}!E${9 + i}`,
            [["1"]],
          );
        }
      }
      standings = null; // reset standings just in case things have changed...
      const entropyData = await sheetsRead(
        sheets,
        BLB_SHEET_ID,
        `${blbConfig.get("ENTROPY_SHEET_NAME")}!D5:H`,
      );
      if (entropyData.values) {
        for (let i = 0; i < entropyData.values.length; i++) {
          const [loser, _winnerScore, _loserScore, _result, pack] =
            entropyData.values[i];
          if (!loser || pack) continue;
          standings ??= await getStandings(sheets);
          const [playerId] = Object.entries(standings).find(([_, x]) =>
            x.name === loser
          )!;
          if (!players.has(playerId)) {
            players.add(playerId);
            await onMatchEntry(
              { discord: client, sheets },
              playerId,
              standings,
            );
          }
          await sheetsWrite(
            sheets,
            BLB_SHEET_ID,
            `${blbConfig.get("ENTROPY_SHEET_NAME")}!H${5 + i}`,
            [["1"]],
          );
        }
      }
    } catch (e) {
      console.error(e);
    }
    await delay(60_000);
  }
}
