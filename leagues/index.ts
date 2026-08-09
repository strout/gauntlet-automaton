import { setup as setupHobbit } from "./hobbit/hobbit.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/** Active live league (Hobbit stub). Marvel is archived under `archive/leagues/marvel/`. */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupHobbit()]);
}
