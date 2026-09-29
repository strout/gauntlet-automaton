import { mutex } from "../../mutex.ts";
import { choice } from "../../random.ts";
import { type ScryfallCard, searchCards } from "../../scryfall.ts";
import type { SealedDeckEntry } from "../../sealeddeck.ts";
import {
  addCopy,
  type CardCounts,
  copiesOf,
  ECHOED_QUERY_BY_RARITY,
  type EchoedRarity,
  fraCardsFor,
  type FraQueryKey,
  pickFraCard,
} from "./cards.ts";
import { echoedPartner } from "./echoed-pairs.ts";
import type { MirroredPairToStore } from "./mirrored-cards.ts";

/** Chance an unmirrored rare/mythic slot is a mythic. */
export const MYTHIC_CHANCE = 1 / 6;

/**
 * Serialises every roll that touches Mirrored Cards so rivals can't both roll
 * the same mirrored slots.
 */
export const fraRollLock = mutex();

export interface RolledPair extends MirroredPairToStore {
  readonly ownerScryfall: ScryfallCard;
  readonly rivalScryfall: ScryfallCard;
}

export function rareOrMythicSlot(): FraQueryKey {
  return Math.random() < MYTHIC_CHANCE ? "mythic" : "rare";
}

/** SealedDeck entries with repeated cards merged into counts. */
export function toSealedDeckEntries(
  cards: readonly ScryfallCard[],
): SealedDeckEntry[] {
  const entries = new Map<string, SealedDeckEntry>();
  for (const card of cards) {
    const key = `${card.name}|${card.set}`;
    entries.set(key, {
      name: card.name,
      set: card.set,
      count: (entries.get(key)?.count ?? 0) + 1,
    });
  }
  return [...entries.values()];
}

/**
 * Picks one card per slot, allowing up to `maxCopies(slot)` of each name in
 * `counts` (which is updated with every pick).
 */
export async function rollSlots(
  slots: readonly FraQueryKey[],
  counts: CardCounts,
  maxCopies: (slot: FraQueryKey) => number,
): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (const slot of slots) {
    cards.push(await pickFraCard(slot, counts, maxCopies(slot)));
  }
  return cards;
}

/**
 * Rolls an echoed card of `rarity` for the owner; its partner goes to the
 * rival. Each side may hold at most `maxCopies` of a name.
 */
export async function rollMirroredPair(
  slot: number,
  rarity: EchoedRarity,
  ownerCounts: CardCounts,
  rivalCounts: CardCounts,
  maxCopies: number,
): Promise<RolledPair> {
  const candidates: [ScryfallCard, ScryfallCard][] = [];
  for (const card of await fraCardsFor(ECHOED_QUERY_BY_RARITY[rarity])) {
    const partner = await echoedPartner(card);
    if (!partner) continue;
    if (copiesOf(ownerCounts, card.name) >= maxCopies) continue;
    if (copiesOf(rivalCounts, partner.name) >= maxCopies) continue;
    candidates.push([card, partner]);
  }
  const picked = choice(candidates);
  if (!picked) {
    throw new Error(
      `Could not roll an echoed ${rarity} with a known pair (slot ${slot})`,
    );
  }
  const [card, partner] = picked;
  addCopy(ownerCounts, card.name);
  addCopy(rivalCounts, partner.name);
  return {
    slot,
    rarity,
    ownerCard: card.name,
    rivalCard: partner.name,
    ownerScryfall: card,
    rivalScryfall: partner,
  };
}

export async function findEchoedCardByName(
  name: string,
): Promise<ScryfallCard> {
  const pools = await Promise.all([
    fraCardsFor("echoedUncommon"),
    fraCardsFor("echoedRare"),
    fraCardsFor("echoedMythic"),
  ]);
  const found = pools.flat().find((c) => c.name === name);
  if (found) return found;
  const [fallback] = await searchCards(`set:fra !"${name}"`);
  if (!fallback) throw new Error(`Echoed card not found on Scryfall: ${name}`);
  return fallback;
}
