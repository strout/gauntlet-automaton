import { CONFIG } from "./config.ts";
import { delay } from "@std/async";
import * as djs from "discord.js";
import { columnIndex, env, sheets, sheetsRead, sheetsWrite } from "./sheets.ts";
import { mutex } from "./mutex.ts";
import { getPlayers, parseTable, readTable, ROW, ROWNUM } from "./standings.ts";
import { z } from "zod";

type Role = { id: djs.Snowflake; name: string };

export const getRegistrationData = async () => {
  const table = await readTable(
    CONFIG.REGISTRATION_SHEET_NAME + "!A:M",
    1,
    CONFIG.REGISTRATION_SHEET_ID,
  );
  const registrations = parseTable({
    "Full Name": z.string(),
    'Arena Player ID# (e.g.: "Wins4Dayz#89045")': z.string(),
    "Discord ID": z.string().optional(),
  }, table);
  return {
    ...registrations,
    rows: registrations.rows.filter((r) =>
      r['Arena Player ID# (e.g.: "Wins4Dayz#89045")'].includes("#")
    ),
  };
};

const markRoleAdded = async (
  row: number,
  column: number,
  discordId: djs.Snowflake,
) => {
  await sheets.spreadsheetsValuesUpdate(
    `${CONFIG.REGISTRATION_SHEET_NAME}!R${row}C${column}`,
    CONFIG.REGISTRATION_SHEET_ID,
    { values: [[discordId]] },
    { valueInputOption: "RAW" },
  );
  console.log(`Marked R${row}C${column}`);
};

const SURVEY_COLUMN = "C";
const getPlayerStatuses = async () => {
  if (
    !CONFIG.ELIMINATED_ROLE_ID || !CONFIG.LIVE_SHEET_ID || !CONFIG.ELIMINATE
  ) return null;
  return await getPlayers();
};

async function addRole(member: djs.GuildMember, roleId: djs.Snowflake) {
  return await member.roles.add(roleId);
}

async function removeRole(member: djs.GuildMember, roleId: djs.Snowflake) {
  return await member.roles.remove(roleId);
}

const assignLeagueRole = async (
  members: djs.Collection<djs.Snowflake, djs.GuildMember>,
  role: Role | null,
  pretend: boolean,
) => {
  if (role === null) return;
  const sheetData = await getRegistrationData();
  const matches = sheetData.rows.map((s) => {
    const matcher = {
      name: s["Full Name"],
      arenaId: s['Arena Player ID# (e.g.: "Wins4Dayz#89045")'],
      discordId: s["Discord ID"],
    };
    const m = bestMatch_djs(matcher, members);
    return {
      rowNum: s[ROWNUM],
      for: matcher,
      match: m &&
        {
          name: m.displayName,
          id: m.id,
          hasRole: m.roles.cache.has(role.id),
        },
    };
  });
  const extraRoles = members.filter((m: djs.GuildMember) =>
    !m.user.bot &&
    m.roles.cache.has(role.id) &&
    !matches.some((ma) => ma.match?.name === m.displayName)
  );

  const summary = {
    entries: sheetData.rows.length,
    members: members.size,
    complete: matches.filter((m) => m.match && m.match.hasRole).length,
    manuallyMatched: matches.filter((m) => !m.match && m.for.discordId).length,
    unmatchable: matches.filter((m) => !m.match && !m.for.discordId).map((m) =>
      m.for.name
    ),
    todo: matches.filter((m) => m.match && !m.match.hasRole).map((m) =>
      m.for.name
    ),
    extras: extraRoles.map((e) => e.displayName),
  };

  if (
    summary.unmatchable.length || summary.todo.length || summary.extras.length
  ) {
    console.log(JSON.stringify(summary));
  }

  // TODO less ugly type here?
  const toAdd = matches.filter((
    m: typeof matches[number],
  ): m is Omit<typeof m, "match"> & Required<Pick<typeof m, "match">> =>
    !!m.match && !m.match.hasRole
  );
  if (toAdd.length) {
    console.log("Adding league role to:");
    console.table(
      toAdd.map((m) => ({
        name: m.for.name,
        arenaId: m.for.arenaId,
        discordName: m.match?.name,
      })),
    );
  }

  for (const m of toAdd) {
    console.log("Adding role", m.for, m.match, role.id);
    if (!pretend) {
      await addRole(members.get(m.match!.id)!, role.id);
    }
    console.log("Added role", m, role.id);

    if (!pretend) {
      await markRoleAdded(
        m.rowNum,
        sheetData.headerColumns["Discord ID"] + 1,
        m.match!.id,
      );
    }
    console.log("Recorded on sheet", m);
  }

  for (const m of matches.filter((m) => m.match?.hasRole && !m.for.discordId)) {
    if (!pretend) {
      await markRoleAdded(
        m.rowNum,
        sheetData.headerColumns["Discord ID"] + 1,
        m.match!.id,
      );
    }
    console.log("Recorded pre-matched one", m);
  }
};

