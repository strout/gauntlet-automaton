import { choice, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  MessageCreateOptions,
} from "discord.js";
import { tileCardImages } from "../../scryfall.ts";
import { Buffer } from "node:buffer";

// Booster slot definition
export interface BoosterSlot {
  rarity?: "rare/mythic" | "rare" | "uncommon" | "common";
  scryfall?: string;
  balanceGroup?: number; // If provided, ensure diversity of colors within the group
}

// Generate pack cards from booster slots
export async function generatePackFromSlots(
  slots: readonly BoosterSlot[],
): Promise<ScryfallCard[]> {
  function getWeightedScryfallQueriesForSlot(
    slot: BoosterSlot,
  ): [string, number][] {
    let query = slot.scryfall || "set:om1";

    if (slot.rarity === "rare/mythic") {
      const rareQuery = `${query} rarity:rare`;
      const mythicQuery = `${query} rarity:mythic`;
      return [[rareQuery, 2], [mythicQuery, 1]];
    } else {
      if (slot.rarity) {
        query += ` rarity:${slot.rarity}`;
      }
      return [[query, 1]];
    }
  }

  async function getScryfallCardsForSlot(slot: BoosterSlot) {
    const queries = getWeightedScryfallQueriesForSlot(slot);
    return (await Promise.all(
      queries.map((x) =>
        searchCards(x[0]).then((y) =>
          new Array<readonly ScryfallCard[]>(x[1]).fill(y).flat()
        )
      ),
    )).flat();
  }

  const slotContents: ScryfallCard[][] = [];
  for (const slot of slots) {
    slotContents.push(await getScryfallCardsForSlot(slot));
  }

  const cardCounts = new Map<string, number>();
  slots.forEach((slot, index) => {
    if (slot.balanceGroup) {
      for (const card of slotContents[index]) {
        cardCounts.set(card.name, (cardCounts.get(card.name) ?? 0) + 1);
      }
    }
  });

  const cardColor = (
    card: ScryfallCard,
  ): "W" | "U" | "R" | "G" | "B" | "C" | "M" => {
    const colors = card.colors || card.card_faces?.[0]?.colors || [];
    return colors.length > 1
      ? "M"
      : colors.length === 0
      ? "C"
      : colors[0] as "W" | "U" | "R" | "B" | "G";
  };

  const groupColorWeights = new Map<
    number,
    Map<"W" | "U" | "R" | "B" | "G" | "M" | "C", number>
  >();
  {
    const seenCards = new Set<string>();
    slots.forEach((slot, index) => {
      if (slot.balanceGroup) {
        let weights = groupColorWeights.get(slot.balanceGroup);
        if (!weights) {
          weights = new Map();
          groupColorWeights.set(slot.balanceGroup, weights);
        }
        for (const card of slotContents[index]) {
          if (!seenCards.has(card.name)) {
            seenCards.add(card.name);
            weights.set(
              cardColor(card),
              (weights.get(cardColor(card)) ?? 0) + 1,
            );
          }
        }
        // massage wubrg weights to be the same
        const wubrg = "WUBRG";
        const total = [...wubrg].reduce((a, c) => a + weights.get(c as any)!, 0);
        for (const c of wubrg) {
          weights.set(c as any, total / 5);
        }
      }
    });
  }

  function generateCardForSlot(
    slot: BoosterSlot,
    index: number,
  ): ScryfallCard {
    const allCards = [...slotContents[index]];

    if (slot.rarity === "rare/mythic") {
      // duplicate all hero or villian cards that are not hero-villains, since we removed the others
      allCards.push(...allCards.filter(c => {
        const line = (c.card_faces?.[0] ?? c).type_line.toLowerCase();
        return line.includes("hero") !== line.includes("villain");
      }));
    }

    return choice(allCards)!;
  }

  const packCards: ScryfallCard[] = new Array(slots.length);

  // Group slots by balanceGroup
  const groups: Record<number, { slot: BoosterSlot; index: number }[]> = {};
  const nonGroupedSlots: { slot: BoosterSlot; index: number }[] = [];

  slots.forEach((slot, index) => {
    if (slot.balanceGroup !== undefined) {
      groups[slot.balanceGroup] ??= [];
      groups[slot.balanceGroup].push({ slot, index });
    } else {
      nonGroupedSlots.push({ slot, index });
    }
  });

  // Generate cards for non-grouped slots
  nonGroupedSlots.forEach(({ slot, index }) => {
    packCards[index] = generateCardForSlot(slot, index);
  });

  // Generate cards for grouped slots
  for (const groupId in groups) {
    const groupSlots = groups[groupId];
    const groupSize = groupSlots.length;
    const colors: ("W" | "U" | "R" | "G" | "B" | "M" | "C")[] = [];
    let colorWeights = [...groupColorWeights.get(+groupId)!];
    console.log(colorWeights);
    for (let i = 0; i < groupSize; i++) {
      colors.unshift(weightedChoice(colorWeights)!);
      colorWeights = colorWeights.filter(([c]) => c !== colors[0]);
    }

    let containsAllColors = false;
    while (!containsAllColors) {
      const generatedCards = groupSlots.map(({ slot, index }) =>
        generateCardForSlot(slot, index)
      );

      const presentColors = new Set<'W' | 'U' | 'R' | 'G' | 'B' | 'M' | 'C'>();
      for (const card of generatedCards) {
        presentColors.add(cardColor(card));
      }

      containsAllColors = colors.every((color) => presentColors.has(color));

      if (containsAllColors) {
        groupSlots.forEach(({ index }, i) => {
          packCards[index] = generatedCards[i];
        });
      }
    }
  }

  return packCards;
}

