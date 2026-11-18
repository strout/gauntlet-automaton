import { mirroredPackHandler } from "./mirrored-pack.ts";
import { setup as setupTrk } from "./trk/trk.ts";
import { CombinedLeagueSetup, combineSetups } from "./setup.ts";

export type { CombinedLeagueSetup, LeagueSetup } from "./setup.ts";
export { combineSetups, leagueByName } from "./setup.ts";

/** Active leagues. TRK is live. Reality Fracture is archived. */
export async function setupLeagues(): Promise<CombinedLeagueSetup> {
  const setup = combineSetups([await setupTrk()]);
  return {
    ...setup,
    messageHandlers: [...setup.messageHandlers, mirroredPackHandler],
  };
}
