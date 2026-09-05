import { Client, TextChannel } from "discord.js";
import { CONFIG } from "./config.ts";
import { LeagueSheet } from "./standings.ts";
import { delay } from "@std/async";
import { waitForBoosterTutor } from "./pending.ts";

/** Player fields used when resolving a per-player entropy pack command. */
export interface EntropyPackPlayer {
  readonly Identification: string;
  readonly Wins: number;
  readonly Losses: number;
  readonly "Discord ID": string;
}

/**
 * Booster Tutor command without the leading `!`
 * (e.g. `"cube SET"` or `"fin"`), or a function of the player.
 */
export type EntropyPackCommand =
  | string
  | ((player: EntropyPackPlayer) => string);

/** Per-league helper for processing entropy losses. */
export class EntropyAnnouncer {
  constructor(
    readonly sheet: LeagueSheet,
    readonly label: string,
    /** Booster Tutor command (e.g. "cube SET"), or per-player resolver. */
    readonly command?: EntropyPackCommand,
  ) {}

  #resolveCommand(player: EntropyPackPlayer): string | undefined {
    if (!this.command) return undefined;
    if (typeof this.command === "function") return this.command(player);
    return this.command;
  }

  /**
   * Processes entropy losses for the league.
   * Checks if players have met their minimum match quota and adds entropy losses if not.
   */
  async process(client: Client) {
    const currentWeek = await this.sheet.getCurrentWeek();
    const entropyWeek = await this.sheet.getEntropyWeek();
    const leagueOver = await this.sheet.isLeagueOver();

    console.log(
      `[entropy:${this.label}] Checking for entropy… (Current Week: ${currentWeek}, Entropy Week: ${entropyWeek}, League Over: ${leagueOver})`,
    );

    try {
      if (
        entropyWeek > currentWeek ||
        (entropyWeek === currentWeek && !leagueOver)
      ) {
        console.log(
          `[entropy:${this.label}] Waiting until week ${entropyWeek} ends (League Over: ${leagueOver}). Skipping.`,
        );
        return;
      }

      const players = await this.sheet.getPlayers();
      const quotas = await this.sheet.getQuotas();
      const currentQuota = quotas.find((q) => q.week === entropyWeek);

      if (!currentQuota) {
        console.log(
          `[entropy:${this.label}] No quota found for entropy week ${entropyWeek}. Advancing to ${
            entropyWeek + 1
          }…`,
        );
        await this.sheet.setEntropyWeek(entropyWeek + 1);
        return;
      }

      const packGenChannel = await client.channels.fetch(
        CONFIG.PACKGEN_CHANNEL_ID,
      ) as TextChannel;
      if (!packGenChannel) {
        console.error(
          `[entropy:${this.label}] Could not find pack generation channel`,
        );
        return;
      }

      for (const player of players.rows) {
        if (CONFIG.WAIVE_ENTROPY.includes(player.Identification)) continue;

        const wins = player.Wins;
        const losses = player.Losses;
        const matchesPlayed = wins + losses;
        const minMatches = currentQuota.matchesMin;

        if (matchesPlayed < minMatches) {
          const toAdd = Math.min(
            minMatches - matchesPlayed,
            CONFIG.MAX_LOSSES - losses,
          );
          if (toAdd <= 0) continue;

          const discordId = player["Discord ID"];
          if (!discordId) {
            console.warn(
              `[entropy:${this.label}] No Discord ID for player ${player.Identification}`,
            );
            continue;
          }
          const mention = `<@!${discordId}>`;
          const packCommand = this.#resolveCommand({
            Identification: player.Identification,
            Wins: player.Wins,
            Losses: player.Losses,
            "Discord ID": player["Discord ID"],
          });

          if (losses + toAdd >= CONFIG.MAX_LOSSES || !packCommand) {
            for (let i = 0; i < toAdd; i++) {
              await this.sheet.addEntropyRow(
                player.Identification,
                entropyWeek,
              );
            }

            const message = (losses + toAdd >= CONFIG.MAX_LOSSES)
              ? `${mention} was eliminated by ENTROPY.`
              : `${mention} was defeated by ENTROPY${
                toAdd > 1 ? ` ${toAdd} times` : ""
              }.`;

            await packGenChannel.send(message);
          } else {
            for (let i = 0; i < toAdd; i++) {
              await this.sheet.addEntropyRow(
                player.Identification,
                entropyWeek,
              );

              const sentMessage = await packGenChannel.send(
                `!${packCommand} ${mention} was defeated by ENTROPY.`,
              );

              try {
                const packResult = await waitForBoosterTutor(
                  Promise.resolve(sentMessage),
                );
                if ("success" in packResult) {
                  await this.sheet.recordPackAddition(
                    player.Identification,
                    packResult.success,
                    `Entropy loss (Week ${entropyWeek}) [${packCommand}]`,
                  );
                }
              } catch (e) {
                console.error(
                  `[entropy:${this.label}] Failed to record entropy pack for ${player.Identification}:`,
                  e,
                );
              }
              await delay(1000);
            }
          }
        }
      }

      await this.sheet.setEntropyWeek(entropyWeek + 1);
      console.log(
        `[entropy:${this.label}] Entropy for week ${entropyWeek} processed. Next: ${
          entropyWeek + 1
        }`,
      );
    } catch (e) {
      console.error(`[entropy:${this.label}] Error in process:`, e);
    }
  }
}

const announcerCache = new Map<string, EntropyAnnouncer>();

/** Returns a cached {@link EntropyAnnouncer} for the given spreadsheet. */
export function getEntropyAnnouncer(
  sheet: LeagueSheet,
  label: string,
  /** Booster Tutor command (e.g. "cube SET"), or per-player resolver. */
  command?: EntropyPackCommand,
): EntropyAnnouncer {
  const key = label;
  let announcer = announcerCache.get(key);
  if (!announcer) {
    announcer = new EntropyAnnouncer(sheet, label, command);
    announcerCache.set(key, announcer);
  }
  return announcer;
}
