import { liveSheet, upcomingSheet } from "../standings.ts";
import { LeagueSetup } from "./setup.ts";

/** Minimal league setup for tests or placeholders. */
export function setup(): Promise<LeagueSetup> {
  return Promise.resolve({
    name: "stub",
    sheet: upcomingSheet ?? liveSheet,
    watch: () => Promise.resolve(),
    messageHandlers: [],
    interactionHandlers: [],
  });
}