export function getCitizenBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
    { rarity: "common" },
  ];
}

// booster slots for citizens - hero pack
export function getCitizenHeroBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(-t:hero t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena -s:spm -s:om1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u",
    },
    {
      rarity: "common",
      scryfall:
        `game:arena legal:standard r:c (o:"+1/+1" o:"put" -o:renew -o:exhaust) -s:spm -s:om1`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `o:"when this creature enters" game:arena r:c t:creature legal:standard -s:spm -s:om1`,
      balanceGroup: 1,
    },
  ];
}

// booster slots for citizens - villain pack
export function getCitizenVillainBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(t:hero -t:villain)" },
    {
      rarity: "uncommon",
      scryfall:
        "game:arena legal:standard -s:spm -s:om1 r:u (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw)",
    },
    {
      rarity: "common",
      scryfall:
        `legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `legal:pioneer game:arena r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth) -s:spm -s:om1`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `game:arena legal:standard r:c (o:"commit a crime" OR o:"target spell" OR otag:removal) -s:spm -s:om1`,
      balanceGroup: 1,
    },
  ];
}

export function getHeroBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(-t:hero t:villain)" },
    {
      rarity: "rare",
      scryfall:
        '((legal:pioneer AND (o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (o:explore and s:LCI) OR o:reconfigure OR (t:equipment o:token) OR o:"shield counter" OR (t:aura AND o:"creature you control"))) OR (legal:standard ((o:"+1/+1" o:"put") OR (o:"when this creature enters")))) -is:reprint -s:spm -s:om1 game:arena r:r ',
    },
    {
      rarity: "uncommon",
      scryfall:
        `game:arena -s:spm -s:OM1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `(o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (o:explore and s:LCI) OR o:reconfigure OR (t:equipment o:token) OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena -s:spm -s:om1 r:u legal:pioneer`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `o:"when this creature enters" game:arena r:u t:creature legal:standard -s:spm -s:om1`,
      balanceGroup: 2,
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        `game:arena legal:standard r:c -s:spm -s:om1 (o:"+1/+1" o:"put" -o:renew -o:exhaust)`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `o:"when this creature enters" game:arena r:c t:creature legal:standard -s:om1 -s:spm`,
      balanceGroup: 1,
    },
    { rarity: "common" },
    { rarity: "common" },
  ];
}
export function getVillainBoosterSlots(): BoosterSlot[] {
  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(t:hero -t:villain)" },
    {
      rarity: "rare",
      scryfall:
        'r:r game:arena -is:reprint -s:spm -s:om1 ((legal:standard (oracletag:discard-outlet OR o:"commit a crime" OR o:"target spell" OR (otag:removal))) OR (legal:pioneer (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth)))',
    },
    {
      rarity: "uncommon",
      scryfall:
        `(game:arena legal:standard r:u -s:spm -s:om1 (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw))`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `(legal:pioneer game:arena -s:spm -s:om1 r:u (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth))`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `(game:arena legal:standard -s:spm -s:om1 r:u (o:"commit a crime" OR o:"target spell" OR otag:removal) -ragnarok)`,
      balanceGroup: 2,
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        `(legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet)`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(legal:pioneer game:arena -s:om1 -s:spm r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth))`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(game:arena legal:standard -s:spm -s:om1 r:c (o:"commit a crime" OR o:"target spell" OR otag:removal))`,
      balanceGroup: 1,
    },
    { rarity: "common" },
    { rarity: "common" },
  ];
}

