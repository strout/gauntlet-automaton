import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";
import { trkSheet } from "./constants.ts";
import { watchTrkMatches } from "./match-watch.ts";
import { trekPoolHandler, trekTestPoolHandler } from "./pool-command.ts";

/** TRK background watch: match reports on the upcoming sheet. */
function watchTrk(client: Client): Promise<void> {
  return watchTrkMatches(client);
}

/**
 * TRK. Match reports and `!trekpool` use the upcoming sheet. Comeback packs
 * are still a stub.
 */
export function setup(): Promise<LeagueSetup> {
  const upcoming = trkSheet();
  const sheet = upcoming ?? liveSheet;
  return Promise.resolve({
    name: "trk",
    sheet,
    announcer: upcoming ? getMatchAnnouncer(upcoming, "trk") : undefined,
    watch: watchTrk,
    messageHandlers: [trekPoolHandler, trekTestPoolHandler],
    interactionHandlers: [],
  });
}
