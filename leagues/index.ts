import { setup as setupNxt } from "./nxt-2026/nxt.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/** Active live league (NXT 2026). Hobbit is archived under `archive/leagues/hobbit/`. */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupNxt()]);
}
