import { withRetry } from "./retry.ts";
import { Image } from "@matmen/imagescript";

/**
 * Scryfall card object with essential properties
 */
export interface ScryfallCard {
  readonly object: "card";
  readonly id: string;
  readonly oracle_id?: string;
  readonly name: string;
  readonly set: string;
  readonly set_name: string;
  readonly collector_number: string;
  readonly rarity:
    | "common"
    | "uncommon"
    | "rare"
    | "mythic"
    | "special"
    | "bonus";
  readonly colors?: readonly string[];
  readonly color_identity: readonly string[];
  readonly mana_cost: string;
  readonly cmc: number;
  readonly type_line: string;
  readonly oracle_text?: string;
  readonly power?: string;
  readonly toughness?: string;
  readonly image_uris?: {
    readonly small: string;
    readonly normal: string;
    readonly large: string;
    readonly png: string;
  };
  readonly card_faces?: readonly {
    readonly name: string;
    readonly mana_cost: string;
    readonly colors?: readonly string[];
    readonly type_line?: string;
    readonly oracle_text?: string;
    readonly power?: string;
    readonly toughness?: string;
    readonly image_uris?: {
      readonly small: string;
      readonly normal: string;
      readonly large: string;
      readonly png: string;
    };
  }[];
  readonly games: readonly string[];
  readonly booster?: boolean;
  readonly digital?: boolean;
  readonly frame_effects?: readonly string[];
  readonly variation: boolean;
  readonly layout?: string;
  readonly all_parts?: readonly {
    readonly object: string;
    readonly component: string;
    readonly name: string;
    readonly type_line: string;
    readonly uri: string;
  }[];
  readonly set_type: string;
  readonly legalities: Record<string, string>;
}

/**
 * Scryfall search response from /cards/search endpoint
 */
export interface ScryfallSearchResponse {
  readonly object: "list";
  readonly total_cards: number;
  readonly has_more: boolean;
  readonly next_page?: string;
  readonly data: readonly ScryfallCard[];
}

/**
 * Cache entry structure
 */
interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
}

/**
 * Cache for Scryfall API responses
 */
const scryfallCache = new Map<string, CacheEntry<unknown>>();

/**
 * Default cache TTL in milliseconds (1 day)
 */
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Cache TTL for card images in milliseconds (30 days)
 */
const IMAGE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * Clears expired entries from the cache
 */
function cleanCache(ttl: number = DEFAULT_CACHE_TTL): void {
  const now = Date.now();
  for (const [key, entry] of scryfallCache.entries()) {
    if (now - entry.timestamp > ttl) {
      scryfallCache.delete(key);
    }
  }
}

/**
 * Error that includes retry delay information from Retry-After header
 */
class ScryfallRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(
    message: string,
    retryAfterMs: number,
  ) {
    super(message);
    this.name = "ScryfallRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Makes a cached request to the Scryfall API
 */
async function cachedScryfallRequest<T>(
  url: string,
  ttl: number = DEFAULT_CACHE_TTL,
): Promise<Readonly<T>> {
  const cached = scryfallCache.get(url);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }

  return await withRetry(
    async (disableRetry) => {
      const response = await fetch(url);

      if (!response.ok) {
        // Check for Retry-After header on rate limit
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : 0;

          // Only use custom retry if we have a meaningful delay (> 0)
          if (retryAfterSeconds > 0) {
            throw new ScryfallRateLimitError(
              `Scryfall API rate limit: ${response.status} ${response.statusText} for ${url}`,
              retryAfterSeconds * 1000,
            );
          }

          // No valid Retry-After header - don't retry to avoid hammering
          console.error(
            `Scryfall API rate limit without Retry-After header for ${url}`,
          );
          disableRetry();
        }
        throw new Error(
          `Scryfall API error: ${response.status} ${response.statusText} for ${url}`,
        );
      }

      const data = await response.json() as T;
      scryfallCache.set(url, {
        data,
        timestamp: Date.now(),
      });

      return data;
    },
    undefined,
    undefined,
    (error) => {
      // Use Retry-After delay if available and > 0, otherwise use exponential backoff
      if (error instanceof ScryfallRateLimitError && error.retryAfterMs > 0) {
        return error.retryAfterMs;
      }
      return undefined; // Use default exponential backoff
    },
  );
}

/**
 * Search options for Scryfall queries
 */
export interface SearchOptions {
  readonly unique?: "cards" | "art" | "prints";
  readonly order?:
    | "name"
    | "set"
    | "released"
    | "rarity"
    | "color"
    | "usd"
    | "tix"
    | "eur"
    | "cmc"
    | "power"
    | "toughness"
    | "edhrec"
    | "penny"
    | "artist"
    | "review";
  readonly dir?: "auto" | "asc" | "desc";
  readonly include_extras?: boolean;
  readonly include_multilingual?: boolean;
  readonly include_variations?: boolean;
  readonly page?: number;
}

