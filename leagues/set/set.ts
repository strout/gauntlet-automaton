import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";
import { watchSetMatches } from "./match-watch.ts";

const announcer = getMatchAnnouncer(liveSheet, "set");

/** SET — currently live league (`!cube SET` loss packs + entropy). */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "set",
    sheet: liveSheet,
    announcer,
    watch: watchSetMatches,
    messageHandlers: [],
    interactionHandlers: [],
  });
}
