import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../../dispatch.ts";
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
    watch: () => Promise.resolve(),
    messageHandlers: [sosStartingPoolHandler],
    interactionHandlers: [],
  });
}
