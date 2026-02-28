import { delay } from "@std/async";

const MAX_RETRY_DELAY = 128_000; // milliseconds
const DEFAULT_JITTER = 64; // milliseconds

/**
 * Calculates delay for the next retry based on the error.
 * Return undefined to use default exponential backoff.
 */
export type RetryDelayCalculator = (error: unknown) => number | undefined;

/**
 * Executes an async operation with exponential backoff and jitter retry logic.
 *
 * @param operation - The async function to execute with retry logic, receives a function to disable retries
 * @param maxRetryDelay - Maximum delay between retries in milliseconds (default: 128,000)
 * @param jitter - Random jitter in milliseconds added to delay (default: 64)
 * @param getRetryDelay - Optional function to calculate custom retry delay based on error
 * @returns Promise that resolves to the operation result or rejects with the last error
 */
export async function withRetry<T>(
  operation: (disableRetry: () => void) => Promise<T>,
  maxRetryDelay: number = MAX_RETRY_DELAY,
  jitter: number = DEFAULT_JITTER,
  getRetryDelay?: RetryDelayCalculator,
): Promise<T> {
  let lastError: unknown;
  let disabled = false;

  const disableRetry = () => {
    disabled = true;
  };

  let retryDelay = 1000;
  while (retryDelay < maxRetryDelay) {
    try {
      return await operation(disableRetry);
    } catch (e) {
      lastError = e;
      if (disabled) {
        break;
      }
      console.error("Retrying after error:", e);

      // Check if we have a custom delay for this error
      const customDelay = getRetryDelay?.(e);
      const actualDelay = customDelay ?? retryDelay;

      await delay(actualDelay + Math.random() * jitter);

      // Only double the base delay if not using a custom delay
      if (customDelay === undefined) {
        retryDelay *= 2;
      }
    }
  }
  throw lastError;
}
