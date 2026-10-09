import { Client, TextChannel } from "discord.js";
import { z } from "zod";
import { CONFIG } from "./config.ts";
import { LeagueSheet, parseTable, ROWNUM } from "./standings.ts";
import { delay } from "@std/async";
import { waitForBoosterTutor } from "./pending.ts";
import {
  getSheetTimeZoneOffsetMs,
  sheets,
  sheetsWrite,
  writeSheetsDate,
} from "./sheets.ts";

const BOT_MESSAGED_COLUMN = "Bot Messaged";

const isTrue = (value: unknown): boolean =>
  value === true || String(value ?? "").trim().toUpperCase() === "TRUE";

/** Entropy rows as entered by hand: only the player is required. */
const manualEntropyShape = {
  WEEK: z.unknown(),
  "PLAYER 2": z.string(),
  [BOT_MESSAGED_COLUMN]: z.unknown().transform(isTrue),
  Timestamp: z.unknown(),
};

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

export interface EntropyOptions {
  /**
   * Wait for Booster Tutor's reply and record the pack on Pool Changes
   * (default true). Set false when the command is handled by this bot and
   * records its own pack (e.g. FRA's `!fracture`).
   */
  readonly recordBoosterTutorPack?: boolean;
}

/** Per-league helper for processing entropy losses. */
export class EntropyAnnouncer {
  constructor(
    readonly sheet: LeagueSheet,
    readonly label: string,
    /** Booster Tutor command (e.g. "cube SET"), or per-player resolver. */
    readonly command?: EntropyPackCommand,
    readonly options: EntropyOptions = {},
  ) {}

  #resolveCommand(player: EntropyPackPlayer): string | undefined {
    if (!this.command) return undefined;
    if (typeof this.command === "function") return this.command(player);
    return this.command;
  }

  /**
   * Posts `!<packCommand> @player was defeated by ENTROPY.` and, unless the
   * command records its own pack, records Booster Tutor's pack.
   */
  async #sendPackLoss(
    packGenChannel: TextChannel,
    identification: string,
    mention: string,
    packCommand: string,
    comment: string,
  ): Promise<void> {
    const sentMessage = await packGenChannel.send(
      `!${packCommand} ${mention} was defeated by ENTROPY.`,
    );
    if (this.options.recordBoosterTutorPack !== false) {
      try {
        const packResult = await waitForBoosterTutor(
          Promise.resolve(sentMessage),
        );
        if ("success" in packResult) {
          await this.sheet.recordPackAddition(
            identification,
            packResult.success,
            comment,
          );
        }
      } catch (e) {
        console.error(
          `[entropy:${this.label}] Failed to record entropy pack for ${identification}:`,
          e,
        );
      }
    }
    await delay(1000);
  }

  /**
   * Announces Entropy rows whose Bot Messaged isn't TRUE (e.g. penalties
   * entered by hand), marking each one before posting so it's sent once.
   */
  async #announceUnmessagedRows(client: Client): Promise<void> {
    const table = await this.sheet.readTable("Entropy!A4:L", 4);
    const entropy = parseTable(manualEntropyShape, {
      ...table,
      rows: table.rows.filter((r) => r["PLAYER 2"]),
    });
    const unmessaged = entropy.rows.filter((r) => !r[BOT_MESSAGED_COLUMN]);
    if (unmessaged.length === 0) return;

    const botMessagedCol = entropy.headerColumns[BOT_MESSAGED_COLUMN];
    const timestampCol = entropy.headerColumns["Timestamp"];
    if (botMessagedCol === undefined) {
      throw new Error(`Entropy tab has no "${BOT_MESSAGED_COLUMN}" header`);
    }
    const packGenChannel = await client.channels.fetch(
      CONFIG.PACKGEN_CHANNEL_ID,
    );
    if (!(packGenChannel instanceof TextChannel)) {
      throw new Error("Could not find pack generation channel");
    }
    const players = await this.sheet.getPlayers();
    const offsetMs = await getSheetTimeZoneOffsetMs(this.sheet.sheetId);
    const writeCell = (row: number, col: number, value: unknown) =>
      sheetsWrite(
        sheets,
        this.sheet.sheetId,
        `Entropy!R${row}C${col + 1}`,
        [[value]],
        "RAW",
      );

    for (const row of unmessaged) {
      const name = row["PLAYER 2"];
      const rowNum = row[ROWNUM];
      const player = players.rows.find((p) => p.Identification === name);
      if (!player?.["Discord ID"]) {
        await writeCell(rowNum, botMessagedCol, "Error: player not found");
        await packGenChannel.send(
          `Error (Entropy row ${rowNum}): couldn't find a Discord ID for ${name}. CC: <@!${CONFIG.OWNER_ID}>`,
        );
        continue;
      }

      await writeCell(rowNum, botMessagedCol, true);
      if (timestampCol !== undefined && typeof row.Timestamp !== "number") {
        await writeCell(
          rowNum,
          timestampCol,
          writeSheetsDate(new Date(), offsetMs),
        );
      }

      // Losses already counts every row on the tab, including this one and
      // any later unmessaged rows for the same player.
      const later = unmessaged.filter((r) =>
        r["PLAYER 2"] === name && r[ROWNUM] > rowNum
      ).length;
      const lossesAfterThis = player.Losses - later;
      const mention = `<@!${player["Discord ID"]}>`;
      const packCommand = this.#resolveCommand({
        Identification: player.Identification,
        Wins: player.Wins,
        Losses: lossesAfterThis,
        "Discord ID": player["Discord ID"],
      });

      if (lossesAfterThis > CONFIG.MAX_LOSSES) {
        console.warn(
          `[entropy:${this.label}] Entropy row ${rowNum}: ${name} was already eliminated; not announcing.`,
        );
      } else if (lossesAfterThis === CONFIG.MAX_LOSSES) {
        await packGenChannel.send(`${mention} was eliminated by ENTROPY.`);
      } else if (!packCommand) {
        await packGenChannel.send(`${mention} was defeated by ENTROPY.`);
      } else {
        await this.#sendPackLoss(
          packGenChannel,
          player.Identification,
          mention,
          packCommand,
          `Entropy loss (Week ${row.WEEK}) [${packCommand}]`,
        );
      }
    }
  }

  /**
   * Processes entropy losses for the league: first any Entropy rows not yet
   * announced (e.g. penalties), then, once a week has ended, adds entropy
   * losses for players below their minimum match quota.
   */
  async process(client: Client) {
    try {
      await this.#announceUnmessagedRows(client);
    } catch (e) {
      console.error(
        `[entropy:${this.label}] Error announcing unmessaged rows:`,
        e,
      );
    }

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

              await this.#sendPackLoss(
                packGenChannel,
                player.Identification,
                mention,
                packCommand,
                `Entropy loss (Week ${entropyWeek}) [${packCommand}]`,
              );
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
  options?: EntropyOptions,
): EntropyAnnouncer {
  const key = label;
  let announcer = announcerCache.get(key);
  if (!announcer) {
    announcer = new EntropyAnnouncer(sheet, label, command, options);
    announcerCache.set(key, announcer);
  }
  return announcer;
}
