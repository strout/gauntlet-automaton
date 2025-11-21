import { mutex } from "./mutex.ts";
import * as djs from "discord.js";
import { CONFIG, outstandingChoiceFor } from "./main.ts";
import { columnIndex, sheets, sheetsAppend, sheetsWrite } from "./sheets.ts";
import {
  addPoolChanges,
  getCurrentWeek,
  getEntropy,
  getExpectedPool,
  getMatches,
  getPlayers,
  getPoolChanges,
  getPools,
  getQuotas,
} from "./standings.ts";
import { delay } from "@std/async";
import { Handler } from "./dispatch.ts";
import {
  fetchSealedDeck,
  formatPool,
  makeSealedDeck,
  SealedDeckPool,
} from "./sealeddeck.ts";
import { extractPool, waitForBoosterTutor } from "./pending.ts";
import { searchCards } from "./scryfall.ts";

let requested = false;
let running = false;

const lock = mutex();

export async function rollPack(client: djs.Client, message: string) {
  const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.BOT_BUNKER_CHANNEL_ID,
  ) as djs.TextChannel;
  const myMessage = channel.send(message);
  return waitForBoosterTutor(myMessage);
}

export async function checkForMatches(client: djs.Client<true>) {
  requested = true;
  if (running) return;
  running = true;
  while (running) {
    requested = false;
    {
      using _ = await lock();
      try {
        // TODO check week number?!?
        const matches = await getMatches();
        const entropies = await getEntropy();
        const all = [
          ...matches.map((m) => ({
            ...m,
            type: "match" as const,
            ability: m.row[columnIndex("G", "A")] as string,
            messaged: m.row[columnIndex("H", "A")] as string,
          })),
          ...entropies.map((e) => ({
            ...e,
            type: "entropy" as const,
            ability: e.row[columnIndex("J", "A")] as string,
            messaged: e.row[columnIndex("K", "A")] as string,
          })),
        ].sort((a, z) => a.timestamp - z.timestamp);
        let players: Awaited<ReturnType<typeof getPlayers>> | undefined;
        let quotas: Awaited<ReturnType<typeof getQuotas>> | undefined;
        for (const m of all) {
          const { loser: loserName, ability, messaged } = m;
          if (!loserName || ability || messaged) continue;
          const previousPending = all.find((m2) =>
            m2.loser === loserName && m2.messaged && !m2.ability
          );
          if (previousPending) continue;
          players ??= await getPlayers();
          const player = players.find((v) => v.name === loserName);
          if (!player) {
            console.error("No player row found for " + loserName);
            continue;
          }
          if (player.losses >= 11) {
            // skip, eliminated
            continue;
          }
          if (!player.id) {
            // skip, no discord id
            continue;
          }

          const loyalty = player.row[columnIndex("AA", "A")];

          quotas ??= await getQuotas();

          const { walker, abilities } = getWalker(m, quotas);

          const dm = await client.users.fetch(player.id);
          await dm.send(
            `You've lost a match, but ${walker} has your back. You have **${loyalty} loyalty**. Choose an ability:\n\n${
              Object.values(abilities).map((a) => a.text).join("\n")
            }\n\n(Type the planeswalker name and the ability number: ${
              Object.keys(abilities).map((x) => `\`${walker} ${x}\``).join(
                " or ",
              )
            })`,
          );

          // mark this one as handled
          const cell = m.type === "match"
            ? "Matches!H" + m.matchRowNum
            : m.type === "entropy"
            ? "Entropy!K" + m.entropyRowNum
            : m satisfies never;
          await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, cell, [[
            "1",
          ]]);
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (requested) await delay(5000);
    running = requested;
  }
}

const isDoneForWeek = (
  p: Awaited<ReturnType<typeof getPlayers>>[number],
): boolean => p.matchesToPlay === "Maxed out" && p.matchesPlayed < 30;
const isInProgress = (
  p: Awaited<ReturnType<typeof getPlayers>>[number],
): boolean =>
  p.matchesToPlay !== "Maxed out" && p.matchesPlayed < 30 && p.losses < 11;

export async function catchUp(client: djs.Client<true>): Promise<void> {
  const players = await getPlayers();
  players.sort((a, z) =>
    (+a.row[columnIndex("AD", "A")]) - (+z.row[columnIndex("AD", "A")])
  ); // do players with lowest pool week first
  console.log(players.length, "players");
  const donePlayers = players.filter(isDoneForWeek);
  const inProgressPlayers = players.filter(isInProgress);
  console.log(new Set(players.map((x) => x.matchesToPlay)));
  console.log(donePlayers.length, "done players");
  const week = await getCurrentWeek();
  console.log(JSON.stringify(week));
  const quotas = await getQuotas();
  // sanity check: done players must match quota;
  if (
    !donePlayers.every((p) => isActuallyDone(p, quotas, week))
  ) {
    console.error(
      "can't catch up: weeks don't match",
      week,
      JSON.stringify(donePlayers.map((p) => [
        p.matchesPlayed,
        quotas.find((q) => q.week === week)?.matchesMax,
      ])),
    );
  } else {
    for (const p of donePlayers) {
      await rerollBonusCards(
        client,
        p.name,
        walkerForWeek({ week: week + 1 }),
        false,
        week + 1,
        false,
      );
    }
    for (const p of inProgressPlayers) {
      await rerollBonusCards(
        client,
        p.name,
        walkerForWeek({ week: week }),
        false,
        week,
        true,
      );
    }
  }
}

const catchUpHandler: Handler<djs.Message> = async (message, handle) => {
  if (message.content === "!catchUp" && message.author.id === CONFIG.OWNER_ID) {
    handle.claim();
    await message.reply("Catching up...");
    await catchUp(message.client);
    await message.reply("Caught up");
  }
};

function isActuallyDone(
  p: Awaited<ReturnType<typeof getPlayers>>[number],
  quotas: Awaited<ReturnType<typeof getQuotas>>,
  week: number,
): unknown {
  return p.matchesPlayed === quotas.find((q) => q.week === week)?.matchesMax;
}

export async function watchSheet(client: djs.Client<true>): Promise<void> {
  let iters = 0;
  while (true) {
    await checkForMatches(client);
    await delay(30000);

    // try rerolling one person every time through the loop
    const players = await getPlayers();
    const toReroll = players[iters % players.length];
    await checkReroll(client, toReroll);
    iters++;
  }
}

const ALL_ABILITIES: Record<
  string,
  Record<
    string,
    {
      text: string;
      action: (
        client: djs.Client,
        id: djs.Snowflake,
        weekPack: string,
        bonusCard: string,
      ) => Promise<void>;
    }
  >
> = {
  "Jace": {
    "+2": {
      text: "+2: Generate a pack of WAR.",
      async action(client, id, _weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(`!pool WAR|cube-${bonusCard} <@${id}> Jace +2`);
      },
    },
    "-1": {
      text: "-1: Generate a pack of PIO and a pack of WAR. Choose one to keep.",
      async action(client, id, weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice PIO:${weekPack}|WAR:WAR+cube-${bonusCard} <@${id}> Jace -1`,
        );
      },
    },
    "-3": {
      text: "-3: Generate a pack of PIO and a pack of WAR. Keep both.",
      async action(client, id, weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(`!${weekPack} <@${id}> Jace -3`);
        await packGen.send(`!pool WAR|cube-${bonusCard} <@${id}> Jace -3`);
      },
    },
    "-7": {
      text:
        "-7: Generate two packs of PIO. Choose one to keep. Repeat this process once.",
      async action(client, id, weekPack, _bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice A:${weekPack}|B:${weekPack} A:${weekPack}|B:${weekPack} <@${id}> Jace -7`,
        );
      },
    },
  },
  "Chandra": {
    "+2": {
      text: "+2: Generate a pack of STX.",
      async action(client, id, _weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(`!pool STX|cube-${bonusCard} <@${id}> Chandra +2`);
      },
    },
    "-1": {
      text: "-1: Generate a pack of PIO and a pack of STX. Choose one to keep.",
      async action(client: djs.Client, id: djs.Snowflake, weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice PIO:${weekPack}|STX:STX+cube-${bonusCard} <@${id}> Chandra -1`,
        );
      },
    },
    "-4": {
      text:
        "-4: Generate a pack of WAR, STX, and NEO. Choose one to discard, keep the others.",
      async action(client, id, _weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice-not WAR:WAR+cube-${bonusCard}|STX:STX+cube-${bonusCard}|NEO:NEO+cube-${bonusCard} <@${id}> Chandra -4`,
        );
      },
    },
    "-7": {
      text:
        "-7: Generate two packs of PIO. Choose one to keep. Repeat this process once.",
      async action(client, id, weekPack, _bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice A:${weekPack}|B:${weekPack} A:${weekPack}|B:${weekPack} <@${id}> Chandra -7`,
        );
      },
    },
  }, /* TODO */
  "Elspeth": {
    "+2": {
      text: "+2: Generate a pack of NEO.",
      async action(client, id, _weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(`!pool NEO|cube-${bonusCard} <@${id}> Elspeth +2`);
      },
    },
    "-1": {
      text: "-1: Generate a pack of PIO and a pack of NEO. Choose one to keep.",
      async action(client, id, weekPack, bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice PIO:${weekPack}|NEO:NEO+cube-${bonusCard} <@${id}> Elspeth -1`,
        );
      },
    },
    "-7": {
      text:
        "-7: Generate two packs of PIO. Choose one to keep. Repeat this process once.",
      async action(client, id, weekPack, _bonusCard) {
        const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
        const packGen = await guild.channels.fetch(
          CONFIG.PACKGEN_CHANNEL_ID,
        ) as djs.TextChannel;
        await packGen.send(
          `!choice A:${weekPack}|B:${weekPack} A:${weekPack}|B:${weekPack} <@${id}> Elspeth -7`,
        );
      },
    },
  },
};

function getWalker(
  match: Awaited<ReturnType<typeof getMatches | typeof getEntropy>>[number],
  quotas: Awaited<ReturnType<typeof getQuotas>>,
) {
  const week = "week" in match
    ? { week: match.week }
    : (quotas.findLast((w) => w.fromDate < match.timestamp) ??
      { week: 1 });

  const walker = walkerForWeek(week);

  const abilities = ALL_ABILITIES[walker];

  return { walker, abilities };
}

const dmHandler: Handler<djs.Message> = async (message, handle) => {
  if (!isDM(message) || message.author.id === message.client.user.id) return;
  const abil = message.content.trim();
  if (!/^(\w+\s*)?[+-]\d+$/.test(abil)) return;
  try {
    const guild = await message.client.guilds.fetch(CONFIG.AGL_GUILD_ID);
    const mem = await guild.members.fetch(message.author.id);
    if (!mem) return;
  } catch {
    return;
  }
  handle.claim();

  using _ = await lock();
  const matches = await getMatches();
  const entropies = await getEntropy();
  const all = [
    ...matches.map((m) => ({
      ...m,
      type: "match" as const,
      ability: m.row[columnIndex("G", "A")] as string,
      messaged: m.row[columnIndex("H", "A")] as string,
    })),
    ...entropies.map((e) => ({
      ...e,
      type: "entropy" as const,
      ability: e.row[columnIndex("J", "A")] as string,
      messaged: e.row[columnIndex("K", "A")] as string,
    })),
  ].sort((a, z) => a.timestamp - z.timestamp);
  const players = await getPlayers();
  const player = players.find((p) => p.id === message.author.id);
  if (!player) {
    await message.reply(
      "Hmm, can't find you in the player database. Contact #league-committee",
    );
    return;
  }
  const loyalty = player.row[columnIndex("AA", "A")];
  const match = all.find((m) => m.loser === player.name && !m.ability);
  if (!match) {
    await message.reply(
      "Hmm, it looks like you can't activate any abilities now. Have you lost a match? Message #league-committee if this is in error.",
    );
    return;
  }
  const outstandingChoice = outstandingChoiceFor(
    CONFIG.PACKGEN_CHANNEL_ID,
    message.author.id,
  );
  if (outstandingChoice) {
    await message.reply(
      "Looks like you haven't chosen your previous pack: " +
        outstandingChoice.myMessage.url + "\n\nDo that, then come back.",
    );
    return;
  }
  const { walker, abilities } = getWalker(match, await getQuotas());
  const parts = abil.split(/\s+/);
  const wantedWalker = parts.length === 1 ? "Jace" : parts[0];
  const abilityKey = parts[parts.length - 1] as keyof typeof abilities;
  const ability = abilities[abilityKey];
  if (wantedWalker !== walker || !ability) {
    await message.reply(
      "Please type one of: " +
        Object.keys(abilities).map((x) => `\`${walker} ${x}\``).join(
          " or ",
        ),
    );
    return;
  }
  if ((+loyalty) + (+abilityKey) < 1) {
    await message.reply(
      "You don't have enough loyalty for that ability (your loyalty can't go below 1).",
    );
    return;
  }
  const thisWeek = await getCurrentWeek();
  await ability.action(
    message.client,
    message.author.id,
    "pio" + ((thisWeek - 1) % 3 + 1),
    "PIO" + walkerForWeek({ week: thisWeek }).toUpperCase(),
  );
  await message.reply("OK, got it!");
  const cell = match.type === "match"
    ? "Matches!G" + match.matchRowNum + ":I" + match.matchRowNum
    : match.type === "entropy"
    ? "Entropy!J" + match.entropyRowNum + ":L" + match.entropyRowNum
    : match satisfies never;
  await sheetsWrite(
    sheets,
    CONFIG.LIVE_SHEET_ID,
    cell,
    [[
      walker + " " + abilityKey,
      "1",
      Number(abilityKey).toString(),
    ]],
  );
};

