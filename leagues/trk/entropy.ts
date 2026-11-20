import { CONFIG } from "../../config.ts";
import type { LeagueSheet } from "../../standings.ts";

/**
 * Records entropy losses for a finished week and advances the entropy week.
 * Rows are left unannounced. The match poll announces them and offers planets.
 */
export async function assignTrkEntropy(sheet: LeagueSheet): Promise<void> {
  const currentWeek = await sheet.getCurrentWeek();
  const entropyWeek = await sheet.getEntropyWeek();
  const leagueOver = await sheet.isLeagueOver();
  if (
    entropyWeek > currentWeek ||
    (entropyWeek === currentWeek && !leagueOver)
  ) {
    return;
  }

  const quotas = await sheet.getQuotas();
  const currentQuota = quotas.find((quota) => quota.week === entropyWeek);
  if (!currentQuota) {
    console.log(
      `[trk] No quota for entropy week ${entropyWeek}. Advancing to ${
        entropyWeek + 1
      }.`,
    );
    await sheet.setEntropyWeek(entropyWeek + 1);
    return;
  }

  const players = await sheet.getPlayers();
  let added = 0;
  for (const player of players.rows) {
    if (CONFIG.WAIVE_ENTROPY.includes(player.Identification)) continue;
    const played = player.Wins + player.Losses;
    if (played >= currentQuota.matchesMin) continue;
    const toAdd = Math.min(
      currentQuota.matchesMin - played,
      CONFIG.MAX_LOSSES - player.Losses,
    );
    if (toAdd <= 0) continue;
    for (let i = 0; i < toAdd; i++) {
      await sheet.addEntropyRow(player.Identification, entropyWeek, false);
      added++;
    }
    console.log(
      `[trk] entropy week ${entropyWeek}: ${player.Identification} +${toAdd}`,
    );
  }
  await sheet.setEntropyWeek(entropyWeek + 1);
  console.log(
    `[trk] Entropy for week ${entropyWeek} recorded (${added} losses). Next: ${
      entropyWeek + 1
    }.`,
  );
}
