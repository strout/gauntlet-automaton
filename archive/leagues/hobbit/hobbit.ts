import { getMatchAnnouncer } from "../../../match_announcer.ts";
import { LeagueSetup } from "../../../leagues/setup.ts";
import { hobbitSheet } from "./constants.ts";
import { watchHobbitMatches } from "./match-watch.ts";
import { hobbitPoolHandler } from "./pool-command.ts";

const sheet = hobbitSheet();
const announcer = getMatchAnnouncer(sheet, "hobbit");

/**
 * The Hobbit — archived league (starting pools + loss packs).
 */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "hobbit",
    sheet,
    announcer,
    watch: watchHobbitMatches,
    messageHandlers: [hobbitPoolHandler],
    interactionHandlers: [],
  });
}
