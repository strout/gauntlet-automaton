import * as djs from "discord.js";
import { CONFIG } from "../../config.ts";

export async function isLeagueCommittee(
  client: djs.Client,
  userId: string,
): Promise<boolean> {
  try {
    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    const member = await guild.members.fetch(userId);
    return member.roles.cache.has(CONFIG.LEAGUE_COMMITTEE_ROLE_ID);
  } catch {
    return false;
  }
}

/** Accepts `<@id>`, `<@!id>`, or a bare snowflake. */
export function resolveDiscordId(input: string): string | null {
  const mention = input.match(/^<@!?(\d+)>$/);
  if (mention) return mention[1];
  if (/^\d+$/.test(input)) return input;
  return null;
}
