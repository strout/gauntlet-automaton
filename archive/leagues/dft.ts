import { columnIndex, sheetsWrite } from "./sheets.ts";
import { sheets, sheetsRead } from "./sheets.ts";
import { CONFIG } from "./main.ts";
import { delay } from "@std/async/delay";
import { mutex } from "./mutex.ts";
import {
  addPoolChange,
  getEntropy,
  getMatches,
  getPlayers,
} from "./standings.ts";
import * as djs from "discord.js";
import { Handler } from "./dispatch.ts";

const MESSAGE_SHEET_ID = "___";

type MessageKey =
  | "Registration"
  | `Win${number}`
  | `Speed${number}`
  | "Accelerate"
  | "Boost"
  | `Elimination_${Plane}`
  | "Credits";
type MessageRowKey = MessageKey | `${MessageKey}_Image`;
type Transportation = "Vehicle" | "Mount";
type Plane = "Avishkar" | "Amonkhet" | "Muraganda";
type SelectionKey = `${Transportation}_${Plane}`;

function timedCache<T>(millis: number, retrieve: () => Promise<T>) {
  let val: T;
  let lastFetched: Date | undefined = undefined;
  return async function () {
    if (lastFetched && lastFetched > new Date(Date.now() - millis)) {
      return val;
    }
    val = await retrieve();
    lastFetched = new Date();
    return val;
  };
}

const getMessages = timedCache(1000 * 60 * 5, async () => {
  const { values } = await sheetsRead(sheets, MESSAGE_SHEET_ID, "Messages!A:G");
  const [[, ...headers], ...rows] = values!;
  return Object.fromEntries(
    rows.map((
      [key, ...values],
    ) => [key, Object.fromEntries(values.map((v, i) => [headers[i], v]))]),
  ) as Record<MessageRowKey, Record<SelectionKey, string>>;
});

const revRides: Record<string, { plane: Plane; ride: Transportation }> = {
  "AG-4600": { plane: "Avishkar", ride: "Vehicle" },
  "Dermotaxi": { plane: "Muraganda", ride: "Vehicle" },
  "Lizzy": { plane: "Muraganda", ride: "Mount" },
  "Raja": { plane: "Avishkar", ride: "Mount" },
  "Scarab Skimmer": { plane: "Amonkhet", ride: "Vehicle" },
  "Sekhtet": { plane: "Amonkhet", ride: "Mount" },
} as const;

const getRidesAndPlanes = timedCache(1000 * 60 * 5, async () => {
  const standings = await getPlayers();
  return standings.map((x) => ({
    discordId: x.id,
    ...revRides[x.row[columnIndex("AI")]] ?? {},
  }));
});

const matchesLock = mutex();

let requested = false;

function mapValues<K extends string | number | symbol, A, B>(
  obj: Record<K, A>,
  fn: (a: A) => B,
): Record<K, B> {
  // TODO why do I need any here?
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, fn(v as any)]),
  ) as any;
}

async function messagesFor(discordId: string) {
  const regData = await getRidesAndPlanes();
  const row = regData.find((r) => r.discordId === discordId);
  if (!row) throw new Error("No registration data found for " + discordId);
  const ride = row.ride;
  const plane = row.plane;
  const key = `${ride}_${plane}` as const;
  const messages = await getMessages();
  return mapValues(messages, (o) => o[key]);
}

export async function checkForMatches(client: djs.Client<true>) {
  // TODO Abstract out this "requested" song-and-dance; it's essentially a debounce
  if (requested) return;
  requested = true;
  using _ = await matchesLock();
  if (!requested) return;
  requested = false;

  try {
    const matches = await getMatches();
    const entropies = await getEntropy();
    const all = [
      ...matches.map((m) => ({
        ...m,
        type: "match" as const,
        messaged: !!m.row[columnIndex("G", "A")],
      })),
      ...entropies.map((e) => ({
        ...e,
        type: "entropy" as const,
        messaged: !!e.row[columnIndex("J", "A")],
      })),
    ].sort((a, z) => a.timestamp - z.timestamp);
    let players: Awaited<ReturnType<typeof getPlayers>> | undefined;
    for (const m of all) {
      const { winner: winnerName, loser: loserName, messaged } = m;
      if (!loserName || messaged) continue;
      players ??= await getPlayers();
      await messageWinner(client, players.find((v) => v.name === winnerName));

      const skipExtraEntropy = m.type === "entropy" &&
        all.filter((x) =>
            x.type === "entropy" && !x.messaged && x.loser === m.loser
          ).length > 1;

      const loser = players.find((v) => v.name === loserName);

      if (!skipExtraEntropy) {
        await messageLoser(
          client,
          loser,
          m.type,
          m.type === "match"
            ? m.matchRowNum
            : m.type === "entropy"
            ? m.entropyRowNum
            : m satisfies never,
        );
      }

      if (loser) {
        const { speed, boosts } = currentSpeed(loser);
        if (speed === 4 && boosts < 3 && loser.losses < 11) {
          await boost(loser, client);
          // record speed boosts in case this is mid-entropy or there are otherwise multiple reports
          loser.row[columnIndex("AA")] += 4;
          loser.row[columnIndex("AH")] += 1;
        }
      }

      const cell = m.type === "match"
        ? "Matches!G" + m.matchRowNum
        : m.type === "entropy"
        ? "Entropy!J" + m.entropyRowNum
        : m satisfies never;
      await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, cell, [[
        "1",
      ]]);

      // mark as messaged in-line so we can handle multiple entropy for a person in a single pass
      m.messaged = true;
    }
  } catch (e) {
    console.error(e);
  }
}

