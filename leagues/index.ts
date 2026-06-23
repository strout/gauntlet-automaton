import { setup as setupMarvel } from "./marvel/marvel.ts";
import { CombinedLeagueSetup, combineSetups, LeagueSetup } from "./setup.ts";
import { setup as setupSet } from "./set/set.ts";

export type { CombinedLeagueSetup, LeagueSetup };
export { combineSetups, leagueByName } from "./setup.ts";

/** Active live league (SET) plus upcoming league prep (Marvel). */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  const setups: LeagueSetup[] = [await setupSet()];
  const marvel = await setupMarvel();
  if (marvel) setups.push(marvel);
  return combineSetups(setups);
}