export async function buildHeroVillainChoice(
  member: GuildMember,
  heroPack: ScryfallCard[],
  heroPoolId: string,
  villainPack: ScryfallCard[],
  villainPoolId: string,
): Promise<MessageCreateOptions> {
  const heroEmbed = new EmbedBuilder()
    .setTitle("🦸 Hero Pack")
    .setDescription(formatPackCards(heroPack))
    .setColor(0x00BFFF)
    .addFields(
      {
        name: "🔗 SealedDeck Link",
        value: `[View Pack](https://sealeddeck.tech/${heroPoolId})`,
        inline: true,
      },
      {
        name: "🆔 SealedDeck ID",
        value: `\`${heroPoolId}\``,
        inline: true,
      },
    );

  const villainEmbed = new EmbedBuilder()
    .setTitle("🦹 Villain Pack")
    .setDescription(formatPackCards(villainPack))
    .setColor(0x8B0000)
    .addFields(
      {
        name: "🔗 SealedDeck Link",
        value: `[View Pack](https://sealeddeck.tech/${villainPoolId})`,
        inline: true,
      },
      {
        name: "🆔 SealedDeck ID",
        value: `\`${villainPoolId}\``,
        inline: true,
      },
    );

  // Attempt to build tiled images for each pack. If tiling fails, omit the image.
  const files: AttachmentBuilder[] = [];

  try {
    const heroBlob = await tileCardImages(heroPack, "normal");
    const heroArrayBuffer = await heroBlob.arrayBuffer();
    const heroBuffer = Buffer.from(heroArrayBuffer);
    const heroFilename = `hero_${heroPoolId}.png`;
    const heroAttachment = new AttachmentBuilder(heroBuffer, {
      name: heroFilename,
    });
    heroEmbed.setImage(`attachment://${heroFilename}`);
    files.push(heroAttachment);
  } catch (_err) {
    // silently omit hero image on failure
  }

  try {
    const villainBlob = await tileCardImages(villainPack, "normal");
    const villainArrayBuffer = await villainBlob.arrayBuffer();
    const villainBuffer = Buffer.from(villainArrayBuffer);
    const villainFilename = `villain_${villainPoolId}.png`;
    const villainAttachment = new AttachmentBuilder(villainBuffer, {
      name: villainFilename,
    });
    villainEmbed.setImage(`attachment://${villainFilename}`);
    files.push(villainAttachment);
  } catch (_err) {
    // silently omit villain image on failure
  }

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder({
        customId: `SPM_choose_hero_${heroPoolId}`,
        label: "Choose Hero",
        style: ButtonStyle.Primary,
      }),
      new ButtonBuilder({
        customId: `SPM_choose_villain_${villainPoolId}`,
        label: "Choose Villain",
        style: ButtonStyle.Danger,
      }),
    ),
  ];

  const result: MessageCreateOptions = {
    content: `<@!${member.user.id}>, choose your path — Hero or Villain?`,
    embeds: [heroEmbed, villainEmbed],
    components,
  };

  if (files.length > 0) {
    // attach files only when at least one tiled image was produced
    return { ...result, files };
  }

  return result;
}

export function formatPackCards(cards: ScryfallCard[]) {
  return [
    "```",
    ...cards.map((c) => `${c.name}`),
    "```",
  ].join("\n");
}
