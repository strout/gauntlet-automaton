import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { fraSheet } from "./constants.ts";
import { fracturePackHandler } from "./fracture-pack.ts";
import { jaceInteractionHandler, jaceResendHandler } from "./jace.ts";
import { watchFraMatches } from "./match-watch.ts";
import { fraPoolHandler } from "./pool-command.ts";
import { undoLossHandler, undoLossInteractionHandler } from "./undo-loss.ts";

/** Reality Fracture background watches: matches and entropy. */
async function watchFra(client: Client): Promise<void> {
  await watchFraMatches(client);
}

/** Reality Fracture (FRA) — live league, backed by the FRA league sheet. */
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
