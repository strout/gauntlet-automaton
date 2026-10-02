import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { fraSheet } from "./constants.ts";
import { fracturePackHandler } from "./fracture-pack.ts";
import { jaceInteractionHandler, jaceResendHandler } from "./jace.ts";
import { watchFraMatches } from "./match-watch.ts";
import { fraPoolHandler } from "./pool-command.ts";
import { watchFraRivals } from "./rival-watch.ts";
import { undoLossHandler, undoLossInteractionHandler } from "./undo-loss.ts";

/** Reality Fracture background watches: rival pairings, matches, entropy. */
async function watchFra(client: Client): Promise<void> {
  await Promise.all([watchFraRivals(client), watchFraMatches(client)]);
}

/**
 * Reality Fracture (FRA) — live league. Rival announcements use the
 * registration sheet; everything else uses the FRA league sheet.
 */
export function setup(): Promise<LeagueSetup> {
  const sheet = fraSheet();
  const announcer = getMatchAnnouncer(sheet, "fra");
  return Promise.resolve({
    name: "fra",
    sheet,
    announcer,
    watch: watchFra,
    messageHandlers: [
      fraPoolHandler,
      fracturePackHandler,
      jaceResendHandler,
      undoLossHandler,
    ],
    interactionHandlers: [jaceInteractionHandler, undoLossInteractionHandler],
  });
}