/**
 * Searches for cards using the Scryfall /cards/search endpoint (single page only)
 *
 * @param query - Scryfall search query
 * @param options - Additional search options
 * @returns Single page of search results
 */
export async function searchCardsOnePage(
  query: string,
  options: SearchOptions = {},
): Promise<ScryfallSearchResponse> {
  const params = new URLSearchParams({ q: query });

  if (options.unique) params.set("unique", options.unique);
  if (options.order) params.set("order", options.order);
  if (options.dir) params.set("dir", options.dir);
  if (options.include_extras) params.set("include_extras", "true");
  if (options.include_multilingual) params.set("include_multilingual", "true");
  if (options.include_variations) params.set("include_variations", "true");
  if (options.page) params.set("page", options.page.toString());

  const url = `https://api.scryfall.com/cards/search?${params.toString()}`;
  return await cachedScryfallRequest<ScryfallSearchResponse>(url);
}

/**
 * Searches for cards using the Scryfall /cards/search endpoint
 *
 * @param query - Scryfall search query
 * @param options - Additional search options
 * @returns All cards from all result pages
 */
export async function searchCards(
  query: string,
  options: SearchOptions = {},
): Promise<readonly ScryfallCard[]> {
  const allCards: ScryfallCard[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await searchCardsOnePage(query, {
      ...options,
      page: currentPage,
    });
    allCards.push(...response.data);
    hasMore = response.has_more;
    currentPage++;
  }

  return allCards;
}

/**
 * Card identifier for /cards/collection endpoint
 */
export interface CardIdentifier {
  readonly name: string;
  readonly set?: string;
}

/**
 * Response from /cards/collection endpoint
 */
interface ScryfallCollectionResponse {
  readonly object: "list";
  readonly not_found?: readonly CardIdentifier[];
  readonly data: readonly ScryfallCard[];
}

/**
 * Fetches cards from Scryfall by name/set identifiers using the /cards/collection endpoint.
 * Batches requests in groups of 75 (Scryfall's limit) and adds delays between batches.
 *
 * @param identifiers - Array of card identifiers (name required, set optional)
 * @returns Map of card name (lower normalized) to ScryfallCard
 */
export async function fetchCardsByIdentifier(
  identifiers: readonly CardIdentifier[],
): Promise<ReadonlyMap<string, ScryfallCard>> {
  const result = new Map<string, ScryfallCard>();
  const normalizedIdentifiers = identifiers.map((id) => ({
    name: id.name.split(" //")[0].toLowerCase(),
    set: id.set?.toLowerCase(),
  }));

  const BATCH_SIZE = 75;
  const DELAY_MS = 1000;

  for (let i = 0; i < normalizedIdentifiers.length; i += BATCH_SIZE) {
    const batch = normalizedIdentifiers.slice(i, i + BATCH_SIZE);

    await withRetry(
      async () => {
        const response = await fetch(
          "https://api.scryfall.com/cards/collection",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifiers: batch }),
          },
        );

        if (!response.ok) {
          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const retryAfterSeconds = retryAfter
              ? parseInt(retryAfter, 10)
              : 0;
            if (retryAfterSeconds > 0) {
              throw new Error(
                `Scryfall rate limited, retry after ${retryAfterSeconds}s`,
              );
            }
          }
          throw new Error(
            `Scryfall collection error: ${response.status} ${response.statusText}`,
          );
        }

        const body = (await response.json()) as ScryfallCollectionResponse;

        for (const card of body.data) {
          const key = card.name.toLowerCase();
          if (!result.has(key)) {
            result.set(key, card);
          }
        }

        return body;
      },
      undefined,
      undefined,
      (error) => {
        if (
          error instanceof Error &&
          error.message.includes("rate limited")
        ) {
          const match = error.message.match(/retry after (\d+)s/);
          return match ? parseInt(match[1], 10) * 1000 : undefined;
        }
        return undefined;
      },
    );

    if (i + BATCH_SIZE < normalizedIdentifiers.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return result;
}

/**
 * Clears the entire Scryfall cache
 */
export function clearScryfallCache(): void {
  scryfallCache.clear();
}

/**
 * Gets the current size of the Scryfall cache
 */
export function getScryfallCacheSize(): number {
  return scryfallCache.size;
}

/**
 * Gets cache statistics
 */
export function getScryfallCacheStats() {
  const timestamps = Array.from(scryfallCache.values(), (e) => e.timestamp);

  return {
    size: scryfallCache.size,
    oldestEntry: Math.min(...timestamps),
    newestEntry: Math.max(...timestamps),
  };
}

/**
 * Forces cache cleanup and removes entries older than the specified TTL
 *
 * @param ttl - Time to live in milliseconds (default: DEFAULT_CACHE_TTL)
 * @returns Number of entries removed
 */
export function forceCacheCleanup(ttl: number = DEFAULT_CACHE_TTL): number {
  const initialSize = scryfallCache.size;
  cleanCache(ttl);
  return initialSize - scryfallCache.size;
}

