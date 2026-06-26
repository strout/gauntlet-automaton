import { delay } from "@std/async";
import { Client, TextChannel, User } from "discord.js";
import { CONFIG } from "../../config.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet, ROWNUM } from "../../standings.ts";
import {
  buildComebackMessage,
  DM_SENT_COLUMN,
  encodeOffersInNotes,
  hasOpenComebackForPlayer,
  isComebackAwaitingChoice,
  isComebackRowComplete,
  markRowDmSent,
  markRowPackChosen,
  marvelMatchBotColumns,
  MarvelMatchRow,
  mshAvailable,
  PACK_CHOSEN_COLUMN,
  rollComebackOffers,
} from "./comeback.ts";
import { buildComebackComponents } from "./comeback-interaction.ts";

const POLL_MS = 30_000;

/** Marvel live league — comeback DMs instead of default cube SET packs. */
export async function watchMarvelMatches(client: Client): Promise<never> {
  const announcer = getMatchAnnouncer(liveSheet, "marvel");

  while (true) {
    try {
      await processMarvelMatches(client, announcer);
    } catch (e) {
      console.error("[marvel] match watch error:", e);
    }
    await delay(POLL_MS);
  }
}

async function writeMatchColumn(
  announcer: ReturnType<typeof getMatchAnnouncer>,
  rowNum: number,
  columnIndex: number,
  value: string | boolean,
) {
  await announcer.markMatchHandled(rowNum, columnIndex, value);
}

async function processMarvelMatches(
  client: Client,
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  const sheet = announcer.sheet;

  console.log("[marvel] Checking for matches to handle…");

  const [players, quotas, matches, poolChanges] = await Promise.all([
    sheet.getPlayers(),
    sheet.getQuotas(),
    sheet.getAllMatches(undefined, undefined, undefined, marvelMatchBotColumns),
    sheet.getPoolChanges(),
  ]);

  const dmSentCol = matches.headerColumns.match[DM_SENT_COLUMN];
  const packChosenCol = matches.headerColumns.match[PACK_CHOSEN_COLUMN];
  const notesCol = matches.headerColumns.match["Notes"];

  if (dmSentCol === undefined || packChosenCol === undefined) {
    console.error(
      "[marvel] Matches sheet missing DM Sent or Pack Chosen columns",
    );
    return;
  }

  for (const raw of matches.rows) {
    if (raw.MATCHTYPE !== "match") continue;
    const match = raw as MarvelMatchRow;
    if (isComebackRowComplete(match)) continue;
    if (isComebackAwaitingChoice(match)) continue;

    const winnerName = match["Your Name"];
    const loserName = match["Loser Name"];
    const timestamp = match.Timestamp;
    const rowNum = match[ROWNUM];

    if (hasOpenComebackForPlayer(matches, loserName, rowNum)) {
      console.log(
        `[marvel] Skipping row ${rowNum} for ${loserName}: awaiting pack choice on another loss`,
      );
      continue;
    }

    const winnerInfo = players.rows.find((p) =>
      p.Identification === winnerName
    );
    const loserInfo = players.rows.find((p) => p.Identification === loserName);

    if (!winnerInfo || !loserInfo) {
      await writeMatchColumn(
        announcer,
        rowNum,
        packChosenCol,
        "Error: Missing Player Info",
      );
      markRowPackChosen(matches, rowNum, "Error: Missing Player Info");
      continue;
    }

    const loserId = loserInfo["Discord ID"];
    if (!loserId) {
      await writeMatchColumn(
        announcer,
        rowNum,
        packChosenCol,
        "Error: Missing Discord ID",
      );
      markRowPackChosen(matches, rowNum, "Error: Missing Discord ID");
      continue;
    }

    const currentQuota = quotas.find((q) =>
      q.fromDate <= timestamp && q.toDate >= timestamp
    );

    const alreadyPlayed = currentQuota
      ? matches.rows.some((m) => {
        if (m["ROWNUM"] === rowNum) return false;
        if (
          m.Timestamp < currentQuota.fromDate ||
          m.Timestamp > currentQuota.toDate
        ) return false;
        return (
          (m["Your Name"] === winnerName && m["Loser Name"] === loserName) ||
          (m["Your Name"] === loserName && m["Loser Name"] === winnerName)
        );
      })
      : false;

    if (alreadyPlayed) {
      await writeMatchColumn(
        announcer,
        rowNum,
        packChosenCol,
        "Rejected: Duplicate",
      );
      markRowPackChosen(matches, rowNum, "Rejected: Duplicate");
      continue;
    }

    if (loserInfo.Losses >= CONFIG.MAX_LOSSES) {
      const packGenChannel = await client.channels.fetch(
        CONFIG.PACKGEN_CHANNEL_ID,
      ) as TextChannel;
      if (packGenChannel) {
        await packGenChannel.send(
          `<@${loserId}> was eliminated by <@${winnerInfo["Discord ID"]}>.`,
        );
      }
      await writeMatchColumn(announcer, rowNum, packChosenCol, true);
      markRowPackChosen(matches, rowNum, true);
      continue;
    }

    const offeredMsh = mshAvailable(poolChanges, loserName);
    const offers = rollComebackOffers();
    const dmSent = await sendComebackDm(
      await client.users.fetch(loserId),
      rowNum,
      winnerName,
      offeredMsh,
      offers,
    );

    if (dmSent) {
      await writeMatchColumn(announcer, rowNum, dmSentCol, true);
      markRowDmSent(matches, rowNum);
      if (notesCol !== undefined) {
        await writeMatchColumn(
          announcer,
          rowNum,
          notesCol,
          encodeOffersInNotes(match.Notes, offers, offeredMsh),
        );
      }
    }
  }
}

async function sendComebackDm(
  user: User,
  matchRowNum: number,
  winnerName: string,
  mshOffered: boolean,
  offers: ReturnType<typeof rollComebackOffers>,
): Promise<boolean> {
  try {
    const dm = await user.createDM();
    await dm.send({
      content: buildComebackMessage(winnerName, mshOffered, offers),
      components: buildComebackComponents(matchRowNum, offers, mshOffered),
    });
    return true;
  } catch (e) {
    console.error(`[marvel] Failed to DM ${user.id}:`, e);
    return false;
  }
}
