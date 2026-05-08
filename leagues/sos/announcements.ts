import { WebhookClient } from "discord.js";
import {
  getMatches,
  getPlayers,
  getQuotas,
  ROWNUM,
  type Player,
} from "../../standings.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { CONFIG } from "../../config.ts";

const MAX_LOSSES = 11;

const COLLEGE_EMOJIS: Record<string, string> = {
  Prismari: "<:Prismari:826437623269556234>",
  Silverquill: "<:Silverquill:826437813121450005>",
  Quandrix: "<:Quandrix:826439903939264512>",
  Lorehold: "<:Lorehold:826437744489267223>",
  Witherbloom: "<:Witherbloom:826438882182692884>",
};

const webhook = new WebhookClient({ url: CONFIG.PACKGEN_WEBHOOK_URL });

function getCollegeEmote(player: Player): string {
  const college = player.College?.trim();
  if (!college) return "";
  return COLLEGE_EMOJIS[college] ?? "";
}

function escapeMarkdown(str: string): string {
  return str.replace(/([^a-zA-Z0-9 ])/g, (x) => (x.charCodeAt(0) > 127 ? x : `\\${x}`));
}

export async function checkSosAnnouncements(): Promise<void> {
  const { rows: matches } = await getMatches();
  const { rows: players } = await getPlayers();
  const quotas = await getQuotas();
  const currentQuota = quotas[quotas.length - 1]; // Simplified for now, should match GAS logic

  for (const match of matches) {
    if (!match["Script Handled"] || match["Announcement Sent"]) continue;

    const winnerName = match["Your Name"];
    const loserName = match["Loser Name"];
    const note = match["Notes"];
    const result = match["Result"];

    const winnerInfo = players.find((p) => p.Identification === winnerName);
    const loserInfo = players.find((p) => p.Identification === loserName);

    if (!winnerInfo || !loserInfo) {
      console.error(`[SOS announcement] Missing player info for match: ${winnerName} vs ${loserName}`);
      continue;
    }

    const winnerID = winnerInfo["Discord ID"];
    const loserID = loserInfo["Discord ID"];

    if (!winnerID || !loserID) {
      console.error(`[SOS announcement] Missing Discord ID for match: ${winnerName} vs ${loserName}`);
      continue;
    }

    // Note: College emote requires College field in Player. 
    // I'll add it to standings.ts in a moment.
    const winnerMention = `<@!${winnerID}>${getCollegeEmote(winnerInfo)}`;
    const loserMention = `<@!${loserID}>${getCollegeEmote(loserInfo)}`;

    let message = "";
    if (loserInfo.Losses >= MAX_LOSSES) {
      message = `${loserMention} was eliminated by ${winnerMention}.`;
    } else {
      message = `${loserMention} was defeated ${result} by ${winnerMention}.`;
    }

    if (note) {
      message += `\n> ${escapeMarkdown(note)}`;
    }

    if ((winnerInfo.Streak ?? 0) >= 5) {
      message += `\n${winnerMention} is on a ${winnerInfo.Streak} win streak!`;
    }

    if (winnerInfo.Wins + winnerInfo.Losses >= currentQuota.matchesMax) {
      message += `\n${winnerMention} is done for the week.`;
    }
    if (loserInfo.Wins + loserInfo.Losses >= currentQuota.matchesMax) {
      message += `\n${loserMention} is done for the week.`;
    }

    try {
      await webhook.send(message);
      
      const sheetRow = match[ROWNUM];
      const cellRef = `Matches!J${sheetRow}`;
      await sheetsWrite(sheets, CONFIG.LIVE_SHEET_ID, cellRef, [["1"]]);
      console.log(`[SOS announcement] Sent announcement for match row ${sheetRow}`);
    } catch (error) {
      console.error(`[SOS announcement] Failed to send announcement for row ${match["ROWNUM"]}:`, error);
    }
  }
}
