import { delay } from "@std/async";
import { Client, TextChannel, User } from "discord.js";
import { CONFIG } from "../../config.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet, ROWNUM } from "../../standings.ts";
import {
  buildComebackMessage,
  ComebackOffers,
  DM_SENT_COLUMN,
  encodePacksOffered,
  hasOpenComebackForPlayer,
  isComebackAwaitingChoice,
  isComebackRowComplete,
  markRowDmSent,
  markRowMatchAnnounced,
  markRowPackChosen,
  marvelMatchBotColumns,
  MarvelMatchRow,
  MATCH_ANNOUNCED_COLUMN,
  mshAvailable,
  PACK_CHOSEN_COLUMN,
  PACKS_OFFERED_COLUMN,
  parsePacksOffered,
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

interface MatchHandlingContext {
  readonly match: MarvelMatchRow;
  readonly rowNum: number;
  readonly winnerMention: string;
  readonly loserMention: string;
  readonly loserId: string;
  readonly winnerName: string;
  readonly loserName: string;
  readonly winnerStreak?: number;
  readonly winnerMatchesPlayed: number;
  readonly loserMatchesPlayed: number;
  readonly eliminated: boolean;
  readonly currentQuota?: { readonly matchesMax: number };
}

type MatchSheetContext = Awaited<
  ReturnType<typeof loadMatchSheetContext>
>;

async function loadMatchSheetContext(
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  const sheet = announcer.sheet;
  const [players, quotas, matches, poolChanges] = await Promise.all([
    sheet.getPlayers(),
    sheet.getQuotas(),
    sheet.getAllMatches(undefined, undefined, undefined, marvelMatchBotColumns),
    sheet.getPoolChanges(),
  ]);

  const matchAnnouncedCol = matches.headerColumns.match[MATCH_ANNOUNCED_COLUMN];
  const dmSentCol = matches.headerColumns.match[DM_SENT_COLUMN];
  const packChosenCol = matches.headerColumns.match[PACK_CHOSEN_COLUMN];
  const packsOfferedCol = matches.headerColumns.match[PACKS_OFFERED_COLUMN];

  if (
    matchAnnouncedCol === undefined || dmSentCol === undefined ||
    packChosenCol === undefined || packsOfferedCol === undefined
  ) {
    throw new Error(
      "Matches sheet missing Match Announced, DM Sent, Pack Chosen, or Packs Offered columns",
    );
  }

  return {
    announcer,
    players,
    quotas,
    matches,
    poolChanges,
    matchAnnouncedCol,
    dmSentCol,
    packChosenCol,
    packsOfferedCol,
  };
}

function isDuplicateMatch(
  matches: MatchSheetContext["matches"],
  rowNum: number,
  winnerName: string,
  loserName: string,
  currentQuota: MatchSheetContext["quotas"][number] | undefined,
): boolean {
  if (!currentQuota) return false;
  return matches.rows.some((m) => {
    if (m["ROWNUM"] >= rowNum) return false;
    if (
      m.Timestamp < currentQuota.fromDate ||
      m.Timestamp > currentQuota.toDate
    ) return false;
    return (
      (m["Your Name"] === winnerName && m["Loser Name"] === loserName) ||
      (m["Your Name"] === loserName && m["Loser Name"] === winnerName)
    );
  });
}

async function resolveMatchHandlingContext(
  ctx: MatchSheetContext,
  match: MarvelMatchRow,
): Promise<MatchHandlingContext | undefined> {
  const winnerName = match["Your Name"];
  const loserName = match["Loser Name"];
  const rowNum = match[ROWNUM];

  const winnerInfo = ctx.players.rows.find((p) =>
    p.Identification === winnerName
  );
  const loserInfo = ctx.players.rows.find((p) =>
    p.Identification === loserName
  );

  if (!winnerInfo || !loserInfo) {
    await writeMatchColumn(
      ctx.announcer,
      rowNum,
      ctx.packChosenCol,
      "Error: Missing Player Info",
    );
    markRowPackChosen(ctx.matches, rowNum, "Error: Missing Player Info");
    return undefined;
  }

  const winnerId = winnerInfo["Discord ID"];
  const loserId = loserInfo["Discord ID"];
  if (!winnerId || !loserId) {
    await writeMatchColumn(
      ctx.announcer,
      rowNum,
      ctx.packChosenCol,
      "Error: Missing Discord ID",
    );
    markRowPackChosen(ctx.matches, rowNum, "Error: Missing Discord ID");
    return undefined;
  }

  const currentQuota = ctx.quotas.find((q) =>
    q.fromDate <= match.Timestamp && q.toDate >= match.Timestamp
  );

  if (
    isDuplicateMatch(
      ctx.matches,
      rowNum,
      winnerName,
      loserName,
      currentQuota,
    )
  ) {
    await writeMatchColumn(
      ctx.announcer,
      rowNum,
      ctx.packChosenCol,
      "Rejected: Duplicate",
    );
    markRowPackChosen(ctx.matches, rowNum, "Rejected: Duplicate");
    return undefined;
  }

  return {
    match,
    rowNum,
    winnerMention: `<@${winnerId}>`,
    loserMention: `<@${loserId}>`,
    loserId,
    winnerName,
    loserName,
    winnerStreak: winnerInfo.Streak,
    winnerMatchesPlayed: winnerInfo.Wins + winnerInfo.Losses,
    loserMatchesPlayed: loserInfo.Wins + loserInfo.Losses,
    eliminated: loserInfo.Losses >= CONFIG.MAX_LOSSES,
    currentQuota,
  };
}

async function announcePendingMatches(
  ctx: MatchSheetContext,
  packGenChannel: TextChannel | null,
) {
  for (const raw of ctx.matches.rows) {
    if (raw.MATCHTYPE !== "match") continue;
    const match = raw as MarvelMatchRow;
    if (match[MATCH_ANNOUNCED_COLUMN]) continue;

    const handling = await resolveMatchHandlingContext(ctx, match);
    if (!handling) continue;

    if (packGenChannel) {
      await packGenChannel.send(
        buildMarvelMatchAnnouncement({
          loserMention: handling.loserMention,
          winnerMention: handling.winnerMention,
          result: match.Result ?? "",
          note: match.Notes,
          eliminated: handling.eliminated,
          winnerStreak: handling.winnerStreak,
          winnerMatchesPlayed: handling.winnerMatchesPlayed,
          loserMatchesPlayed: handling.loserMatchesPlayed,
          currentQuota: handling.currentQuota,
        }),
      );
    }

    await writeMatchColumn(
      ctx.announcer,
      handling.rowNum,
      ctx.matchAnnouncedCol,
      true,
    );
    markRowMatchAnnounced(ctx.matches, handling.rowNum);
  }
}

async function processComebackFlow(
  client: Client,
  ctx: MatchSheetContext,
) {
  for (const raw of ctx.matches.rows) {
    if (raw.MATCHTYPE !== "match") continue;
    const match = raw as MarvelMatchRow;
    if (isComebackRowComplete(match)) continue;
    if (isComebackAwaitingChoice(match)) continue;
    if (!match[MATCH_ANNOUNCED_COLUMN]) continue;

    const handling = await resolveMatchHandlingContext(ctx, match);
    if (!handling) continue;

    if (handling.eliminated) {
      await writeMatchColumn(
        ctx.announcer,
        handling.rowNum,
        ctx.packChosenCol,
        true,
      );
      markRowPackChosen(ctx.matches, handling.rowNum, true);
      continue;
    }

    if (
      hasOpenComebackForPlayer(
        ctx.matches,
        handling.loserName,
        handling.rowNum,
      )
    ) {
      console.log(
        `[marvel] Deferring row ${handling.rowNum} for ${handling.loserName}: awaiting pack choice on another loss`,
      );
      continue;
    }

    if (match[DM_SENT_COLUMN]) continue;

    const storedOffers = parsePacksOffered(match[PACKS_OFFERED_COLUMN]);
    const offeredMsh = storedOffers?.mshOffered ??
      mshAvailable(ctx.poolChanges, handling.loserName);
    const offers = storedOffers?.offers ?? rollComebackOffers();

    if (!storedOffers) {
      await writeMatchColumn(
        ctx.announcer,
        handling.rowNum,
        ctx.packsOfferedCol,
        encodePacksOffered(offers, offeredMsh),
      );
    }

    const dmSent = await sendComebackDm(
      await client.users.fetch(handling.loserId),
      handling.rowNum,
      handling.winnerName,
      offeredMsh,
      offers,
    );

    if (dmSent) {
      await writeMatchColumn(
        ctx.announcer,
        handling.rowNum,
        ctx.dmSentCol,
        true,
      );
      markRowDmSent(ctx.matches, handling.rowNum);
    }
  }
}

async function processMarvelMatches(
  client: Client,
  announcer: ReturnType<typeof getMatchAnnouncer>,
) {
  console.log("[marvel] Checking for matches to handle…");

  let ctx: MatchSheetContext;
  try {
    ctx = await loadMatchSheetContext(announcer);
  } catch (e) {
    console.error("[marvel]", e);
    return;
  }

  const packGenChannel = await client.channels.fetch(
    CONFIG.PACKGEN_CHANNEL_ID,
  ) as TextChannel;

  await announcePendingMatches(ctx, packGenChannel ?? null);
  await processComebackFlow(client, ctx);
}

interface MarvelMatchAnnouncementInput {
  readonly loserMention: string;
  readonly winnerMention: string;
  readonly result: string;
  readonly note?: string;
  readonly eliminated: boolean;
  readonly winnerStreak?: number;
  readonly winnerMatchesPlayed: number;
  readonly loserMatchesPlayed: number;
  readonly currentQuota?: { readonly matchesMax: number };
}

function buildMarvelMatchAnnouncement(
  input: MarvelMatchAnnouncementInput,
): string {
  const {
    loserMention,
    winnerMention,
    result,
    note,
    eliminated,
    winnerStreak,
    winnerMatchesPlayed,
    loserMatchesPlayed,
    currentQuota,
  } = input;

  let message = eliminated
    ? `${loserMention} was eliminated by ${winnerMention}.`
    : `${loserMention} was defeated ${result} by ${winnerMention}.`;

  if (note) {
    message += `\n> ${escapeMarkdown(note)}`;
  }

  if ((winnerStreak ?? 0) >= 5) {
    message += `\n${winnerMention} is on a ${winnerStreak} win streak!`;
  }

  if (currentQuota && winnerMatchesPlayed >= currentQuota.matchesMax) {
    message += `\n${winnerMention} is done for the week.`;
  }
  if (currentQuota && loserMatchesPlayed >= currentQuota.matchesMax) {
    message += `\n${loserMention} is done for the week.`;
  }

  return message;
}

function escapeMarkdown(str: string): string {
  return str.replace(
    /([^a-zA-Z0-9 ])/g,
    (x) => (x.charCodeAt(0) > 127 ? x : "\\" + x),
  );
}

async function sendComebackDm(
  user: User,
  matchRowNum: number,
  winnerName: string,
  mshOffered: boolean,
  offers: ComebackOffers,
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