/**
 * Available image sizes for card images
 */
export type ImageSize = "small" | "normal" | "large" | "png";

/**
 * Fetches a card image of the specified size from a ScryfallCard object
 *
 * @param card - ScryfallCard object containing image URIs
 * @param size - Desired image size (default: "normal")
 * @param ttl - Cache TTL in milliseconds (default: IMAGE_CACHE_TTL)
 * @returns Promise resolving to the image as a Blob
 * @throws Error if the card has no image URIs or the requested size is not available
 */
export async function fetchCardImage(
  card: ScryfallCard,
  size: ImageSize = "normal",
  ttl: number = IMAGE_CACHE_TTL,
): Promise<Blob> {
  // Check for image_uris on the card itself first
  let imageUris = card.image_uris;

  // If not available, check the front face for double-faced cards
  if (!imageUris && card.card_faces && card.card_faces.length > 0) {
    imageUris = card.card_faces[0].image_uris;
  }

  if (!imageUris) {
    throw new Error(`Card "${card.name}" has no image URIs available`);
  }

  const imageUrl = imageUris[size];
  if (!imageUrl) {
    throw new Error(
      `Image size "${size}" not available for card "${card.name}"`,
    );
  }

  const cached = scryfallCache.get(imageUrl);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as Blob;
  }

  return await withRetry(async () => {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch image: ${response.status} ${response.statusText} for ${imageUrl}`,
      );
    }

    const blob = await response.blob();
    scryfallCache.set(imageUrl, {
      data: blob,
      timestamp: Date.now(),
    });

    return blob;
  });
}

/**
 * Creates a tiled image from multiple cards
 *
 * @param cards - Array of ScryfallCard objects to tile
 * @param size - Image size to use for each card (default: "normal")
 * @param ttl - Cache TTL in milliseconds (default: IMAGE_CACHE_TTL)
 * @returns Promise resolving to a composite image as a Blob
 * @throws Error if any card images cannot be fetched
 */
export async function tileCardImages(
  cards: readonly ScryfallCard[],
  size: ImageSize = "normal",
  ttl: number = IMAGE_CACHE_TTL,
): Promise<Blob> {
  if (cards.length === 0) {
    throw new Error("Cannot tile images: no cards provided");
  }

  // Fetch all card images
  const imageBlobs = await Promise.all(
    cards.map((card) => fetchCardImage(card, size, ttl)),
  );

  // Convert blobs to ImageScript Image objects
  const images = await Promise.all(
    imageBlobs.map(async (blob) => {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      return await Image.decode(uint8Array);
    }),
  );

  // Calculate layout: 1 row if ≤7 cards, 2 rows if >7 cards
  const totalCards = cards.length;
  const usesTwoRows = totalCards > 7;
  const cardsPerRow = usesTwoRows
    ? [Math.floor(totalCards / 2), Math.ceil(totalCards / 2)]
    : [totalCards];

  // Assume all images have the same dimensions (use first image)
  const cardWidth = images[0].width;
  const cardHeight = images[0].height;

  // Calculate canvas dimensions
  const maxCardsInRow = Math.max(...cardsPerRow);
  const canvasWidth = maxCardsInRow * cardWidth;
  const canvasHeight = cardsPerRow.length * cardHeight;

  // Create composite image
  const composite = new Image(canvasWidth, canvasHeight);

  // Draw images onto composite
  let imageIndex = 0;
  for (let row = 0; row < cardsPerRow.length; row++) {
    const cardsInThisRow = cardsPerRow[row];
    const rowStartX = Math.floor(
      (canvasWidth - cardsInThisRow * cardWidth) / 2,
    ); // Center the row

    for (let col = 0; col < cardsInThisRow; col++) {
      const x = rowStartX + col * cardWidth;
      const y = row * cardHeight;
      composite.composite(images[imageIndex], x, y);
      imageIndex++;
    }
  }

  // Encode as PNG and return as Blob
  const pngData = await composite.encode();
  return new Blob([pngData as BlobPart], { type: "image/png" });
}

/**
 * Creates a tiled image from only rare and special rarity cards
 *
 * @param cards - Array of ScryfallCard objects to filter and tile
 * @param size - Image size to use for each card (default: "normal")
 * @param ttl - Cache TTL in milliseconds (default: IMAGE_CACHE_TTL)
 * @returns Promise resolving to a composite image as a Blob
 * @throws Error if no rare cards are found or if images cannot be fetched
 */
export async function tileRareImages(
  cards: readonly ScryfallCard[],
  size: ImageSize = "normal",
  ttl: number = IMAGE_CACHE_TTL,
): Promise<Blob> {
  // Filter for rare and special rarities
  const rareCards = cards.filter((card) =>
    ["rare", "mythic", "special", "bonus"].includes(card.rarity.toLowerCase())
  );

  if (rareCards.length === 0) {
    throw new Error(
      "No rare or special rarity cards found in the provided list",
    );
  }

  return await tileCardImages(rareCards, size, ttl);
}
