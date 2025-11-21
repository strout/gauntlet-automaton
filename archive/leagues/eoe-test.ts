import { readMapState } from "../../archive/leagues/eoe.ts";
import { initSheets, readSheetsDate, utcOffsetMs } from "../../sheets.ts";
import { getQuotas } from "../../standings.ts";

await initSheets();

// read quotas and planets; determine week each planet was discovered

const quotas = await getQuotas();

console.log(quotas);

const mapState = await readMapState();

const planets = mapState.planets;

for (const [name, { discoveredAt }] of planets) {
  console.log(`${name}: ${discoveredAt}`);
  const offset = utcOffsetMs("America/New_York");
  const { week } = quotas.findLast((q) => {
    const weekStart = readSheetsDate(q.fromDate, offset);
    console.log(`Week ${q.week} starts ${weekStart}`);
    return weekStart <= discoveredAt;
  }) ?? { week: 0 };
  console.log(`  discovered in week ${week}`);
}
