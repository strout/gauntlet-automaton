import { setup as setupFra } from "./fra/fra.ts";
import { setup as setupTrk } from "./trk/trk.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/**
 * Active leagues. Reality Fracture is live. TRK watches the upcoming sheet
 * and does not roll packs yet.
 */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  return combineSetups([await setupFra(), await setupTrk()]);
}
