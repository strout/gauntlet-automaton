import { setup as setupFra } from "./fra/fra.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/** Active live league (Reality Fracture). NXT 2026 is archived under `archive/leagues/nxt-2026/`. */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupFra()]);
}
