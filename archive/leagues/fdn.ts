import { delay } from "@std/async";
import * as djs from "discord.js";
import { columnIndex, sheets, sheetsRead, sheetsWrite } from "./sheets.ts";
import { ValueRange } from "sheets";
import { fetchSealedDeck, makeSealedDeck } from "./sealeddeck.ts";
import { CONFIG, FDN_SHEET_ID } from "./main.ts";
import { mutex } from "./mutex.ts";
import { addPoolChange, rebuildPool } from "./standings.ts";
import { searchCards } from "./scryfall.ts";

const lock = mutex();

const fdnCommons: string[] = await searchCards(
  "set:FDN rarity:common is:booster",
).then((r) => r.map((x) => x.name));

export async function watchSheet(client: djs.Client<true>): Promise<void> {
  while (true) {
    await checkForMatches(client);
    await delay(30000);
  }
}

// running & requested will cause it to re-check if multiple requests come in at once, but it won't run twice concurrently
let running = false;
let requested = false;

export async function checkForMatches(client: djs.Client<true>) {
  requested = true;
  if (running) return;
  running = true;
  while (running) {
    requested = false;
    let unlock = undefined;
    try {
      unlock = await lock();
      // TODO check week number?!?
      const matches = await sheetsRead(sheets, FDN_SHEET_ID, "Matches!C2:J");
      let row = 1;
      let players: ValueRange | undefined;
      let pools: ValueRange | undefined;
      let week: number | undefined;
      for (const m of matches.values ?? []) {
        row++; // start counting at 2 (after first increment) matching sheets row #
        if (!m[0]) continue; // no loser? skip
        const loserName = m[0];
        const unchartedHavenCommon = m[4];
        const messaged = m[7];
        if (!loserName || unchartedHavenCommon || messaged) continue;
        players ??= await sheetsRead(
          sheets,
          FDN_SHEET_ID,
          "Player Database!B2:I",
        );
        const playerRow = players.values!.find((v) => v[0] === loserName);
        if (!playerRow) {
          console.error("No player row found for " + loserName);
          continue;
        }
        const [
          _name,
          _shortName,
          discordId,
          _arenaId,
          _country,
          _played,
          _wins,
          losses,
        ] = playerRow;
        if (+losses >= 11) {
          // skip, eliminated
          continue;
        }
        if (!discordId) {
          // skip, no discord id
          continue;
        }

        week ??=
          (await sheetsRead(sheets, FDN_SHEET_ID, "Quotas!B2")).values![0][0];

        if (week == 1) {
          // only check first 5 since it's week 1
          pools ??= await sheetsRead(sheets, FDN_SHEET_ID, "Pools!D:M");
          const poolRow = pools.values?.find((row) => row[0] === loserName);

          if (!poolRow) {
            console.error("No pool row found for " + loserName);
            continue;
          }

          // verify pack has been generated
          const packCount = poolRow.findLastIndex((x) => x) - 4; // starting pool is row H so if that's last populated, it's 0 packs.
          if (packCount < losses) {
            // no pack yet, wait
            console.log(
              `Waiting for ${loserName} to have ${losses} packs (has ${packCount})`,
            );
            continue;
          }

          const currentPoolLink = poolRow[3];

          const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
          const member = await guild.members.fetch(discordId);
          // TODO extra intro on loss 1?
          await member.send(
            `Hey! ${
              losses === 1 ? "Are you exploring too?" : ""
            }I can help you find ${
              losses > 1 ? "another" : "a"
            } thingamajig. Which thingamajig are you looking for?\n\n*Reply with the name of [any common from FDN](https://scryfall.com/search?q=set:FDN+rarity:common+is:booster&order=color) not already [in your pool](${currentPoolLink}).*`,
          );
        }
        // mark this one as handled
        await sheetsWrite(sheets, FDN_SHEET_ID, "Matches!J" + row, [["1"]]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      unlock?.();
    }
    if (requested) await delay(5000);
    running = requested;
  }
}

export async function handleFdnWeek1(message: djs.Message<false>) {
  // TODO check week number?
  const choice = message.content.trim().toLowerCase();
  const common = fdnCommons.find((c) => c.toLowerCase() === choice);
  const pdb = await sheetsRead(
    sheets,
    FDN_SHEET_ID,
    "Player Database!B2:X",
  );
  const playerRow = pdb.values!.find((r) => r[2] === message.author.id);
  if (!playerRow) {
    await message.reply("Sorry, I can't find you on the player list.");
    return;
  }
  const name = playerRow[0];
  const lastLossWeek = playerRow[columnIndex("X", "B")];
  if (lastLossWeek > 1) {
    await message.reply("Sorry, you've already lost on the next plane!");
    return;
  }
  const matches = await sheetsRead(sheets, FDN_SHEET_ID, "Matches!C2:J");
  const matchIndex = matches.values!.findLastIndex((r) =>
    r[0] === name && r[7]
  );
  if (matchIndex === -1) {
    await message.reply("Sorry, I can't find a recent loss for you.");
    return;
  }
  if (matches.values![matchIndex][4]) {
    await message.reply(
      "Sorry, looks like you've already claimed your card for this loss.",
    );
    return;
  }
  if (!common) {
    await message.reply(
      "Sorry, looks like that isn't the name of a FDN common.",
    );
    return;
  }
  const pools = await sheetsRead(sheets, FDN_SHEET_ID, "Pools!D7:G");
  const poolRowIndex = pools.values?.findIndex((r) => r[0] === name) ?? -1;
  let poolLink = "";
  if (poolRowIndex > -1) {
    const poolRow = pools.values![poolRowIndex];
    const poolId = poolRow[3].split(".tech/")[1];
    const pool = await fetchSealedDeck(poolId);
    if (
      [...pool.sideboard, ...pool.deck, ...pool.hidden].some((c) =>
        c.name.toLowerCase() == choice
      )
    ) {
      await message.reply(
        `Sorry, you've already got one of those. Choose something that's not [in your pool already](https://sealeddeck.tech/${poolId}).`,
      );
      return;
    }
    await addPoolChange(name, "add card", common, "Uncharted Haven");
    await sheetsWrite(sheets, FDN_SHEET_ID, "Matches!G" + (matchIndex + 2), [[
      common,
    ]]);
    try {
      const updatedPoolId = await makeSealedDeck({
        sideboard: [{ name: common, count: 1 }],
      }, poolId);
      poolLink = "https://sealeddeck.tech/" + updatedPoolId;
      await sheetsWrite(sheets, FDN_SHEET_ID, "Pools!G" + (poolRowIndex + 7), [[
        poolLink,
      ]]);
    } catch (e) {
      console.error(e);
      try {
        await message.client.users.send(
          CONFIG.OWNER_ID,
          "Problem updating pool for " + name + "\n\n" + e,
        );
      } catch (_e) { /* error report failed; ignore */ }
    }
  } else {
    await message.reply(
      "Sorry, I couldn't find your pool. Ask for help in #league-committee.",
    );
    return;
  }
  await message.author.send(
    `Okay! ${common} has been added to ${
      poolLink ? `[your pool](${poolLink})` : "your pool"
    }.`,
  );
  const guild = await message.client.guilds.fetch(CONFIG.AGL_GUILD_ID);
  if (!guild) console.log("Hmm, couldn't fetch " + CONFIG.AGL_GUILD_ID);
  const channel = await guild?.channels?.fetch(CONFIG.PACKGEN_CHANNEL_ID) as
    | djs.TextChannel
    | undefined;
  if (!channel) {
    console.log(
      "Couldn't get channels",
      !!guild,
      !!guild?.channels,
      !!guild?.channels?.fetch,
    );
  }
  await channel?.send(`<@${message.author.id}> added ${common} to their pool.`);
}

export async function handleReroll(message: djs.Message<boolean>) {
  try {
    const pdb = await sheetsRead(
      sheets,
      FDN_SHEET_ID,
      "Player Database!B2:AB",
    );
    const playerRow = pdb.values!.find((r) => r[2] === message.author.id);
    if (!playerRow) {
      await message.reply("Sorry, I can't find you on the player list.");
      return;
    }
    const name = playerRow[0];
    const lastMatchTime = playerRow[columnIndex("AA", "B")];
    const mapsUsed = playerRow[columnIndex("AB", "B")];
    if (mapsUsed >= 2) {
      await message.reply(
        "Sorry, you're [out of Maps](https://scryfall.com/card/rvr/64/totally-lost).",
      );
      return;
    }
    const poolChanges = await sheetsRead(
      sheets,
      FDN_SHEET_ID,
      "Pool Changes!A1:E",
    );
    const latestPoolRow = poolChanges.values!.findLast((x) => x[1] === name);
    if (!latestPoolRow) {
      await message.reply(
        `Weird, I can't find any previous packs for you. CC <@${CONFIG.OWNER_ID}>`,
      );
      return;
    }
    if (latestPoolRow[2] !== "add pack") {
      await message.reply(
        `Weird, the latest change to your pool wasn't adding a pack. CC <@${CONFIG.OWNER_ID}>`,
      );
      return;
    }
    if (latestPoolRow[4] < lastMatchTime) {
      await message.reply(
        "Sorry, you've played a match since you received your last pack; you'll have to keep it.",
      );
      return;
    }
    if (
      poolChanges.values!.filter((x) => x[3] === latestPoolRow[3]).length > 1
    ) {
      await message.reply(
        "Sorry, I can't find the pack to reroll. If you just rerolled, try again in a few seconds.",
      );
      return;
    }
    const pools = await sheetsRead(sheets, FDN_SHEET_ID, "Pools!D:M");
    const poolRowIdx = pools.values!.findIndex((row) => row[0] === name);
    const poolRow = pools.values![poolRowIdx];
    if (!poolRow) {
      await message.reply(
        "Sorry, I can't find your pool. CC <@" + CONFIG.OWNER_ID + ">",
      );
    }
    // steps to take:
    // 0. typing notification
    await (message.channel as djs.TextChannel).sendTyping();
    // 1. rebuild pool & generate url
    const goodPool = await rebuildPool(
      (poolChanges.values! as [number, string, string, string][]).filter((x) =>
        x[1] === name
      ).slice(0, -1),
      poolRow[columnIndex("H", "D")].split(".tech/")[1],
    );
    // 2. record removal & pool url
    await addPoolChange(name, "remove pack", latestPoolRow[3], "Ixalan's Core");
    await sheetsWrite(sheets, FDN_SHEET_ID, "Pools!G" + (poolRowIdx + 1), [[
      "https://sealeddeck.tech/" + goodPool.poolId,
    ]]);
    // 3. _
    // 4. request new pack
    await (message.channel as djs.TextChannel).send(
      "!pool XLN|RIX <@!" + message.author.id +
        "> used a map (discarding pack https://sealeddeck.tech/" +
        latestPoolRow[3] + ")",
    );
  } catch (e) {
    console.error(e);
    await message.reply("Something went wrong! CC <@" + CONFIG.OWNER_ID + ">");
  }
}
