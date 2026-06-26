import { setup as setupMarvel } from "./marvel/marvel.ts";
import { CombinedLeagueSetup, combineSetups, LeagueSetup } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup };
export { combineSetups, leagueByName } from "./setup.ts";

export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  const setups: LeagueSetup[] = [];
  const marvel = await setupMarvel();
  if (marvel) setups.push(marvel);
  return combineSetups(setups);
}
