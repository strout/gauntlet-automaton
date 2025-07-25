import * as djs from "discord.js";
import * as fix from "./fix-pool.ts";
import { compose, Handler } from "./dispatch.ts";
import { CONFIG } from "./main.ts";
import { mutex } from "./mutex.ts";
import {
  fetchSealedDeck,
  makeSealedDeck,
  SealedDeckPool,
} from "./sealeddeck.ts";

export async function extractPool(message: djs.Message) {
  const idFromField = message.embeds.map((e) =>
    e.fields.find((f) => f.name === "SealedDeck.Tech ID")
  ).filter((x) => x)[0]?.value.replaceAll("`", "");
  if (idFromField) {
    return await fetchSealedDeck(idFromField);
  }
  const poolFromContent =
    message.embeds.filter((e) => e.description?.includes("```")).map((e) =>
      fix.readStringPool(e.description!.replace(/\s*```\s*/g, ""))
    )[0];
  if (poolFromContent) {
    const poolId = await makeSealedDeck(poolFromContent);
    return await fetchSealedDeck(poolId);
  }
  const fileUrl = message.attachments.first()?.url;
  if (fileUrl) {
    const resp = await fetch(fileUrl);
    if (!resp.ok) {
      throw new Error("Not ok: " + fileUrl + " - " + resp.status);
    }
    const text = await resp.text();
    const pool = fix.readStringPool(text);
    const poolId = await makeSealedDeck(pool);
    return await fetchSealedDeck(poolId);
  }
}

type Cont<T, R> = (
  item: T,
  handle: { claim: () => void; release: () => void },
) => PromiseLike<
  { done: R } | undefined
>;

const pending = new Set<Handler<djs.Message>>();

// the spread here is to deliberately copy since idk how delete inside set iteration works
export const pendingHandler: Handler<djs.Message> = (...args) =>
  compose([...pending])(...args);

export function withPending<T>(cont: Cont<djs.Message, T>): Promise<T> {
  const lock = mutex();
  let _res: (result: T) => void, _rej: (reason?: unknown) => void;
  const resume = new Promise<T>((res, rej) => {
    _res = res;
    _rej = rej;
  });
  const handler: Handler<djs.Message> = async (message, handle) => {
    if (!pending.has(handler)) return;
    using _ = await lock();
    try {
      if (!pending.has(handler)) return;
      // TODO should I release the mutex on release?
      const result = await cont(message, handle);
      if (result) {
        _res(result.done);
        pending.delete(handler);
      }
    } catch (e) {
      _rej(e);
      pending.delete(handler);
      // don't propagate the exception because it'll be handled by the continuation
    }
  };
  pending.add(handler);
  return resume;
}

export function waitForBoosterTutor(reference: Promise<djs.Message>) {
  return withPending<{ success: SealedDeckPool } | { error: string }>(
    async (message, handle) => {
      if (message.author.id !== CONFIG.BOOSTER_TUTOR_USER_ID) {
        return;
      }
      const ref = await reference;
      if (message.reference?.messageId !== ref.id) {
        return;
      }
      handle.claim();
      // give up on errors
      if (message.content.startsWith(":warning:")) {
        return { done: { error: message.content } };
      }
      // return a pack if there is one; otherwise keep waiting.
      const pack = await extractPool(message);
      if (pack) return { done: { success: pack } };
    },
  );
}
