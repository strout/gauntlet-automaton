import type { TextChannel } from "discord.js";
import type { LeagueSheet } from "../../standings.ts";

/** A loss that should receive a comeback pack once rolling is implemented. */
export interface TrkComebackRequest {
  readonly channel: TextChannel;
  readonly sheet: LeagueSheet;
  readonly identification: string;
  readonly comment: string;
}

/**
 * Stub. Match reports call this for a loss that is not an elimination.
 * It does not roll or record a pack.
 */
export function grantTrkComebackPack(
  request: TrkComebackRequest,
): Promise<void> {
  console.log(
    `[trk] comeback pack stub for ${request.identification} (${request.comment}); not rolled`,
  );
  return Promise.resolve();
}
