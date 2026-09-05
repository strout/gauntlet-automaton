import { fetchRandomCardForQuery, fetchCardsByIdentifier, type ScryfallCard } from "../../../scryfall.ts";
import { getPoolChanges, LeagueSheet, type Player } from "../../../standings.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckPool,
} from "../../../sealeddeck.ts";

export const COMPANY_REWARDS = [
  {
    space: 1,
    name: "The Shire",
    query:
      "game:arena date<2026-07-02 in:paper -s:hob -s:fra -s:spm -s:msh -s:tmt r<r (t:dwarf or o:dwarf or t:halfling or o:halfling or t:food)",
    count: 3,
  },
  {
    space: 3,
    name: "Rivendell",
    query:
      "game:arena in:paper date<2026-07-02 -s:hob -s:fra -s:spm -s:msh -s:tmt r<r (((t:elf or o:elf) and id:ug) or (t:equipment and mv<3 and -t:creature and -fo:token) or t:rune)",
    count: 3,
  },
  {
    space: 5,
    name: "The Misty Mountains",
    query:
      'game:arena in:paper date<2026-07-02 -s:hob -s:fra -s:spm -s:msh -s:tmt r<r (t:goblin or o:goblin or o:"ring tempts")',
    count: 3,
  },
  {
    space: 7,
    name: "Mirkwood",
    query:
      "game:arena in:paper date<2026-07-02 -s:hob -s:fra -s:spm -s:msh -s:tmt r<r -t:legend (t:spider or t:bear or t:wolf or (t:elf c:b)) -t:battle",
    count: 3,
  },
  {
    space: 9,
    name: "The Dale",
    query:
      "game:arena in:paper date<2026-07-02 -s:hob -s:fra -s:spm -s:msh -s:tmt r<r ((t:human -t:legend id:ub) or t:archer)",
    count: 3,
  },
];

export const WIN11_REWARD = {
  name: "The Lonely Mountain",
  query:
    "game:arena in:paper date<2026-07-02 -s:hob -s:fra -t:battle r>u t:dragon",
  count: 1,
};

export async function getRandomCards(
  query: string,
  count: number,
): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  let attempts = 0;
  while (cards.length < count && attempts < count * 5) {
    try {
      const card = await fetchRandomCardForQuery(query);
      if (card && !cards.some((c) => c.name === card.name)) {
        cards.push(card);
      }
    } catch (e) {
      console.error(`[hobbit] Scryfall random fetch failed:`, e);
    }
    attempts++;
  }
  if (cards.length < count) {
    console.warn(
      `[hobbit] Could not find ${count} unique cards for query: ${query}. Found ${cards.length}.`,
    );
  }
  return cards;
}

export async function generateRewardPack(
  query: string,
  count: number,
): Promise<{ pool: SealedDeckPool; cards: ScryfallCard[] }> {
  const cards = await getRandomCards(query, count);
  const poolData = {
    sideboard: cards.map((card) => ({ name: card.name, count: 1, set: card.set })),
    hidden: [],
    deck: [],
  };
  const poolId = await makeSealedDeck(poolData);
  return {
    pool: { ...poolData, poolId },
    cards,
  };
}

export function getCompanySpace(players: Player[]): number {
  const wins = players.map((p) => p.Wins).sort((a, b) => b - a);
  return wins.length >= 3 ? wins[2] : 0;
}

export function hasReachedWin11(players: Player[]): boolean {
  return players.some((p) => p.Wins >= 11);
}

export interface Reward {
  name: string;
  query: string;
  count: number;
}

export async function distributeCompanyReward(
  sheet: LeagueSheet,
  poolChanges: Awaited<ReturnType<typeof getPoolChanges>>,
  companyMembers: Player[],
  reward: Reward,
): Promise<{ cards: ScryfallCard[]; pool: SealedDeckPool; isNew: boolean } | null> {
  const rewardEntries = poolChanges.rows.filter((c) =>
    companyMembers.some((m) => m.Identification === c.Name) &&
    c.Comment?.includes(`Company Reward: ${reward.name}`)
  );

  const missingReward = companyMembers.filter((member) =>
    !rewardEntries.some((e) => e.Name === member.Identification)
  );

  if (missingReward.length === 0) return null;

  let sharedPack: SealedDeckPool;
  let rewardCards: ScryfallCard[] = [];
  let isNew = false;

  // Use existing pool if available, otherwise generate new
  const existingEntry = rewardEntries[0];
  if (existingEntry?.Value) {
    sharedPack = await fetchSealedDeck(existingEntry.Value);
    const cardsMap = await fetchCardsByIdentifier(
      sharedPack.sideboard.map((item) => ({ name: item.name })),
    );
    rewardCards = sharedPack.sideboard
      .map((item) => cardsMap.get(item.name.toLowerCase()))
      .filter((c): c is ScryfallCard => c !== undefined);
  } else {
    const result = await generateRewardPack(reward.query, reward.count);
    sharedPack = result.pool;
    rewardCards = result.cards;
    isNew = true;
  }

  for (const member of missingReward) {
    await sheet.recordPackAddition(
      member.Identification,
      sharedPack,
      `Company Reward: ${reward.name}`,
      poolChanges,
    );
    // Update local cache to prevent double-claiming in same poll
    poolChanges.rows.push({
      Name: member.Identification,
      Comment: `Company Reward: ${reward.name}`,
    } as any);
  }

  return { cards: rewardCards, pool: sharedPack, isNew };
}
