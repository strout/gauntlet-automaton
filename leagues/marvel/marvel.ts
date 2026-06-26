import { marvelComebackSelectHandler } from "./comeback-interaction.ts";
import { marvelMshPoolHandler } from "./msh-pool-command.ts";
import { marvelMshPoolSelectHandler } from "./msh-pool-interaction.ts";
import { watchMarvelMatches } from "./match-watch.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { liveSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";

const announcer = getMatchAnnouncer(liveSheet, "marvel");

/** Marvel's Spider-Man — live league (comeback pack choice via DM). */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "marvel",
    sheet: liveSheet,
    announcer,
    watch: watchMarvelMatches,
    messageHandlers: [marvelMshPoolHandler],
    interactionHandlers: [
      marvelComebackSelectHandler,
      marvelMshPoolSelectHandler,
    ],
  });
}
