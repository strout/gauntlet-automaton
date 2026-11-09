import type { Client } from "discord.js";
import type { LeagueSheet } from "../../standings.ts";
import { trkSheet } from "./constants.ts";

/**
 * Stub. A registered player with no "starting pool" row would be rolled here.
 * It does not read the sheet or post a pool.
 */
export function fillTrkStartingPools(
  _client: Client,
  _sheet: LeagueSheet,
): Promise<void> {
  console.log("[trk] starting pools are not implemented");
  return Promise.resolve();
}

/** One-shot stand-in for the starting-pool poll. Does not roll pools. */
export async function watchTrkStartingPools(client: Client): Promise<void> {
  const sheet = trkSheet();
  if (!sheet) {
    console.log("[trk] No UPCOMING_SHEET_ID; starting-pool watch is idle.");
    return;
  }
  await fillTrkStartingPools(client, sheet);
}