function walkerForWeek(week: { week: number }) {
  return (["Elspeth", "Jace", "Chandra"] as const)[week!.week % 3];
}

function isDM(m: djs.Message): m is djs.Message<false> {
  return !m.inGuild();
}

export let getBonusCards = () => {
  async function go() {
    const cards = await searchCards("s:PIO cn>278");
    return cards.map((
      { name, collector_number: cnum },
    ) => ({
      name,
      walker: +cnum >= 319 && +cnum <= 358
        ? "Jace"
        : +cnum >= 359 && +cnum <= 398
        ? "Chandra"
        : +cnum >= 279 && +cnum <= 318
        ? "Elspeth"
        : "???",
    }));
  }
  const promise = go();
  getBonusCards = () => promise;
  return promise;
};

export async function removeBonusCards(poolId: string, newWalker: string) {
  const pool = await fetchSealedDeck(poolId);
  const bonusCards = await getBonusCards();
  const result = Object.groupBy(
    [
      ...pool.sideboard,
      ...pool.deck,
      ...pool.hidden,
    ],
    (card) =>
      bonusCards.some((c) =>
          c.name.split(" //")[0] === card.name.split(" //")[0] &&
          c.walker !== newWalker
        )
        ? "remove"
        : "keep",
  );
  if ((result.remove?.length ?? 0) === 0) {
    return { keep: pool, remove: { poolId: undefined } };
  }
  return {
    keep: await fetchSealedDeck(
      await makeSealedDeck({ sideboard: result.keep }),
    ),
    remove: await fetchSealedDeck(
      await makeSealedDeck({ sideboard: result.remove }),
    ),
  };
}