async function messageWinner(
  client: djs.Client<true>,
  winner: Awaited<ReturnType<typeof getPlayers>>[number] | undefined,
) {
  // no winner is possible if it's entropy, and winner messages are just flavor, so OK to silently skip if there is none
  if (!winner) return;
  const wins = winner.wins;
  const key = `Win${wins}` as const;
  await sendMessage(winner.id, key, client);
}

export async function sendMessage(
  discordId: string,
  key: MessageKey,
  client: djs.Client<true>,
) {
  console.log("sending", key, "to", discordId);
  const msgs = await messagesFor(discordId);
  const text = msgs[key];
  if (text) {
    const image = msgs[`${key}_Image`];
    const embeds = [...image ? [{ image: { url: image } }] : [], {
      description: text,
    }];
    const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
    const member = await guild.members.fetch(discordId);
    await member.send({ embeds });
  } else {
    console.warn("No text for " + key);
  }
}

async function messageLoser(
  client: djs.Client<true>,
  loser: Awaited<ReturnType<typeof getPlayers>>[number] | undefined,
  type: string,
  rowNum: number,
) {
  if (!loser) {
    const owner = await client.users.fetch(CONFIG.OWNER_ID);
    await owner.send("Uh oh, match without loser: " + type + "!" + rowNum);
    return;
  }
  let key;
  if (loser.losses < 11) {
    const { speed, boosts } = currentSpeed(loser);
    if (boosts === 3) return; // don't message about boost if they have none
    key = `Speed${speed}` as const;
  } else {
    key = `Elimination_${planeFor(loser.wins)}` as const;
  }
  await sendMessage(loser.id, key, client);
}

export async function watchSheet(client: djs.Client<true>): Promise<void> {
  while (true) {
    await checkForMatches(client);
    await delay(30000);
  }
}

function planeFor(wins: number): Plane {
  if (wins <= 2 || wins >= 16) return "Avishkar";
  if (wins <= 5 || wins >= 12) return "Amonkhet";
  return "Muraganda";
}

const accelerateHandler: Handler<djs.Message> = async (msg, handle) => {
  if (msg.inGuild() || msg.content.trim() !== "!accelerate") return;
  handle.claim();
  const id = msg.author.id;
  await sendMessage(id, "Accelerate", msg.client);
};

const boostHandler: Handler<djs.Message> = async (msg, handle) => {
  if (msg.inGuild() || msg.content.trim() !== "!boost") return;
  handle.claim();
  const id = msg.author.id;
  const players = await getPlayers();
  const player = players.find((x) => x.id === id);
  if (!player) {
    await msg.reply(
      "Uh oh, I can't find you on the standings sheet. Ask for help in #league-committee.",
    );
    return;
  }
  const error = await boost(player, msg.client);
  if (error) await msg.reply(error.error);
};

const matchReportHandler: Handler<djs.Message> = async (msg, handle) => {
  handle.release(); // this isn't exclusive, so release it right away
  if (msg.author.id !== CONFIG.PACKGEN_USER_ID) return;
  await checkForMatches(msg.client);
};

export const dftHandlers = [
  boostHandler,
  accelerateHandler,
  matchReportHandler,
];

function currentSpeed(player: Awaited<ReturnType<typeof getPlayers>>[number]) {
  const speedUsed = +player.row[columnIndex("AA", "A")];
  const speed = Math.max(0, Math.min(player.losses - speedUsed, 4));
  const ret = {
    speed: speed as 0 | 1 | 2 | 3 | 4,
    boosts: +player.row[columnIndex("AH", "A")],
  };
  return ret;
}

async function boost(
  player: Awaited<ReturnType<typeof getPlayers>>[number],
  client: djs.Client<true>,
) {
  const { speed, boosts } = currentSpeed(player);
  if (boosts >= 3) {
    return { error: "You have used all 3 of your speed boosts already." };
  } else if (speed <= 0) {
    return {
      error:
        "You don't have any speed boosts. You can `!boost` again after you've lost a match.",
    };
  } else {
    const packs = ["KLR", "IKO", "LCI", "MOM"];
    const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
    const channel = await guild.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    ) as djs.TextChannel;
    await channel.send(
      `!${
        packs[speed - 1]
      } <@!${player.id}> used a level ${speed} Speed Boost.`,
    );
    await addPoolChange(player.name, "boost", `${speed}`, "");
    await sendMessage(player.id, "Boost", client);
    return;
  }
}
