import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { hobbitSheet } from "./constants.ts";
import { watchHobbitMatches } from "./match-watch.ts";
import { hobbitPoolHandler } from "./pool-command.ts";

const sheet = hobbitSheet();
const announcer = getMatchAnnouncer(sheet, "hobbit");

/**
 * The Hobbit — starting pools (`!hobpool`) and loss packs (`!cube HOBX`).
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
