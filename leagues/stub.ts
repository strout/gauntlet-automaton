import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../dispatch.ts";

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
