import { Client, Collection, GuildMember, Snowflake } from "discord.js";
import {
  CONFIG,
  getRegistrationData,
  initiateChoice,
  outstandingChoiceFor,
} from "./main.ts";
import { columnIndex, sheets, sheetsWrite } from "./sheets.ts";
import { delay } from "@std/async/delay";
import { mutex } from "./mutex.ts";
import {
  getEntropy,
  getMatches,
  getPlayers,
  getPoolChanges,
} from "./standings.ts";

const roleMap: Record<string, Snowflake> = {
  Abzan: "1150619583552704512",
  Jeskai: "1150620978381074543",
  Sultai: "1150619818085589022",
  Mardu: "1150621155649142865",
  Temur: "1150620029671444520",
};

const allRoles = Object.values(roleMap);

export async function assignClanRoles(
  members: Collection<string, GuildMember>,
) {
  const sheetData = await getRegistrationData();
  const CLAN_COLUMN = columnIndex("I");
  const clans = Object.groupBy(sheetData, (x) => x.row[CLAN_COLUMN] ?? "None");
  console.log(
    Object.entries(clans).map((x) => [x[0], x[1]?.length].join(": ")).join(
      ", ",
    ),
  );
  for (const [clan, mems] of Object.entries(clans)) {
    if (!mems) continue;
    if (!roleMap[clan]) continue;
    for (const mem of mems) {
      if (!mem.discordId) continue;
      const user = members.get(mem.discordId);
      if (!user) continue;
      const wantedRole = roleMap[clan];
      const unwantedRoles = allRoles.filter((x) => x !== wantedRole);
      if (!user.roles.cache.has(wantedRole)) {
        console.log("Adding", clan, "to", mem.name + " // " + mem.arenaId);
        await user.roles.add(wantedRole);
      }
      if (user.roles.cache.hasAny(...unwantedRoles)) {
        console.log(
          "Removing all but",
          clan,
          "from",
          mem.name + " // " + mem.arenaId,
        );
        await user.roles.remove(unwantedRoles);
      }
    }
  }
}

const matchesLock = mutex();

let requested = false;

const MATCH_MESSAGED_COLUMN = "G";
const ENTROPY_MESSAGED_COLUMN = "J";

export async function checkForMatches(client: Client<true>) {
  // TODO Abstract out this "requested" song-and-dance; it's essentially a debounce
  if (requested) return;
  requested = true;
  using _ = await matchesLock();
  if (!requested) return;
  requested = false;

  try {
    const all = await getAllResults();
    let players: Awaited<ReturnType<typeof getPlayers>> | undefined;
    for (const m of all) {
      const { loser: loserName, messaged } = m;
      if (!loserName || messaged) continue;
      players ??= await getPlayers();

      const loser = players.find((v) => v.name === loserName);

      if (!loser) continue;
      if (outstandingChoiceFor(CONFIG.PACKGEN_CHANNEL_ID, loser.id)) continue;

      let isOddLoss = true;
      for (const m2 of all) {
        if (m === m2) break;
        if (m.loser === m2.loser) isOddLoss = !isOddLoss;
      }

      if (loser.status !== "Eliminated" && loser.matchesPlayed !== 30) {
        if (isOddLoss) {
          await initiateChoice(
            null,
            [["Khans:cube-TRF", "Dragons:TDM"]],
            loser.id,
            "!choose",
            client,
            CONFIG.PACKGEN_CHANNEL_ID,
          );
        } else {
          try {
            const changes = await getPoolChanges();
            const lastChange = changes.findLast((c) => c.name === loser.name);

            const comment = JSON.parse(lastChange!.comment);
            const packNotChosen = comment.notChosen[0];
            await initiateChoice(
              null,
              [[
                "Past:pack-" + packNotChosen,
                "Future:" +
                (comment.choice.toUpperCase() === "KHANS" ? "TDM" : "cube-TRF"),
              ]],
              loser.id,
              "!choose",
              client,
              CONFIG.PACKGEN_CHANNEL_ID,
            );
          } catch (e) {
            console.error(e);
            continue;
          }
        }
      }

      const cell = m.type === "match"
        ? "Matches!" + MATCH_MESSAGED_COLUMN + m.matchRowNum
        : m.type === "entropy"
        ? "Entropy!" + ENTROPY_MESSAGED_COLUMN + m.entropyRowNum
        : m satisfies never;
      await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, cell, [[
        "1",
      ]]);

      // mark as messaged in-line for anything that refers to it
      m.messaged = true;
    }
  } catch (e) {
    console.error(e);
  }
}

async function getAllResults() {
  const matches = await getMatches();
  const entropies = await getEntropy();
  const all = [
    ...matches.map((m) => ({
      ...m,
      type: "match" as const,
      messaged: !!m.row[columnIndex(MATCH_MESSAGED_COLUMN, "A")],
    })),
    ...entropies.map((e) => ({
      ...e,
      type: "entropy" as const,
      messaged: !!e.row[columnIndex(ENTROPY_MESSAGED_COLUMN, "A")],
    })),
  ].sort((a, z) => a.timestamp - z.timestamp);
  return all;
}

export async function watchSheet(client: Client<true>): Promise<void> {
  while (true) {
    await checkForMatches(client);
    await delay(10000);
  }
}
