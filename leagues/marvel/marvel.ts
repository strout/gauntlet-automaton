import { marvelComebackSelectHandler } from "./comeback-interaction.ts";
import { marvelMshPoolHandler } from "./msh-pool-command.ts";
import { marvelMshPoolSelectHandler } from "./msh-pool-interaction.ts";
import { watchMarvelMatches } from "./match-watch.ts";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { upcomingSheet } from "../../standings.ts";
import { LeagueSetup } from "../setup.ts";

/**
 * Marvel's Spider-Man (upcoming league) — comeback pack choice via DM.
 * Uses {@link upcomingSheet} (`UPCOMING_SHEET_ID` in config).
 */
export function setup(): Promise<LeagueSetup | null> {
  if (!upcomingSheet) {
    console.warn(
      "Marvel league not loaded: set UPCOMING_SHEET_ID in config.json",
    );
    return Promise.resolve(null);
  }

  return Promise.resolve({
    name: "marvel",
    sheet: upcomingSheet,
    announcer: getMatchAnnouncer(upcomingSheet, "marvel"),
    watch: watchMarvelMatches,
    messageHandlers: [marvelMshPoolHandler],
    interactionHandlers: [
      marvelComebackSelectHandler,
      marvelMshPoolSelectHandler,
    ],
  });
}
