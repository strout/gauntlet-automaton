import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../dispatch.ts";

/**
 * ECL (Lorwyn Eclipsed) League Setup
 */
export function setup(): Promise<{
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    watch: () => Promise.resolve(),
    messageHandlers: [],
    interactionHandlers: [],
  });
}
