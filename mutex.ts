/**
 * Creates a mutex (mutual exclusion) lock that ensures only one asynchronous operation
 * can execute at a time. Returns a function that acquires the lock and returns a
 * disposable guard object.
 *
 * @returns A function that returns a Promise resolving to a Disposable guard object.
 *          The guard must be disposed to release the lock and allow the next operation.
 *
 * @example
 * ```typescript
 * const acquireLock = mutex();
 *
 * async function criticalSection() {
 *   using guard = await acquireLock();
 *   // Only one instance of this code block can run at a time
 *   await someAsyncOperation();
 * } // Lock is automatically released when guard goes out of scope
 * ```
 *
 * @example
 * ```typescript
 * const acquireLock = mutex();
 *
 * async function manualRelease() {
 *   const guard = await acquireLock();
 *   try {
 *     await someAsyncOperation();
 *   } finally {
 *     guard[Symbol.dispose](); // Manually release the lock
 *   }
 * }
 * ```
 */
export function mutex(): () => Promise<Disposable> {
  let chain = Promise.resolve();
  return () => {
    let unlock: () => void;
    const guard = chain.then(() => ({ [Symbol.dispose]: unlock }));
    chain = new Promise<void>((res) => unlock = res);
    return guard;
  };
}