const assignNewPlayerRole = async (
  members: djs.Collection<djs.Snowflake, djs.GuildMember>,
  pretend: boolean,
) => {
  const shouldHaveNewPlayerRole = (m: djs.GuildMember) =>
    ![...m.roles.cache.keys()].some((r) =>
      CONFIG.BOT_ROLES.some((br) => br.id === r)
    ) && // not a bot
    ![...m.roles.cache.keys()].some((r) =>
      CONFIG.LEAGUE_ROLES.some((lr) => lr.id === r) &&
      !CONFIG.NEW_PLAYER_LEAGUE_ROLES.some((nlr) => nlr.id == r)
    ); // not in a previous league
  const ms = [...members.values()].sort((a, z) =>
    (a.joinedTimestamp ?? 0) - (z.joinedTimestamp ?? 0)
  );
  const old_roled_members = ms.filter((m) =>
    !shouldHaveNewPlayerRole(m) &&
    m.roles.cache.has(CONFIG.NEW_PLAYER_ROLE_ID)
  );
  const new_unroled_members = ms.filter((m) =>
    shouldHaveNewPlayerRole(m) &&
    !m.roles.cache.has(CONFIG.NEW_PLAYER_ROLE_ID)
  );

  if (old_roled_members.length) {
    console.log("Removing New Player role from:");
    console.table(
      old_roled_members.map((m) => ({
        name: m.displayName,
        leagues: [...m.roles.cache.keys()].map((r) =>
          CONFIG.LEAGUE_ROLES.find((lr) => lr.id === r)?.name
        ).filter((rn) => rn),
      })),
    );
    for (const m of old_roled_members) {
      if (!pretend) await removeRole(m, CONFIG.NEW_PLAYER_ROLE_ID);
      console.log("Removed New Player role from " + m.displayName);
      await delay(250); // TODO be smarter about rate limit maybe?
    }
  }

  if (new_unroled_members.length) {
    console.log("Adding New Player role to:");
    console.table(
      new_unroled_members.map((m) => ({
        name: m.displayName,
        joinedAt: m.joinedAt,
        roles: [...m.roles.cache.values()].map((r) => r.name),
      })),
    );
    for (const m of new_unroled_members) {
      if (!pretend) await addRole(m, CONFIG.NEW_PLAYER_ROLE_ID);
      console.log("Added New Player role to " + m.displayName);
      await delay(250); // TODO be smarter about rate limit maybe?
    }
  }
};

const bestMatch_djs = (
  row: { name: string; arenaId: string },
  members: djs.Collection<djs.Snowflake, djs.GuildMember>,
): djs.GuildMember | undefined => {
  // For now just look for arena id inside their nick; maybe later do a fuzzy match (close levenstein distance?)
  const allMatches = [...members.values()].filter((m) =>
    row.arenaId && row.arenaId.includes("#") &&
    !!m.displayName.toUpperCase().includes(row.arenaId.toUpperCase())
  );
  if (allMatches.length > 1) {
    console.warn(
      "Duplicate matches",
      JSON.stringify({
        for: row,
        matches: allMatches.map((m) => m.displayName),
      }),
    );
  }
  return allMatches[0];
};

const surveySendDate: Record<djs.Snowflake, { toSurveyDate: Date }> = {};

const SENDING_SURVEY = false;

