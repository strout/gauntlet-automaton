export type If<T, C, A> = T extends boolean
  ? T extends true ? C : T extends false ? A : (T | A)
  : never;
export type Pool<T = boolean> = {
  poolId: If<T, string, undefined>;
  sideboard?: Card[];
  deck?: Card[];
  hidden?: Card[];
};
export type Card = { name: string; count: number; set?: string };

if (import.meta.main) {
  const pools: Pool[] = await collectPools();
  await combinePools(pools);
}

export async function combinePools(pools: Pool[]) {
  const bigPool: Pool<boolean> = { poolId: undefined, sideboard: [] };
  for (const pool of pools) {
    bigPool.sideboard!.push(
      ...(pool.sideboard ?? []),
      ...(pool.hidden ?? []),
      ...(pool.deck ?? []),
    );
  }
  const resp = await fetch("https://sealeddeck.tech/api/pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bigPool),
  });
  bigPool.poolId = (await resp.json()).poolId;
  return bigPool as Pool<true>;
}

async function collectPools() {
  const pools: Pool<true>[] = [];
  for (const pack of Deno.args) {
    pools.push(
      await stringToPool(
        /sealeddeck.tech/.test(pack) ? pack : Deno.readTextFileSync(pack),
      ),
    );
  }
  return pools;
}

export async function stringToPool(pack: string) {
  const m = pack.match(/sealeddeck.tech\/(?<poolId>\w+)/i);
  let pool: Pool<boolean>;
  if (m) {
    const resp = await fetch(
      `https://sealeddeck.tech/api/pools/${m.groups!["poolId"]}`,
    );
    pool = await resp.json();
  } else {
    const stringPool = readStringPool(pack);
    const resp = await fetch("https://sealeddeck.tech/api/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stringPool),
    });
    pool = { ...stringPool, poolId: (await resp.json()).poolId };
  }
  return pool as Pool<true>;
}

export function readStringPool(content: string) {
  const ms = content.matchAll(
    /^((?<count>\d+) )?(?<name>.+?)( \((?<set>\w+)\)( (?<cnum>\d+)?))?$/gm,
  );
  const ms_ = [...ms];
  if (!ms || !ms_.length) throw "Couldn't match regex";
  const pool = {
    poolId: undefined,
    sideboard: [...ms_].map((m) => ({
      count: m[2] ? +m[2] : 1,
      name: m[3],
      set: m[5],
    })),
  };
  return pool;
}
