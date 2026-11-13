import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { watchTrkAssimilation } from "./assimilation.ts";
import { trkPlanetHandler } from "./comeback.ts";
import { trkSheet } from "./constants.ts";
import { watchTrkMatches } from "./match-watch.ts";
import { trekPoolHandler, trekTestPoolHandler } from "./pool-command.ts";

/** TRK background watches: match reports and assimilation checks. */
function watchTrk(client: Client): Promise<void> {
  return Promise.all([
    watchTrkMatches(client),
    watchTrkAssimilation(client),
  ]).then(() => undefined);
}

/**
 * TRK, the live league. A loss asks the player to station a planet only after
 * they have a valid Borg card, and the loss pack waits for that too. Odd
 * losses are an EOE pack from Booster Tutor. Even losses are a Trek pack. A
 * first loss with no valid Assimilation card prompts a DM.
 */
export function setup(): Promise<LeagueSetup> {
  const sheet = trkSheet();
  return Promise.resolve({
    name: "trk",
    sheet,
    announcer: getMatchAnnouncer(sheet, "trk"),
    watch: watchTrk,
    messageHandlers: [trekPoolHandler, trekTestPoolHandler],
    interactionHandlers: [trkPlanetHandler],
  });
}