export async function auditBonusCards(
  name: string,
  newWalker: string,
  pools?: Awaited<ReturnType<typeof getPools>>,
  matches?: Awaited<ReturnType<typeof getMatches>>,
  entropies?: Awaited<ReturnType<typeof getEntropy>>,
  poolChanges?: Awaited<ReturnType<typeof getPoolChanges>>,
) {
  pools ??= await getPools();
  matches ??= await getMatches();
  entropies ??= await getEntropy();
  const poolRow = pools.find((p) => p.name === name);
  if (!poolRow) throw new Error("No pool found for " + name);
  const expectedPool = await getExpectedPool(name, pools, poolChanges);
  if (expectedPool !== poolRow.currentPoolLink) {
    console.log(
      "Unexpected pool for " + name + ", fixing",
      "expected " + expectedPool,
      "got " + poolRow.currentPoolLink,
    );
    await sheetsWrite(
      sheets,
      CONFIG.LIVE_SHEET_ID,
      "Pools!G" + poolRow.rowNum,
      [[
        expectedPool,
      ]],
    );
  }
  const poolId = expectedPool.split(".tech/")[1];
  const currentPool = await fetchSealedDeck(poolId);
  const bonusCards = await getBonusCards();
  const currentBonusCards = [
    ...currentPool.sideboard ?? [],
    ...currentPool.deck ?? [],
    ...currentPool.hidden ?? [],
  ].filter((x) =>
    bonusCards.some((y) => y.name.split(" //")[0] === x.name.split(" //")[0])
  );
  const bonusCount = currentBonusCards.reduce(
    (a, b) => a + b.count,
    0,
  );
  const expectedBonusCount = 6 +
    [
      ...matches.filter((x) => x.loser === name).map((x) =>
        x.row[columnIndex("G", "A")]
      ),
      ...entropies.filter((x) => x.loser === name).map((x) =>
        x.row[columnIndex("J", "A")]
      ),
    ].map((x) =>
      ["Jace -7", "Jace -3", "Chandra -4", "Chandra -7", "Elspeth -7"].includes(
          x,
        )
        ? 2
        : 1
    ).reduce((a, b) => a + b, 0);
  return {
    discordId: poolRow.id,
    poolRowNum: poolRow.rowNum,
    poolId,
    expected: expectedBonusCount,
    actual: bonusCount,
    ok: expectedBonusCount === bonusCount,
    toReroll: currentBonusCards.filter((x) =>
      bonusCards.some((y) =>
        y.name.split(" //")[0] === x.name.split(" //")[0] &&
        y.walker !== newWalker
      )
    ).reduce((a, b) => a + b.count, 0),
  };
}

