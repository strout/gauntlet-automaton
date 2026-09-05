import { getMatchAnnouncer } from "../../match_announcer.ts";
import { LeagueSetup } from "../setup.ts";
import { nxtSheet } from "./constants.ts";
import { watchNxtMatches } from "./match-watch.ts";

const sheet = nxtSheet();
const announcer = getMatchAnnouncer(sheet, "nxt-2026");

/**
 * NXT 2026 — live league scaffolding.
 * Add message / interaction handlers as rules are defined.
 */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "nxt-2026",
    sheet,
    announcer,
    watch: watchNxtMatches,
    messageHandlers: [],
    interactionHandlers: [],
  });
}
