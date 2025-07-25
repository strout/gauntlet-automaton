import { Animal, ANIMALS, BLB, Pack } from "./blb.ts";

export const stuck = Symbol("stuck");
export const retry = Symbol("retry");

type StuckError = {
  stuck: typeof stuck;
  later: Promise<ReplayState>;
};

type RetryError = {
  retry: typeof retry;
  after: Promise<void>;
};

// Sheet column 1: names
// Sheet column 2: discord ids
// Sheet column 3+: replay log statements

function throwStuck(later: Promise<ReplayState>): never {
  throw { stuck, later } satisfies StuckError;
}

function isStuck(obj: unknown): obj is StuckError {
  return (obj as StuckError | undefined)?.stuck === stuck;
}

function throwRetry(after: Promise<void>): never {
  throw { retry, after } satisfies RetryError;
}

function isRetry(obj: unknown): obj is RetryError {
  return (obj as RetryError | undefined)?.retry === retry;
}

export type BLBBackend = {
  isBlbCommon(card: string): boolean;
  playerId: string;
  animal: Animal;
  playerRandomSeed: number;
  start: () => Promise<
    { playerLogs: string[]; trashLogs: string[] }
  >;
  requestPack: (message: string) => Promise<string>;
  finish: (
    newTrashLogs: readonly string[],
    newPlayerLogs: readonly string[],
    poolPacks: readonly string[],
    poolSingles: readonly string[],
    messages: readonly string[],
    currentBoon: Animal | undefined,
  ) => Promise<void>;
  readPack: (packId: string) => Promise<string[]>;
};

type ReplayState = {
  readonly currentBoon: Animal | undefined;
  readonly numSeen: number;
  readonly extras: readonly string[];
  readonly skipBoon: boolean;
  readonly pastPlayerLogs: readonly string[];
  readonly playerLogIndex: number;
  readonly pastTrashLogs: readonly string[];
  readonly newPlayerLogs: readonly string[];
  readonly newTrashLogs: readonly string[];
  readonly usedBoons: readonly Animal[];
  readonly remainingBoons: readonly Animal[];
  readonly poolPacks: readonly string[];
  readonly poolSingles: readonly string[];
  readonly randomOffset: number;
  readonly messages: readonly string[];
};

export async function initState(impl: BLBBackend): Promise<ReplayState> {
  const { playerLogs, trashLogs } = await impl.start();
  const ret: ReplayState = {
    currentBoon: undefined,
    pastPlayerLogs: playerLogs,
    playerLogIndex: 0,
    pastTrashLogs: trashLogs,
    newPlayerLogs: [],
    newTrashLogs: [],
    usedBoons: [],
    remainingBoons: ANIMALS,
    poolPacks: [],
    poolSingles: [],
    randomOffset: 0,
    numSeen: 3,
    extras: [],
    skipBoon: false,
    messages: [],
  };
  return ret;
}

// Replay to just past the last boon; note this depends on boon implementation!
export function fastForward(state: ReplayState): ReplayState {
  // TODO assert it's fresh? Probably not important.
  const usedBoons = state.pastPlayerLogs.flatMap((x, i) => {
    const [type, val] = x.split(" ");
    return type === "done" ? [{ boon: val as Animal, index: i }] : [];
  });
  const remainingBoons = ANIMALS.filter((x) =>
    !usedBoons.some((y) => y.boon === x)
  );
  const lastBoon: typeof usedBoons[number] | undefined =
    usedBoons[usedBoons.length - 1];
  const lastLastBoon: typeof usedBoons[number] | undefined =
    usedBoons[usedBoons.length - 2];
  const playerLogIndex = 1 + (lastBoon?.index ?? -1);
  const mostRecentLogs = usedBoons.length
    ? state.pastPlayerLogs.slice(
      lastLastBoon?.index ?? 0,
      lastBoon!.index,
    )
    : [];

  const skipBoon = lastBoon?.boon === "Frog";
  const numSeen = lastBoon?.boon === "Bird" && lastLastBoon?.boon !== "Frog"
    ? 9
    : 3;
  const extras =
    lastBoon?.boon === "Squirrel" && mostRecentLogs.includes("chose ELD")
      ? ["BLB", "ELD"]
      : [];

  const seenLogs = state.pastPlayerLogs.slice(0, playerLogIndex);

  const poolPacks = seenLogs
    .flatMap((x) => {
      const [type, ...packs] = x.split(" ");
      return type === "pack" ? packs : [];
    });

  const poolSingles = seenLogs
    .flatMap((x) => {
      const [type, ...cardWords] = x.split(" ");
      return type === "cards" ? cardWords.join(" ").split("|") : [];
    });

  return {
    numSeen,
    extras,
    skipBoon,
    pastPlayerLogs: state.pastPlayerLogs,
    playerLogIndex,
    pastTrashLogs: state.pastTrashLogs,
    newPlayerLogs: [],
    newTrashLogs: [],
    messages: [],
    usedBoons: usedBoons.map((x) => x.boon),
    remainingBoons,
    poolPacks,
    poolSingles,
    randomOffset: 0,
    currentBoon: lastBoon?.boon,
  };
}

