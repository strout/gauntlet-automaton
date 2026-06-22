import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../../dispatch.ts";
import { LeagueSheet, liveSheet, upcomingSheet } from "../../standings.ts";

export function setup(): Promise<{
  liveSheet: LeagueSheet;
  upcomingSheet: LeagueSheet | undefined;
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}> {
  return Promise.resolve({
    liveSheet,
    upcomingSheet,
    watch: () => Promise.resolve(),
    messageHandlers: [],
    interactionHandlers: [],
  });
}