export async function rerollBonusCards(
  client: djs.Client,
  name: string,
  newWalker: string,
  pretend: boolean,
  newWeek: number,
  goIfNotOk: boolean,
) {
  if (pretend) console.log("Rerolling for " + name + " to " + newWalker);
  const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
  const channel = await guild.channels.fetch(
    pretend ? CONFIG.BOT_BUNKER_CHANNEL_ID : CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel;
  let id: string = "UNKNOWN";
  using _ = await lock();
  try {
    const { poolId, poolRowNum, discordId, expected, actual, ok, toReroll } =
      await auditBonusCards(name, newWalker);
    id = discordId;
    if (toReroll === 0) {
      if (pretend) console.log("Nothing to reroll for " + name);
      return;
    }
    if (!ok) {
      (await client.users.fetch(CONFIG.OWNER_ID)).send(
        `Current pool has wrong number of bonus sheet cards for <@${discordId}>; expected ${expected} but found ${actual}.${
          goIfNotOk ? " Rolling anyway." : ""
        }`,
      );
      if (!goIfNotOk) return;
    }
    console.log("Rerolling for " + name + " to " + newWalker);
    const { keep, remove } = await removeBonusCards(poolId, newWalker);
    if (remove.poolId) {
      if (pretend) console.log("recording for " + name);
      const num = remove.sideboard.reduce((a, b) => a + b.count, 0);
      if (num !== toReroll) {
        console.log("Weird discrepency for " + name, { num, toReroll });
      }
      const packResult = await rollPack(
        client,
        `!cube PIO${newWalker.toUpperCase()} ${num} <@${discordId}> - week ${newWeek} bonus sheet changes (replacing [these old card](https://sealeddeck.tech/${remove.poolId}))`,
      );
      if ("error" in packResult) {
        console.error("while rerolling", name, "got", packResult.error);
        return;
      }
      const pack = packResult.success;
      if (pretend) {
        console.log(
          "Would reroll by removing https://sealeddeck.tech/" + remove.poolId +
            ", leaving https://sealeddeck.tech/" + keep.poolId +
            ", and adding https://sealeddeck.tech/" + pack.poolId,
        );
      } else {
        await addPoolChanges([[
          name,
          "remove pack",
          remove.poolId,
          "Swap to week " + newWeek,
        ], [
          name,
          "add pack",
          pack.poolId,
          "Swap to week " + newWeek,
        ]]);
        const newPoolId = await makeSealedDeck(
          pack,
          keep.poolId,
        );
        const newPoolLink = "https://sealeddeck.tech/" + newPoolId;
        await sheetsWrite(
          sheets,
          CONFIG.LIVE_SHEET_ID,
          "Pools!G" + poolRowNum,
          [[
            newPoolLink,
          ]],
        );
        await channel.send(
          [
            `Week ${newWeek} changes for <@${discordId}>:`,
            "**OUT**",
            formatPool(remove),
            "**IN**",
            formatPool(pack),
          ].join("\n"),
        );
        const dmChannel = await client.users.fetch(discordId);
        dmChannel.send(
          [
            `Week ${newWeek} changes for <@${discordId}>:`,
            "**OUT**",
            formatPool(remove),
            "**IN**",
            formatPool(pack),
            `**NEW POOL**: ${newPoolLink}`,
          ].join("\n"),
        );
        await sheetsAppend(sheets, CONFIG.LIVE_SHEET_ID, "BotStuff!A:C", [[
          name,
          newWeek.toString(),
          new Date().toISOString(),
        ]]);
      }
    } else {
      console.warn(
        "Weird, " + name + " should have had " + toReroll + " to reroll.",
      );
    }
  } catch (e) {
    console.error(e);
    await channel.send(
      `Something broke when replacing bonus sheet cards for <@${id}>. CC <@${CONFIG.OWNER_ID}>`,
    );
  }
}

export async function addMissingStuff(client: djs.Client<true>) {
  const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel;
  let lastMessageId: string | undefined = undefined;
  let done = false;
  const goodMsgs = [];
  while (!done) {
    const options: djs.FetchMessagesOptions = {
      limit: 100,
      before: lastMessageId,
    };
    const messages = await channel.messages.fetch(options);
    lastMessageId = messages.last()?.id;
    goodMsgs.push(
      ...messages.filter((m) =>
        m.author.id == CONFIG.BOOSTER_TUTOR_USER_ID && m.attachments.size &&
        !m.embeds.some((e) =>
          e.fields.some((f) => f.name.toLowerCase().includes("sealed"))
        )
      ).values(),
    );
    if (messages.some((m) => m.id === "1324402595594502144")) done = true;
  }
  console.log(goodMsgs.map((x) => x.url));
}

export async function findMissingPacks(client: djs.Client<true>, cutoff: Date) {
  const guild = await client.guilds.fetch(CONFIG.AGL_GUILD_ID);
  const channel = await guild.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as djs.TextChannel;
  let lastMessageId: string | undefined = undefined;
  let done = false;
  const goodMsgs = [];
  while (!done) {
    const options: djs.FetchMessagesOptions = {
      limit: 100,
      before: lastMessageId,
    };
    const messages = await channel.messages.fetch(options);
    lastMessageId = messages.last()?.id;
    goodMsgs.push(
      ...messages.filter((m) =>
        m.createdAt >= cutoff && m.author.id == CONFIG.BOOSTER_TUTOR_USER_ID
      )
        .values(),
    );
    if (!messages.last() || messages.last()!.createdAt < cutoff) done = true;
  }
  const packs = new Map<string, { pool: SealedDeckPool; msg: djs.Message }>();
  for (const msg of goodMsgs) {
    console.log(".");
    const pool = await extractPool(msg);
    if (pool) packs.set(pool.poolId, { pool, msg });
  }
  const poolRows = await getPoolChanges();
  for (const { value: id } of poolRows.filter((x) => x.type === "add pack")) {
    if (packs.has(id)) packs.delete(id);
    else {
      const pool = await fetchSealedDeck(id);
      // find a pool with matching contents,
      for (const [id, { pool: pool2 }] of [...packs.entries()]) {
        if (isSamePool(pool, pool2)) {
          packs.delete(id);
          break;
        }
      }
    }
  }
  for (const [id, { msg }] of packs.entries()) {
    console.log(id + "," + msg.url);
  }
}

function isSamePool(a: SealedDeckPool, b: SealedDeckPool) {
  const aCards = [...a.sideboard ?? [], ...a.deck ?? [], ...a.hidden ?? []]
    .flatMap((c) => new Array(c.count).fill(c.name.split(" //")[0]));
  const bCards = [...b.sideboard ?? [], ...b.deck ?? [], ...b.hidden ?? []]
    .flatMap((c) => new Array(c.count).fill(c.name.split(" //")[0]));
  aCards.sort();
  bCards.sort();
  // TODO be less hacky maybe
  return JSON.stringify(aCards) === JSON.stringify(bCards);
}

export const matchCheckHandler: Handler<djs.Message> = async (
  message,
  handle,
) => {
  if (message.author.id !== CONFIG.PACKGEN_USER_ID) return;
  handle.release(); // fine if other things operate on this too
  await checkForMatches(message.client);
};

export const pioHandlers = [catchUpHandler, dmHandler, matchCheckHandler];

async function checkReroll(
  client: djs.Client,
  toReroll: Awaited<ReturnType<typeof getPlayers>>[number],
) {
  let weekOffset;
  if (isDoneForWeek(toReroll)) {
    weekOffset = 1;
  } else if (isInProgress(toReroll)) {
    weekOffset = 0;
    return; // for now let's just pick up people done with the week
  } else {
    // they're done/dead, do nothing
    return;
  }

  const week = await getCurrentWeek();
  const quotas = await getQuotas();
  // don't advance past the week if the numbers don't match (could happen if we fetch current week just after rollover)
  if (isDoneForWeek(toReroll) && !isActuallyDone(toReroll, quotas, week)) {
    return;
  }

  const walker = walkerForWeek({ week: week + weekOffset });

  console.log("Checking " + toReroll.name + " for week " + (week + weekOffset));
  await rerollBonusCards(
    client,
    toReroll.name,
    walker,
    false,
    week + weekOffset,
    false,
  );
}