export async function tryRun<T>(
  impl: BLBBackend,
  state: ReplayState,
  cont: (blb: BLB) => T,
  event?:
    | { type: "choice"; key: string }
    | { type: "pack"; packId: string; for: string },
): Promise<{ state: ReplayState; result?: T }> {
  const originalState = state;
  const originalEvent = event;
  const packContents = new Map<string, string[]>();
  do {
    try {
      state = originalState;
      event = originalEvent;
      const result = cont({
        get lastBoon() {
          return state.usedBoons[state.usedBoons.length - 1];
        },
        get lastLastBoon() {
          return state.usedBoons[state.usedBoons.length - 2];
        },
        animal: impl.animal,
        random() {
          const ret = randomImpl(
            impl.playerRandomSeed,
            state.remainingBoons.length,
            state.randomOffset,
          );
          state = { ...state, randomOffset: state.randomOffset + 1 };
          return ret;
        },
        trashPack(pack: Pack) {
          const log = state.pastPlayerLogs[state.playerLogIndex];
          if (!log) {
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, "trash"],
              newTrashLogs: [...state.newTrashLogs, `add ${pack.id}`],
            };
          } else if (log === "trash") {
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
          } else {
            throw new Error("! Expected log 'trash' but found " + log);
          }
        },
        getTrashedPacks() {
          const log = state.pastPlayerLogs[state.playerLogIndex];
          const allTrash = state.newTrashLogs.length
            ? [...state.pastTrashLogs, ...state.newTrashLogs]
            : state.pastTrashLogs;
          if (!log) {
            state = {
              ...state,
              newPlayerLogs: [
                ...state.newPlayerLogs,
                `sawTrash ${allTrash.length}`,
              ],
            };
            return replayTrash(allTrash, allTrash.length);
          } else if (log.startsWith("sawTrash ")) {
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
            const num = +log.split(" ")[1];
            return replayTrash(allTrash, num);
          } else {
            throw new Error("! Expected log 'sawTrash' but found " + log);
          }
        },
        generatePack(set: string) {
          const reqLog = state.pastPlayerLogs[state.playerLogIndex];
          let mid;
          if (!reqLog) {
            const isCube = /[A-Z][a-z]/.test(set);
            return throwStuck(
              impl.requestPack(isCube ? `!cube ${set}` : `!${set}`)
                .then((mid) => ({
                  ...state,
                  newPlayerLogs: [...state.newPlayerLogs, `requestPack ${mid}`],
                })),
            );
          } else if (reqLog.startsWith("requestPack ")) {
            mid = reqLog.split(" ")[1];
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
          } else {
            throw new Error("! Expected log 'requestPack' but found " + reqLog);
          }
          const respLog = state.pastPlayerLogs[state.playerLogIndex];
          if (!respLog) {
            // TODO track do-nothing stucks?
            if (event?.type === "pack") {
              if (event.for !== mid) { // ignore
                console.log(
                  `Ignoring pack ${event.packId} meant for ${event.for} not ${mid}`,
                );
                return throwStuck(Promise.resolve(state));
              }
              state = {
                ...state,
                newPlayerLogs: [
                  ...state.newPlayerLogs,
                  "gotPack " + event.packId,
                ],
              };
              const ret = { id: event.packId };
              event = undefined;
              return ret;
            } else {
              return throwStuck(Promise.resolve(state));
            }
          } else if (respLog.startsWith("gotPack ")) {
            const packId = respLog.split(" ")[1];
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
            return { id: packId }; // TODO
          } else {
            throw new Error("! Expected log 'gotPack' but found " + respLog);
          }
        },
        pickFromTrash(pack: Pack) {
          const log = state.pastPlayerLogs[state.playerLogIndex];
          const allTrashLogs = state.newTrashLogs.length
            ? [...state.pastTrashLogs, ...state.newTrashLogs]
            : state.pastTrashLogs;
          if (!log) {
            const trash = replayTrash(allTrashLogs, allTrashLogs.length);
            const isInTrash = trash.some((x) => x.id === pack.id);
            state = {
              ...state,
              newPlayerLogs: [
                ...state.newPlayerLogs,
                "trash " + allTrashLogs.length,
              ],
              newTrashLogs: [...state.newTrashLogs, "remove " + pack.id],
            };
            return isInTrash;
          } else if (log.startsWith("trash ")) {
            const size = +log.split(" ")[1];
            const trash = replayTrash(allTrashLogs, size);
            const isInTrash = trash.some((x) => x.id === pack.id);
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
            return isInTrash;
          } else {
            throw new Error("! Expected log 'trash' but found " + log);
          }
        },
        tell(message: string) {
          const log = state.pastPlayerLogs[state.playerLogIndex];
          if (!log) {
            // TODO we want to _keep going_ after telling, hmmm...
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, "tell"],
              messages: [...state.messages, message],
            };
            return;
          } else if (log === "tell") {
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
          } else {
            throw new Error("! Expected log 'tell' but found " + log);
          }
        },
        finish(message: string) {
          const hasFinished = state.pastPlayerLogs.includes("finished") ||
            state.newPlayerLogs.includes("finished");
          if (!hasFinished) {
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, "finished"],
              messages: [...state.messages, message],
            };
          }
          return;
        },
        choose<T>(choices: { text: string; key: string; value: T }[]) {
          if (!choices.length) throw new Error("No choice available!");
          const askLog = state.pastPlayerLogs[state.playerLogIndex];
          if (!askLog) {
            const message = choices.map((x) =>
              "`!choose " + x.key + "`" + ": " + x.text
            ).join("\n");
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, "ask"],
              messages: [...state.messages, message],
            };
          } else if (askLog === "ask") {
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
          } else {
            throw new Error("! Expected log 'ask' but found " + askLog);
          }
          const ansLog = state.pastPlayerLogs[state.playerLogIndex];
          if (!ansLog) {
            // TODO track no-progress stuck?
            if (event?.type === "choice") {
              const key = event.key;
              const ret = choices.find((x) =>
                x.key.toLowerCase() === key.toLowerCase()
              );
              event = undefined;
              if (ret === undefined) {
                const message = "Sorry, `" + key +
                  "` isn't a valid choice. Choices are:\n" +
                  choices.map((x) => "`!choose " + x.key + "`" + ": " + x.text)
                    .join("\n");
                return throwStuck(
                  Promise.resolve({
                    ...state,
                    messages: [...state.messages, message],
                  }),
                );
              }
              state = {
                ...state,
                newPlayerLogs: [...state.newPlayerLogs, `chose ${ret.key}`],
              };
              return ret.value;
            }
            return throwStuck(Promise.resolve(state));
          } else if (ansLog.startsWith("chose ")) {
            state = { ...state, playerLogIndex: state.playerLogIndex + 1 };
            return choices.find((x) => ansLog === "chose " + x.key)!.value;
          } else {
            throw new Error("! Expected log 'chose' but found " + ansLog);
          }
        },
        addToPool(...packs: Pack[]) {
          if (!packs.length) return;
          // doesn't techincally need to be logged, but allows bypassing the bot when it breaks
          const log = state.pastPlayerLogs[state.playerLogIndex];
          const newLog = "pack " + packs.map((x) => x.id).join(" ");
          if (!log) {
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, newLog],
              poolPacks: [...state.poolPacks, ...packs.map((x) => x.id)],
            };
          } else if (log === newLog) {
            state = {
              ...state,
              playerLogIndex: state.playerLogIndex + 1,
              poolPacks: [...state.poolPacks, ...packs.map((x) => x.id)],
            };
          } else {
            throw new Error("! Expected log 'pack' but found " + log);
          }
        },
        addSingles(...cards: readonly string[]) {
          if (!cards.length) return;
          // doesn't techincally need to be logged, but allows bypassing the bot when it breaks
          const log = state.pastPlayerLogs[state.playerLogIndex];
          const newLog = "cards " + cards.join("|");
          if (!log) {
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, newLog],
              poolSingles: [...state.poolSingles, ...cards],
            };
          } else if (log === newLog) {
            state = {
              ...state,
              playerLogIndex: state.playerLogIndex + 1,
              poolSingles: [...state.poolSingles, ...cards],
            };
          } else {
            throw new Error("! Expected log 'cards' but found " + log);
          }
        },
        setSkipBoon(skip: boolean) {
          const old = state.skipBoon;
          state = { ...state, skipBoon: skip };
          return old;
        },
        setExtras(sets: readonly string[]) {
          const old = state.extras;
          state = { ...state, extras: sets };
          return old;
        },
        setNumSeen(num: number) {
          const old = state.numSeen;
          state = { ...state, numSeen: num };
          return old;
        },
        packContents(pack: Pack) {
          const contents = packContents.get(pack.id);
          if (contents) {
            return contents;
          } else {
            return throwRetry(
              impl.readPack(pack.id).then((cards) =>
                void packContents.set(pack.id, cards)
              ),
            );
          }
        },
        isBlbCommon(card: string) {
          return impl.isBlbCommon(card);
        },
        claimBoon(animal: Animal) {
          const log = state.pastPlayerLogs[state.playerLogIndex];
          if (!log) {
            state = {
              ...state,
              newPlayerLogs: [...state.newPlayerLogs, "done " + animal],
              remainingBoons: state.remainingBoons.filter((x) => x !== animal),
              usedBoons: [...state.usedBoons, animal],
              randomOffset: 0,
            };
          } else if (log === "done " + animal) {
            state = {
              ...state,
              playerLogIndex: state.playerLogIndex + 1,
              remainingBoons: state.remainingBoons.filter((x) => x !== animal),
              usedBoons: [...state.usedBoons, animal],
              randomOffset: 0,
            };
          } else {
            throw new Error("! Expected log 'done' but found " + log);
          }
        },
        unclaimedBoons() {
          return state.remainingBoons;
        },
        removeFromPool(pack: Pack) {
          state = {
            ...state,
            poolPacks: state.poolPacks.filter((x) => x !== pack.id),
          };
        },
        startBoon(animal: Animal) {
          state = {
            ...state,
            currentBoon: animal,
          };
        },
      });
      await impl.finish(
        state.newTrashLogs,
        state.newPlayerLogs,
        state.poolPacks,
        state.poolSingles,
        state.messages,
        state.currentBoon,
      );
      return { state, result };
    } catch (e) {
      if (isStuck(e)) {
        console.log("stuck");
        state = await e.later;
        await impl.finish(
          state.newTrashLogs,
          state.newPlayerLogs,
          state.poolPacks,
          state.poolSingles,
          state.messages,
          state.currentBoon,
        );
        return { state };
      }
      if (isRetry(e)) {
        console.log("retry");
        await e.after;
        continue;
      }
      throw e;
    }
  } while (true);
}

export function randomImpl(
  randomSeed: number,
  base: number,
  offset: number,
): number {
  let rng = splitmix32(randomSeed);
  for (let j = 0; j < base; j++) rng();
  rng = splitmix32(rng() * 0x1_0000_0000);
  for (let i = 0; i < offset; i++) {
    rng();
  }
  return rng();
}

function splitmix32(a: number) {
  return function () {
    a |= 0;
    a = a + 0x9e3779b9 | 0;
    let t = a ^ a >>> 15;
    t = Math.imul(t, 0x85ebca6b);
    t = t ^ t >>> 13;
    t = Math.imul(t, 0xc2b2ae35);
    return ((t = t ^ t >>> 16) >>> 0) / 4294967296;
  };
}

function replayTrash(trashLogs: readonly string[], num: number): Pack[] {
  const packs = new Set<string>();
  for (let i = 0; i < num; i++) {
    const [cmd, id] = trashLogs[i].split(" ");
    if (cmd === "add") packs.add(id);
    else if (cmd === "remove") packs.delete(id);
    else throw new Error("! bad trash log: " + trashLogs[i]);
  }
  return [...packs].map((x) => ({ id: x }));
}
