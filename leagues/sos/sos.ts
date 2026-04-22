import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../../dispatch.ts";
import {
  sosCourseTestMessageHandler,
  sosCourseTestSelectHandler,
} from "./course-test.ts";
import { watchSosComebackPacks } from "./loss-watch.ts";
import { sosStartingPoolHandler } from "./pools.ts";

/**
 * Secrets of Strixhaven (SOS) — league-specific Discord wiring.
 * Register handlers here as league rules and automations are implemented.
 */
export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: (client) => watchSosComebackPacks(client),
    messageHandlers: [sosStartingPoolHandler, sosCourseTestMessageHandler],
    interactionHandlers: [sosCourseTestSelectHandler],
  });
}
