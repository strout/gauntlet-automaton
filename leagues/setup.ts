import { Client, Interaction, Message } from "discord.js";
import { Handler } from "../dispatch.ts";
import { MatchAnnouncer } from "../match_announcer.ts";
import { LeagueSheet } from "../standings.ts";

export interface LeagueSetup {
  readonly name: string;
  readonly sheet: LeagueSheet;
  /** Match row writes for this league's sheet. */
  readonly announcer?: MatchAnnouncer;
  /** Background polling (match handling, entropy, etc.). */
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}

export interface CombinedLeagueSetup {
  readonly leagues: LeagueSetup[];
  watch: (client: Client) => Promise<void>;
  messageHandlers: Handler<Message>[];
  interactionHandlers: Handler<Interaction>[];
}

export function combineSetups(setups: LeagueSetup[]): CombinedLeagueSetup {
  return {
    leagues: setups,
    watch: async (client) => {
      await Promise.all(setups.map((s) => s.watch(client)));
    },
    messageHandlers: setups.flatMap((s) => s.messageHandlers),
    interactionHandlers: setups.flatMap((s) => s.interactionHandlers),
  };
}

/** Resolves a league by name from a combined setup. */
export function leagueByName(
  combined: CombinedLeagueSetup,
  name: string,
): LeagueSetup | undefined {
  return combined.leagues.find((l) => l.name === name);
}
