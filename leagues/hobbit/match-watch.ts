import { delay } from "@std/async";
import { Client } from "discord.js";

const POLL_MS = 30_000;

/** Poll Hobbit matches once rules are implemented. */
export async function watchHobbitMatches(_client: Client): Promise<never> {
  console.log("[hobbit] Match watch stub active — no handling yet.");
  while (true) {
    await delay(POLL_MS);
  }
}
