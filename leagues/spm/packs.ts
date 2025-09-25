import { choice, weightedChoice } from "../../random.ts";
import { ScryfallCard, searchCards } from "../../scryfall.ts";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  MessageCreateOptions,
  AttachmentBuilder,
} from "discord.js";
import { tileCardImages } from "../../scryfall.ts";
import { Buffer } from "node:buffer";

// Booster slot definition
export interface BoosterSlot {
  rarity?: "rare/mythic" | "uncommon" | "common";
  scryfall?: string;
}

// Generate pack cards from booster slots
export async function generatePackFromSlots(slots: BoosterSlot[]): Promise<ScryfallCard[]> {
  const packCards: ScryfallCard[] = [];

  for (const slot of slots) {
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
  // Pre-select 3 random colors and assign one to each common slot
  const allColors = ['W', 'U', 'B', 'R', 'G'];
  const selectedColors = allColors.sort(() => Math.random() - 0.5).slice(0, 3);
  console.log(`Hero pack colors: ${selectedColors.join(', ')}`);

  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(-t:hero t:villain)" },
    {
      rarity: "uncommon",
      scryfall: "game:arena -s:spm -s:om1 ((t:legendary AND t:creature AND legal:standard) OR (oracletag:synergy-legendary AND legal:pioneer)) -ragnarok r:u",
    },
    {
      rarity: "common",
      scryfall: `(game:arena legal:standard r:c (o:"+1/+1" o:"put" -o:renew -o:exhaust)) AND c:${selectedColors[0]}`,
    },
    {
      rarity: "common",
      scryfall: `((o:"modified" OR o:backup OR o:renew OR o:exhaust OR o:connive OR (t:equipment o:token) OR (o:explore and s:LCI) OR o:reconfigure OR o:"shield counter" OR (t:aura AND o:"creature you control")) game:arena r:c -s:spm -s:om1 legal:pioneer) AND c:${selectedColors[1]}`,
    },
    {
      rarity: "common",
      scryfall: `(o:"when this creature enters" game:arena r:c t:creature legal:standard) AND c:${selectedColors[2]}`,
    }
  ];
}

// booster slots for citizens - villain pack
export function getCitizenVillainBoosterSlots(): BoosterSlot[] {
  // Pre-select 3 random colors and assign one to each common slot
  const allColors = ['W', 'U', 'B', 'R', 'G'];
  const selectedColors = allColors.sort(() => Math.random() - 0.5).slice(0, 3);
  console.log(`Villain pack colors: ${selectedColors.join(', ')}`);

  return [
    { rarity: "rare/mythic", scryfall: "s:om1 r>u -(t:hero -t:villain)" },
    {
      rarity: "uncommon",
      scryfall: "game:arena legal:standard r:u (t:warlock OR t:rogue OR t:pirate OR t:mercenary OR t:assassin OR o:outlaw)",
    },
    {
      rarity: "common",
      scryfall: `(legal:pioneer game:arena r:c -s:spm -s:om1 -o:learn oracletag:discard-outlet) AND c:${selectedColors[0]}`,
    },
    {
      rarity: "common",
      scryfall: `(legal:pioneer game:arena r:c (o:disturb OR o:flashback OR o:madness OR o:escape OR o:jump-start OR o:unearth)) AND c:${selectedColors[1]}`,
    },
    {
      rarity: "common",
      scryfall: `(game:arena legal:standard r:c (o:"commit a crime" OR o:"target spell" OR otag:removal)) AND c:${selectedColors[2]}`,
    }
  ];
}

export async function buildHeroVillainChoice(
  member: GuildMember,
  heroPack: ScryfallCard[],
  heroPoolId: string,
  villainPack: ScryfallCard[],
  villainPoolId: string,
): Promise<MessageCreateOptions> {
  // helper to format pack text (first 6 entries)
  const formatPackCards = (cards: ScryfallCard[]) =>
    cards
      .slice(0, 6)
      .map((c) => `• ${c.name}`)
      .join("\n") +
    (cards.length > 6 ? `\n... and ${cards.length - 6} more` : "");

  // try to fetch an image url for a pack using the provided ScryfallCard objects
  function firstCardImageUrl(cards: ScryfallCard[]) {
    if (!cards || cards.length === 0) return undefined;
    const card = cards[0];
    return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
  }

  const heroImage = firstCardImageUrl(heroPack);
  const villainImage = firstCardImageUrl(villainPack);

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
    const heroAttachment = new AttachmentBuilder(heroBuffer, { name: heroFilename });
    heroEmbed.setImage(`attachment://${heroFilename}`);
    files.push(heroAttachment);
  } catch (err) {
    // silently omit hero image on failure
  }

  try {
    const villainBlob = await tileCardImages(villainPack, "normal");
    const villainArrayBuffer = await villainBlob.arrayBuffer();
    const villainBuffer = Buffer.from(villainArrayBuffer);
    const villainFilename = `villain_${villainPoolId}.png`;
    const villainAttachment = new AttachmentBuilder(villainBuffer, { name: villainFilename });
    villainEmbed.setImage(`attachment://${villainFilename}`);
    files.push(villainAttachment);
  } catch (err) {
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
