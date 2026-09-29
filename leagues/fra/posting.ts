import * as djs from "discord.js";
import { Buffer } from "node:buffer";
import type { ScryfallCard } from "../../scryfall.ts";

const WUBRG = ["W", "U", "B", "R", "G"] as const;

const COLOR_HEX: Readonly<Record<string, number>> = {
  W: 0xfff9e3,
  U: 0x0e68ab,
  B: 0x7c3aed,
  R: 0xd3202a,
  G: 0x00733e,
};
const MULTICOLOR_HEX = 0xe87800;

/** Embed accent: the pool's most common color, or orange on a tie. */
export function poolAccentColor(cards: readonly ScryfallCard[]): number {
  const counts = new Map<string, number>(WUBRG.map((c) => [c, 0]));
  for (const card of cards) {
    const colors = card.colors?.length ? card.colors : card.color_identity;
    for (const color of new Set(colors)) {
      if (counts.has(color)) counts.set(color, counts.get(color)! + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === ranked[1][1]) return MULTICOLOR_HEX;
  return COLOR_HEX[ranked[0][0]] ?? MULTICOLOR_HEX;
}

export async function imageAttachment(
  image: Promise<Blob>,
  name: string,
  description: string,
): Promise<djs.AttachmentBuilder | undefined> {
  try {
    const blob = await image;
    return new djs.AttachmentBuilder(Buffer.from(await blob.arrayBuffer()), {
      name,
      description,
    });
  } catch (e) {
    console.error(`[fra] Failed to build ${name}:`, e);
    return undefined;
  }
}
