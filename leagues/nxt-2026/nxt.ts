import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { nxtSheet } from "./constants.ts";
import { watchNxtMatches } from "./match-watch.ts";
import { nxtPoolHandler } from "./pool-command.ts";
import {
  nxtUseClueTokenHandler,
  nxtUseMapTokenHandler,
} from "./token-command.ts";

const sheet = nxtSheet();
const announcer = getMatchAnnouncer(sheet, "nxt-2026");

/**
 * NXT 2026 — starting pools, win-tiered comeback packs, map/clue tokens.
 */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "nxt-2026",
    sheet,
    announcer,
    watch: watchNxtMatches,
    messageHandlers: [
      nxtPoolHandler,
      nxtUseMapTokenHandler,
      nxtUseClueTokenHandler,
    ],
    interactionHandlers: [],
  });
}
