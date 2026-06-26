import { setup as setupMarvel } from "./marvel/marvel.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/** Active live league (Marvel). SET is archived under `archive/leagues/set/`. */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupMarvel()]);
}
