import { withRetry } from "../../retry.ts";
import {
  fetchRandomCardForQuery,
  type ScryfallCard,
  scryfallFetch,
} from "../../scryfall.ts";
import { sheets, sheetsWrite } from "../../sheets.ts";
import { type LeagueSheet, ROWNUM } from "../../standings.ts";

/** Charges required before a planet counts as stationed. */
export const STATION_THRESHOLD = 147;

const PLANET_SHEET = "Planet Status";

/**
 * Immediate card and the stationed bonus, in Planet Status order.
 * Queries are the Scryfall searches for that planet's card.
 */
export interface Planet {
  readonly name: string;
  readonly query: string;
  readonly planetBonus: string;
  readonly stationBonus: string;
}

export const PLANETS: readonly Planet[] = [
  {
    name: "Andoria",
    query: "set:trc r<r -o:commander (in:arena OR not:reprint)",
    planetBonus: "One C/U TRC Card",
    stationBonus: "Borg decks may not include non-basic lands.",
  },
  {
    name: "Bajor",
    query:
      "format:standard r<r date<2026-10-31 -t:creature (t:instant or t:sorcery)",
    planetBonus: "One C/U Instant or Sorcery Spell",
    stationBonus: "Borg decks must have minimum 70 cards.",
  },
  {
    name: "Betazed",
    query: 'format:standard r<r date<2026-10-31 (o:"+1/+1 counter")',
    planetBonus: "One C/U +1/+1 Counters Spell",
    stationBonus: "Borg players reveal their deck list before playing.",
  },
  {
    name: "Earth",
    query: "format:standard r<r date<2026-10-31 (-t:basic t:land)",
    planetBonus: "One C/U Nonbasic Land",
    stationBonus: "Federation players vote to ban one card from Borg decks.",
  },
  {
    name: "Ferenginar",
    query: 'format:standard r<r date<2026-10-31 (o:"your graveyard")',
    planetBonus: "One C/U Graveyard Matters Spell",
    stationBonus:
      "All immediate Planet Bonuses are choose 1 of 2 cards (effective immediately)",
  },
  {
    name: "Qo'noS",
    query:
      'format:standard r<r date<2026-10-31 (o:"sacrifice a creature" OR o:"sacrifice another creature" OR o:"player sacrifices")',
    planetBonus: "One C/U Sacrifice-Matters Spell",
    stationBonus:
      "Coin toss determines play/draw for Borg matches (instead of the Borg choosing)",
  },
  {
    name: "Tellar",
    query: "format:standard r<r date<2026-10-31 (t:artifact and t:creature)",
    planetBonus: "One C/U Artifact Creature",
    stationBonus: "Borg decks may not include multiple copies of the same R/M",
  },
  {
    name: "Vulcan",
    query: "format:standard r<r date<2026-10-31 (is:modal)",
    planetBonus: "One C/U Dilemma",
    stationBonus:
      "Federation players vote on 5 bonus commons (Standard legal, 1 per color) for each federation player to receive.",
  },
] as const;

export const FERENGINAR = "Ferenginar";

export interface PlanetSheetRow {
  readonly name: string;
  readonly row: number;
  readonly charges: number;
  readonly stationBonus: string;
  readonly planetBonus: string;
}

/** Apostrophes and case aside, the planet this name refers to. */
export function planetByName(name: string): Planet | undefined {
  const key = planetKey(name);
  return PLANETS.find((planet) => planetKey(planet.name) === key);
}

/**
 * How many times each planet was chosen. The count is Pool Changes rows whose
 * Planet Stationed cell is that planet. Older rows that stored it in Value
 * under type `planet` or `station` still count.
 */
export function chargeCounts(
  rows: readonly {
    Type: string;
    Value: string;
    "Planet Stationed"?: string | null;
  }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const stationed = planetByName(`${row["Planet Stationed"] ?? ""}`);
    if (stationed) {
      counts.set(stationed.name, (counts.get(stationed.name) ?? 0) + 1);
      continue;
    }
    if (row.Type !== "planet" && row.Type !== "station") continue;
    const legacy = planetByName(row.Value);
    if (!legacy) continue;
    counts.set(legacy.name, (counts.get(legacy.name) ?? 0) + 1);
  }
  return counts;
}

/** True once Ferenginar's recorded charges have reached the threshold. */
export function ferenginarStationed(
  charges: ReadonlyMap<string, number>,
): boolean {
  return (charges.get(FERENGINAR) ?? 0) >= STATION_THRESHOLD;
}

/**
 * Cards granted for a station that has not been written yet.
 * Ferenginar's bonus includes the charge that stations it.
 */
export function picksForNewStation(
  charges: ReadonlyMap<string, number>,
  planetName: string,
): 1 | 2 {
  const next = (charges.get(FERENGINAR) ?? 0) +
    (planetKey(planetName) === planetKey(FERENGINAR) ? 1 : 0);
  return next >= STATION_THRESHOLD ? 2 : 1;
}

/** Reads Planet Status names, charge counters, and bonus text. */
export async function readPlanetStatus(
  sheet: LeagueSheet,
): Promise<readonly PlanetSheetRow[]> {
  const table = await sheet.readTable(`${PLANET_SHEET}!A:D`);
  return table.rows.flatMap((row) => {
    const name = cellText(row.Planet);
    if (!name) return [];
    return [{
      name,
      row: row[ROWNUM],
      charges: cellNumber(row["Charge Counters"]),
      stationBonus: cellText(row["Station Bonus"]),
      planetBonus: cellText(row["Planet Bonus"]),
    }];
  });
}

/**
 * Sets each planet's Charge Counters cell to `counts` when it differs.
 * Planets at zero are left blank.
 */
export async function writePlanetCharges(
  sheet: LeagueSheet,
  counts: ReadonlyMap<string, number>,
): Promise<readonly PlanetSheetRow[]> {
  const data = await readPlanetStatus(sheet);
  for (const row of data) {
    const planet = planetByName(row.name);
    if (!planet) continue;
    const desired = counts.get(planet.name) ?? 0;
    if (desired === row.charges) continue;
    await sheetsWrite(
      sheets,
      sheet.sheetId,
      `${PLANET_SHEET}!B${row.row}`,
      [[desired === 0 ? "" : desired]],
    );
  }
  return data;
}

/** Rolls up to `count` differently named cards. Fewer if the query is that small. */
export async function rollPlanetCards(
  planet: Planet,
  count: number,
): Promise<ScryfallCard[]> {
  const picked: ScryfallCard[] = [];
  const seen = new Set<string>();
  const attempts = Math.max(count * 6, 6);
  for (let i = 0; i < attempts && picked.length < count; i++) {
    const card = await fetchRandomCardForQuery(planet.query, "cards");
    if (!card) break;
    const key = card.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(card);
  }
  if (picked.length === 0) {
    throw new Error(`No cards for ${planet.name}: ${planet.query}`);
  }
  return picked;
}

/** Fetches one card by Scryfall id. */
export function fetchScryfallCard(id: string): Promise<ScryfallCard | null> {
  return withRetry(async (disableRetry) => {
    const response = await scryfallFetch(
      `https://api.scryfall.com/cards/${id}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 400) disableRetry();
      throw new Error(
        `Scryfall card ${id}: ${response.status} ${response.statusText}`,
      );
    }
    const body = await response.json() as { readonly object: string };
    if (body.object !== "card") return null;
    return body as ScryfallCard;
  });
}

export function planetKey(name: string): string {
  return name.normalize("NFKC").replace(/[\u2019']/g, "'").trim().toLowerCase();
}

function cellText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cellNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
