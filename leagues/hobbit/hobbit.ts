import { liveSheet, upcomingSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";
import { watchHobbitMatches } from "./match-watch.ts";

/**
 * The Hobbit — upcoming live league stub.
 * Replace watch / handlers as pack and match rules are defined.
 */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "hobbit",
    sheet: upcomingSheet ?? liveSheet,
    watch: watchHobbitMatches,
    messageHandlers: [],
    interactionHandlers: [],
  });
}
