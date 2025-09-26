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
import { shuffle } from "../../random.ts";

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
  const packCards: ScryfallCard[] = [];

  // For slots with groups, assign each member of the group a particular color
  const availableColorsByGroup: Record<number, string[]> = {};

  const balancedSlots = slots.map((slot) => {
    let color;
    if (slot.balanceGroup !== undefined) {
      availableColorsByGroup[slot.balanceGroup] ??= shuffle([
        "W",
        "U",
        "B",
        "R",
        "G",
      ]);
      color = availableColorsByGroup[slot.balanceGroup].pop();
    } else {
      color = undefined;
    }
    if (color) {
      return {
        ...slot,
        scryfall: slot.scryfall
          ? `(${slot.scryfall}) AND c:${color}`
          : `c:${color}`,
      };
    }
    return slot;
  });

  for (const slot of balancedSlots) {
    try {
      // Build Scryfall query
      let query = slot.scryfall || "set:om1";

      // Add rarity filter if specified
      if (slot.rarity) {
        if (slot.rarity === "rare/mythic") {
          // Handle rare/mythic with proper weighting
          const rareQuery = `${query} rarity:rare`;
          const mythicQuery = `${query} rarity:mythic`;

          const [rares, mythics] = await Promise.all([
            searchCards(rareQuery, { unique: "cards" }),
            searchCards(mythicQuery, { unique: "cards" }),
          ]);

          // Weight rares 2:1 over mythics
          const weightedCards = [
            ...rares.map((card): [ScryfallCard, number] => [card, 2]),
            ...mythics.map((card): [ScryfallCard, number] => [card, 1]),
          ];

          const selectedCard = weightedChoice(weightedCards);
          if (selectedCard) {
            packCards.push(selectedCard);
          }
        } else {
          query += ` rarity:${slot.rarity}`;
          const cards = await searchCards(query, { unique: "cards" });
          const selectedCard = choice(cards);
          if (selectedCard) {
            packCards.push(selectedCard);
          }
        }
      } else {
        // No rarity specified, search all rarities
        const cards = await searchCards(query, { unique: "cards" });
        const selectedCard = choice(cards);
        if (selectedCard) {
          packCards.push(selectedCard);
        }
      }
    } catch (error) {
      console.error(`Error generating card for slot:`, slot, error);
      // Add a fallback minimal ScryfallCard if generation fails
      packCards.push({ name: "Unknown Card" } as ScryfallCard);
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
        `(game:arena legal:standard r:c (o:"+1/+1" o:"put" -o:renew -o:exhaust))`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `((o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer)`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(o:"when this creature enters" game:arena r:c t:creature legal:standard)`,
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
        "game:arena legal:standard r:u (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw)",
    },
    {
      rarity: "common",
      scryfall:
        `(legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet)`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(legal:pioneer game:arena r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth))`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(game:arena legal:standard r:c (o:"commit a crime" OR o:"target spell" OR otag:removal))`,
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
        `(game:arena -s:spm -s:OM1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u)`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `((o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (o:explore and s:LCI) OR o:reconfigure OR (t:equipment o:token) OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena -s:spm -s:om1 r:u legal:pioneer)`,
      balanceGroup: 2,
    },
    {
      rarity: "uncommon",
      scryfall:
        `(o:"when this creature enters" game:arena r:u t:creature legal:standard -s:spm -s:om1)`,
      balanceGroup: 2,
    },
    { rarity: "uncommon" },
    { rarity: "uncommon" },
    {
      rarity: "common",
      scryfall:
        `(game:arena legal:standard r:c -s:OM1 (o:"+1/+1" o:"put" -o:renew -o:exhaust))`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `((o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer)`,
      balanceGroup: 1,
    },
    {
      rarity: "common",
      scryfall:
        `(o:"when this creature enters" game:arena r:c t:creature legal:standard -s:om1 -s:spm)`,
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
        'r:r game:arena -is:reprint -s:om1 ((legal:standard (oracletag:discard-outlet OR o:"commit a crime" OR o:"target spell" OR (otag:removal))) OR (legal:pioneer(o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth)))',
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
        `(game:arena legal:standard -s:spm -s:om1 r:u (o:"commit a crime" OR o:"target spell" OR otag:removal))`,
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
    .setDescription(
      `[View Pack](https://sealeddeck.tech/${heroPoolId})\n\n${
        formatPackCards(heroPack)
      }`,
    )
    .setColor(0x00BFFF);

  const villainEmbed = new EmbedBuilder()
    .setTitle("🦹 Villain Pack")
    .setDescription(
      `[View Pack](https://sealeddeck.tech/${villainPoolId})\n\n${
        formatPackCards(villainPack)
      }`,
    )
    .setColor(0x8B0000);

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
