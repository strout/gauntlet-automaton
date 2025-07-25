export type Handler<T> = (
  event: T,
  handle: {
    // Claiming an event means that no later handler will see it. Use this when you're certain this event was meant for this handler.
    claim: () => void;
    // Releasing an event means it can be concurrently processed by other handlers. Use this if other handlers may want to see it, but you want to continue processing it asynchronously.
    release: () => void;
  },
) => Promise<void>;

export function compose<T>(handlers: Handler<T>[]): Handler<T> {
  return async (event, handle) => {
    const { claimed, finish } = await dispatch(event, handlers);
    if (claimed) handle.claim();
    handle.release();
    await finish;
  };
}

export async function dispatch<T>(event: T, handlers: Handler<T>[]) {
  const ongoing = [];
  let claimed = false;
  for (const handler of handlers) {
    const claim = () => {
      claimed = true;
    };
    let release!: () => void;
    const released = new Promise<void>((resolve) => release = resolve);
    const done = handler(event, { claim, release });
    ongoing.push(done);
    await Promise.race([done, released]);
    if (claimed) break;
  }
  return { claimed, finish: Promise.all(ongoing).then(() => {}) };
}
