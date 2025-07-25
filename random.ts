/**
 * Shuffles an array using keyed sort by random key (unbiased)
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
export function shuffle<T>(array: readonly T[]): T[] {
  return array
    .map(item => [item, Math.random()] as const)
    .sort(([, a], [, b]) => a - b)
    .map(([item]) => item);
}

/**
 * Randomly selects an element from an array
 * @param array - The array to select from
 * @returns A randomly selected element, or undefined if array is empty
 */
export function choice<T>(array: readonly T[]): T | undefined {
  if (array.length === 0) return undefined;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Randomly selects an element from an array based on weights
 * @param items - Array of items with weights: [item, weight][]
 * @returns A randomly selected item based on weights, or undefined if array is empty or all weights are 0
 */
export function weightedChoice<T>(items: readonly [T, number][]): T | undefined {
  if (items.length === 0) return undefined;

  const totalWeight = items.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) return undefined;

  let random = Math.random() * totalWeight;

  for (const [item, weight] of items) {
    random -= weight;
    if (random < 0) {  // Changed from <= to < for better floating point handling
      return item;
    }
  }

  // Improved fallback - return the last item with positive weight
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i][1] > 0) {
      return items[i][0];
    }
  }
  
  return undefined;
}
