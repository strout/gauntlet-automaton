import { delay } from "@std/async";
import { Client } from "discord.js";
import { getMatchAnnouncer } from "../../match_announcer.ts";
import { nxtSheet } from "./constants.ts";

const POLL_MS = 30_000;

/**
 * Poll NXT matches once rules are implemented.
 * Hook entropy / pack generation here when ready.
 */
export async function watchNxtMatches(client: Client): Promise<never> {
  const sheet = nxtSheet();
  const announcer = getMatchAnnouncer(sheet, "nxt-2026");

  console.log("[nxt-2026] Match watch stub active — no handling yet.");
  while (true) {
    try {
      await announceNxtMatches(client, announcer);
    } catch (err) {
      console.error("[nxt-2026] match watch error:", err);
    }
    await delay(POLL_MS);
  }
}

/** Placeholder for unannounced match handling. */
export async function announceNxtMatches(
  _client: Client,
  _announcer: ReturnType<typeof getMatchAnnouncer>,
): Promise<void> {
  // TODO: validate matches, announce losses, generate packs.
}