const eliminationLock = mutex();
const assignEliminatedRole = async (
  members: djs.Collection<djs.Snowflake, djs.GuildMember>,
  client: djs.Client<true>,
  pretend: boolean,
) => {
  using _ = await eliminationLock();
  try {
    const players = await getPlayerStatuses();
    // TODO flag players to be messaged.
    const eliminatedPlayers = players?.rows.filter((x) =>
      x["TOURNAMENT STATUS"] === "Eliminated"
    );
    for (
      const { "Discord ID": id, Identification: name } of eliminatedPlayers ??
        []
    ) {
      const member = members.get(id);
      if (member?.roles.cache.has(CONFIG.ELIMINATED_ROLE_ID) === false) {
        console.log("Eliminating " + name);
        if (!pretend) await addRole(member, CONFIG.ELIMINATED_ROLE_ID);
        await delay(250); // TODO be smarter about rate limit maybe?
      }
    }
    const eliminatedIds = new Set<string>(
      eliminatedPlayers?.map((x) => x["Discord ID"]),
    );
    for (const [id, member] of members.entries()) {
      if (
        member.roles.cache.has(CONFIG.ELIMINATED_ROLE_ID) &&
        !eliminatedIds.has(id)
      ) {
        console.log("Un-eliminating " + member.displayName);
        if (!pretend) await removeRole(member, CONFIG.ELIMINATED_ROLE_ID);
        await delay(250);
      }
    }
    const surveyablePlayers = players?.rows.filter((x) =>
      SENDING_SURVEY &&
      !x["Survey Sent"] &&
      (x["Matches played"] == 30 || x["TOURNAMENT STATUS"] === "Eliminated") // TODO change matchesPlayed back after short league is done
    ) ?? [];
    let anySent = false;
    if (CONFIG.LIVE_SHEET_ID) {
      for (const player of surveyablePlayers) {
        const { toSurveyDate } = surveySendDate[player["Discord ID"]] ??
          [null];
        if (!anySent && toSurveyDate && toSurveyDate < new Date()) {
          console.log("would survey " + player.Identification);
          console.log(
            "Player Database!R" + player[ROWNUM] + "C" +
              (players!.headerColumns["Survey Sent"] + 1),
          );
          // TODO covnert to a log entry; not that we'd have late joiners after surveys are being sent but still...
          await sheetsWrite(
            sheets,
            CONFIG.LIVE_SHEET_ID,
            "BotStuff!" + SURVEY_COLUMN + player[ROWNUM],
            [[true]],
          );
          await sendSurvey(client, player);
          anySent = true;
        } else if (!toSurveyDate) {
          console.log("Will survey " + player.Identification);
          const toSurveyDate = new Date();
          toSurveyDate.setMinutes(toSurveyDate.getMinutes() + 1);
          surveySendDate[player["Discord ID"]] = { toSurveyDate };
          // TODO covnert to a log entry; not that we'd have late joiners after surveys are being sent but still...
          await sheetsWrite(
            sheets,
            CONFIG.LIVE_SHEET_ID,
            "BotStuff!" + SURVEY_COLUMN + player[ROWNUM],
            [[false]],
          );
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
};

async function sendSurvey(
  client: djs.Client<true>,
  player:
    (Awaited<ReturnType<typeof getPlayerStatuses>> & object)["rows"][number],
) {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  try {
    const member = await guild.members.fetch(player["Discord ID"]);
    member.send(
      `Thank you for playing in Spider-Man: Through the Omenpaths League! We hope you had fun!

Let us know how we did and what we can improve by filling in the [Spider-Man: Through the Omenpaths League Survey](https://docs.google.com/forms/d/e/1FAIpQLSehcFBSYpqEp19KW-aAxL0G-rc6FyzK8kPsmYqs_52lUTkNzQ/viewform).

Join us soon for Avatar: The Last Airbender League!`,
    );
  } catch (e) {
    console.warn("Failed to survey", player["Identification"], e);
  }
}

export async function manageRoles(
  client: djs.Client<true>,
  pretend: boolean,
  once: boolean,
) {
  while (true) {
    const guilds = await client.guilds.fetch();
    for (const guildId of guilds.keys()) {
      if (guildId === CONFIG.GUILD_ID) {
        try {
          const guild = await client.guilds.fetch(guildId);
          const members = await guild.members.fetch({ limit: 1000 });
          await assignLeagueRole(
            members,
            CONFIG.REGISTRATION_LEAGUE_ROLE,
            pretend,
          );
          await assignNewPlayerRole(members, pretend);
          await assignEliminatedRole(members, client, pretend);
        } catch (e) {
          console.error(e);
        }
      }
    }
    if (once) {
      console.log([
        once,
        client.rest.globalRemaining,
        client.rest.globalReset,
        Date.now(),
      ]);
      console.log("Exiting.");
      Deno.exit();
    }
    await delay(1 * 60_000);
  }
}

export async function handleGuildMemberAdd(
  member: djs.GuildMember,
  pretend: boolean,
) {
  console.log(`Hello ${member.displayName}`);
  if (!pretend && member.guild.id === CONFIG.GUILD_ID) {
    await addRole(member, CONFIG.NEW_PLAYER_ROLE_ID);
  }
}
