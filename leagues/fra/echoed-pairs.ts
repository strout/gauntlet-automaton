import type { ScryfallCard } from "../../scryfall.ts";
import { fraCardsFor } from "./cards.ts";

const CSV_URL = new URL("./echoed_pairs.csv", import.meta.url);

/** Max edit distance when matching a CSV name to a Scryfall name. */
const MAX_NAME_DISTANCE = 3;

let pairIndex: Promise<ReadonlyMap<string, ScryfallCard>> | undefined;

/**
 * Returns the echoed partner of a card, or `undefined` if it has none.
 *
 * @param card - A card rolled from one of the echoed queries
 */
export async function echoedPartner(
  card: ScryfallCard,
): Promise<ScryfallCard | undefined> {
  pairIndex ??= buildPairIndex();
  return (await pairIndex).get(card.name);
}

async function buildPairIndex(): Promise<ReadonlyMap<string, ScryfallCard>> {
  const [csv, uncommons, rares, mythics] = await Promise.all([
    Deno.readTextFile(CSV_URL),
    fraCardsFor("echoedUncommon"),
    fraCardsFor("echoedRare"),
    fraCardsFor("echoedMythic"),
  ]);
  const echoed = [...uncommons, ...rares, ...mythics];

  const index = new Map<string, ScryfallCard>();
  for (const row of parseCsv(csv)) {
    const [nameA, nameB] = row;
    if (!nameA || !nameB) continue;
    const cardA = resolveName(nameA, echoed);
    const cardB = resolveName(nameB, echoed);
    if (!cardA || !cardB) {
      console.warn(
        `[fra] Echoed pair not found on Scryfall: "${nameA}" / "${nameB}"` +
          `${!cardA ? ` (missing: ${nameA})` : ""}` +
          `${!cardB ? ` (missing: ${nameB})` : ""}`,
      );
      continue;
    }
    index.set(cardA.name, cardB);
    index.set(cardB.name, cardA);
  }
  return index;
}

function resolveName(
  name: string,
  cards: readonly ScryfallCard[],
): ScryfallCard | undefined {
  const target = normalize(name);
  const exact = cards.find((c) => normalize(c.name) === target);
  if (exact) return exact;

  let best: ScryfallCard | undefined;
  let bestDistance = Infinity;
  for (const card of cards) {
    const distance = levenshtein(target, normalize(card.name));
    if (distance < bestDistance) {
      best = card;
      bestDistance = distance;
    }
  }
  return bestDistance <= MAX_NAME_DISTANCE ? best : undefined;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Minimal CSV parser supporting quoted fields with commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    rows.push(fields);
  }
  return rows;
}
