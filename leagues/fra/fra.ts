import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { fraSheet } from "./constants.ts";
import { watchFraRivals } from "./rival-watch.ts";

/**
 * Reality Fracture background watches (rivals now; matches later).
 */
async function watchFra(client: Client): Promise<void> {
  await watchFraRivals(client);
}

/**
 * Reality Fracture (FRA) — upcoming league.
 * Rival pairing uses the registration sheet; standings sheet is optional via
 * UPCOMING_SHEET_ID when match features are needed.
 */
export function setup(): Promise<LeagueSetup> {
  const sheet = fraSheet();
  const announcer = getMatchAnnouncer(sheet, "fra");
  return Promise.resolve({
    name: "fra",
    sheet,
    announcer,
    watch: watchFra,
    messageHandlers: [],
    interactionHandlers: [],
  });
}
