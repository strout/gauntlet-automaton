import { setup as setupFra } from "./fra/fra.ts";
import { setup as setupNxt } from "./nxt-2026/nxt.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/**
 * Live: NXT 2026. Upcoming: Reality Fracture (fra) — rival watch uses
 * registration; set UPCOMING_SHEET_ID when FRA standings are ready.
 */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupNxt(), await setupFra()]);
}
