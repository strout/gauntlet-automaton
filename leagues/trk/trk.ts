import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";
import { trkSheet } from "./constants.ts";
import { watchTrkMatches } from "./match-watch.ts";
import { watchTrkStartingPools } from "./starting-pool.ts";

/** TRK background watches: match reports, and the starting-pool stub. */
async function watchTrk(client: Client): Promise<void> {
  await Promise.all([
    watchTrkMatches(client),
    watchTrkStartingPools(client),
  ]);
}

/**
 * TRK. Match reports run against the upcoming sheet. Starting pools and
 * comeback packs are stubs.
 */
export function setup(): Promise<LeagueSetup> {
  const upcoming = trkSheet();
  const sheet = upcoming ?? liveSheet;
  return Promise.resolve({
    name: "trk",
    sheet,
    announcer: upcoming ? getMatchAnnouncer(upcoming, "trk") : undefined,
    watch: watchTrk,
    messageHandlers: [],
    interactionHandlers: [],
  });
}
