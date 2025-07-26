import rawConfig from "./private/config.json" with { type: "json" };

export const CONFIG: Config = rawConfig;

export interface Config {
  readonly REGISTRATION_SHEET_ID: string;
  readonly REGISTRATION_SHEET_NAME: string;
  readonly BOOSTER_TUTOR_USER_ID: string;
  readonly PACKGEN_USER_ID: string;
  readonly OWNER_ID: string;
  readonly GUILD_ID: string;
  readonly PACKGEN_CHANNEL_ID: string;
  readonly STARTING_POOL_CHANNEL_ID: string;
  readonly GENERAL_CHAT_CHANNEL_ID: string;
  readonly BOT_BUNKER_CHANNEL_ID: string;
  readonly NEW_PLAYER_ROLE_ID: string;
  readonly ELIMINATED_ROLE_ID: string;
  readonly ELIMINATE: boolean;
  readonly LEAGUE_COMMITTEE_ROLE_ID: string;
  // TODO replace this with a record of sheet ids
  readonly LIVE_SHEET_ID: string;
  readonly LEAGUE_ROLES: readonly LeagueRole[];
  readonly BOT_ROLES: BotRole[];
  readonly REGISTRATION_LEAGUE_ROLE: LeagueRole | null;
  readonly NEW_PLAYER_LEAGUE_ROLES: readonly LeagueRole[];
}

export interface LeagueRole {
  readonly id: string;
  readonly name: string;
}

export interface BotRole {
  readonly id: string;
  readonly name: string;
}


