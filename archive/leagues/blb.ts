import { sheets } from "./sheets.ts";

// BLB league live-coding, or something

export const ANIMALS = [
  "Bat",
  "Bird",
  "Frog",
  "Lizard",
  "Mouse",
  "Otter",
  "Rabbit",
  "Raccoon",
  "Rat",
  "Squirrel",
] as const;

export const EXPLORER_SETS = [
  "BLB",
  "MKM",
  "LCI",
  "WOE",
  "MOM",
  "ONE",
  "BRO",
  "DMU",
  "SNC",
  "NEO",
  "VOW",
  "MID",
  "AFR",
  "STX",
  "KHM",
  "ZNR",
  "M21",
  "IKO",
  "THB",
  "ELD",
  "M20",
  "WAR",
  "RNA",
  "GRN",
  "M19",
  "DOM",
  "RIX",
  "XLN",
  "KTK",
  "SIR",
  "AKR",
  "KLR",
];

export type Animal = typeof ANIMALS[number];

export type ConfigKey =
  | "SHEET_ID"
  | "STANDINGS_SHEET_NAME"
  | "MATCHES_SHEET_NAME"
  | "ENTROPY_SHEET_NAME"
  | "LOG_SHEET_NAME"
  | "POOL_SHEET_NAME"
  | "AGL_GUILD_ID"
  | "BOT_BUNKER_CHANNEL_ID"
  | "PACK_GENERATION_CHANNEL_ID"
  | "LC_ONLY"
  | "BLB_PACKGEN_BROKEN"
  | "MESSAGE_FIRST_LOSS"
  | "MESSAGE_ELIMINATED"
  | "MESSAGE_SURVIVED"
  | "MESSAGE_BAT_DESCRIPTION"
  | "MESSAGE_BAT_CHOICE"
  | "MESSAGE_BAT_INTRO"
  | "MESSAGE_BAT_NEXT"
  | "MESSAGE_BIRD_DESCRIPTION"
  | "MESSAGE_BIRD_CHOICE"
  | "MESSAGE_BIRD_INTRO"
  | "MESSAGE_BIRD_NEXT"
  | "MESSAGE_FROG_DESCRIPTION"
  | "MESSAGE_FROG_CHOICE"
  | "MESSAGE_FROG_INTRO"
  | "MESSAGE_FROG_NEXT"
  | "MESSAGE_FROG_NEXT_NEXT"
  | "MESSAGE_LIZARD_DESCRIPTION"
  | "MESSAGE_LIZARD_CHOICE"
  | "MESSAGE_LIZARD_INTRO"
  | "MESSAGE_LIZARD_NEXT"
  | "MESSAGE_MOUSE_DESCRIPTION"
  | "MESSAGE_MOUSE_CHOICE"
  | "MESSAGE_MOUSE_INTRO"
  | "MESSAGE_MOUSE_NEXT"
  | "MESSAGE_OTTER_DESCRIPTION"
  | "MESSAGE_OTTER_CHOICE"
  | "MESSAGE_OTTER_INTRO"
  | "MESSAGE_OTTER_NEXT"
  | "MESSAGE_RABBIT_DESCRIPTION"
  | "MESSAGE_RABBIT_CHOICE"
  | "MESSAGE_RABBIT_INTRO"
  | "MESSAGE_RABBIT_NEXT"
  | "MESSAGE_RACCOON_DESCRIPTION"
  | "MESSAGE_RACCOON_CHOICE"
  | "MESSAGE_RACCOON_INTRO"
  | "MESSAGE_RACCOON_NEXT"
  | "MESSAGE_RAT_DESCRIPTION"
  | "MESSAGE_RAT_CHOICE"
  | "MESSAGE_RAT_INTRO"
  | "MESSAGE_RAT_NEXT"
  | "MESSAGE_SQUIRREL_DESCRIPTION"
  | "MESSAGE_SQUIRREL_CHOICE"
  | "MESSAGE_SQUIRREL_INTRO"
  | "MESSAGE_SQUIRREL_BLB"
  | "MESSAGE_SQUIRREL_ELD"
  | "MESSAGE_SQUIRREL_NEXT_BLB"
  | "MESSAGE_SQUIRREL_NEXT_ELD"
  | "BIRD_ACTION"
  | "RAT_ACTION"
  | "LIZARD_ACTION"
  | "RACCOON_ACTION"
  | "RABBIT_ACTION"
  | "BAT_ACTION"
  | "OTTER_ACTION"
  | "SQUIRREL_ACTION"
  | "MOUSE_ACTION"
  | "FROG_ACTION"
  | "BIRD_ANIMAL"
  | "BIRD_MOTION"
  | "BIRD_TALK"
  | "BIRD_FEATURE"
  | "BIRD_PLANE"
  | "RAT_ANIMAL"
  | "RAT_MOTION"
  | "RAT_TALK"
  | "RAT_FEATURE"
  | "RAT_PLANE"
  | "LIZARD_ANIMAL"
  | "LIZARD_MOTION"
  | "LIZARD_TALK"
  | "LIZARD_FEATURE"
  | "LIZARD_PLANE"
  | "RACCOON_ANIMAL"
  | "RACCOON_MOTION"
  | "RACCOON_TALK"
  | "RACCOON_FEATURE"
  | "RACCOON_PLANE"
  | "RABBIT_ANIMAL"
  | "RABBIT_MOTION"
  | "RABBIT_TALK"
  | "RABBIT_FEATURE"
  | "RABBIT_PLANE"
  | "BAT_ANIMAL"
  | "BAT_MOTION"
  | "BAT_TALK"
  | "BAT_FEATURE"
  | "BAT_PLANE"
  | "OTTER_ANIMAL"
  | "OTTER_MOTION"
  | "OTTER_TALK"
  | "OTTER_FEATURE"
  | "OTTER_PLANE"
  | "SQUIRREL_ANIMAL"
  | "SQUIRREL_MOTION"
  | "SQUIRREL_TALK"
  | "SQUIRREL_FEATURE"
  | "SQUIRREL_PLANE"
  | "MOUSE_ANIMAL"
  | "MOUSE_MOTION"
  | "MOUSE_TALK"
  | "MOUSE_FEATURE"
  | "MOUSE_PLANE"
  | "FROG_ANIMAL"
  | "FROG_MOTION"
  | "FROG_TALK"
  | "FROG_FEATURE"
  | "FROG_PLANE";

export const blbConfig = new Map<ConfigKey, string>();

await refreshConfig();

function capitalize(s: string) {
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function template(
  key: ConfigKey,
  animal: Animal,
  set?: string,
  cards?: string[],
) {
  const a = animal.toUpperCase() as Uppercase<Animal>;
  const content = blbConfig.get(key)!;
  if (!content) throw new Error("No config value for " + key);
  return content.replace(/\[([^\]]+)\](?!\()/g, (s, x: string): string => {
    switch (x.toLowerCase()) {
      case "talk word":
        return blbConfig.get(`${a}_TALK`)!;
      case "a talk word": {
        const word = blbConfig.get(`${a}_TALK`);
        if (/^[aeiouAEIOU]/.test(word!)) return "an " + word;
        else return "a " + word;
      }
      case "motion word":
        return blbConfig.get(`${a}_MOTION`)!;
      case "feature":
        return blbConfig.get(`${a}_FEATURE`)!.replace("(a) ", "");
      case "a feature":
        return capitalize(blbConfig.get(`${a}_FEATURE`)!.replace("(a) ", "a"));
      case "animal":
        return blbConfig.get(`${a}_ANIMAL`)!;
      case "action":
        return blbConfig.get(`${a}_ACTION`)!;
      case "plane":
        return blbConfig.get(`${a}_PLANE`)!;
      case "set":
        return set ?? s;
      case "card 1":
        return cards?.[0] ?? s;
      case "card 2":
        return cards?.[1] ?? s;
      default:
        return s;
    }
  });
}

// How to track trashed packs? Discord message IDs? Pack contents replicated somewhere? Something else...?
// For now assume it's the full pack.

export type Pack = { id: string };
export type TrashedPack = Pack;

export type BLB = {
  readonly lastLastBoon: Animal | undefined;
  readonly lastBoon: Animal | undefined;
  random(): number;
  readonly animal: Animal;
  trashPack(pack: TrashedPack): void;
  getTrashedPacks(): readonly TrashedPack[];
  generatePack(set: string): Pack;
  pickFromTrash(pack: TrashedPack): boolean;
  tell(message: string): void;
  finish(message: string): void;
  choose<T>(choices: { text: string; key: string; value: T }[]): T;
  addToPool(...packs: Pack[]): void;
  packContents(pack: Pack): string[];
  addSingles(...cards: string[]): void;
  setSkipBoon(skip: boolean): boolean;
  setExtras(sets: readonly string[]): readonly string[];
  setNumSeen(num: number): number;
  isBlbCommon(card: string): boolean;
  startBoon(animal: Animal): void;
  claimBoon(animal: Animal): void;
  unclaimedBoons(): readonly Animal[];
  removeFromPool(pack: Pack): void;
};

// Rat boon: Scavenge: Open BLB + WOE. Take one, trash one.
function scavenge(impl: BLB) {
  const [blbPack, woePack] = [
    impl.generatePack("BLB"),
    impl.generatePack("WOE"),
  ];
  impl.tell(template("MESSAGE_RAT_INTRO", impl.animal));
  const choice = impl.choose(
    [blbPack, woePack].map((x, i) => ({
      text: "https://sealeddeck.tech/" + x.id + "\n```\n" +
        impl.packContents(x).join("\n") + "\n```",
      value: x,
      key: i ? "WOE" : "BLB",
    })),
  );
  const notChosen = choice === blbPack ? woePack : blbPack;
  impl.addToPool(choice);
  impl.trashPack(notChosen);
}

// Squirrel boon: Stash: BLB now or BLB + ELD later.
function stash(impl: BLB) {
  impl.tell(template("MESSAGE_SQUIRREL_INTRO", impl.animal));
  const choseNow = impl.choose([{
    text: "Bloomburrow now",
    key: "BLB",
    value: true,
  }, {
    text: "Bloomburrow and Thrones of Eldraine later",
    key: "ELD",
    value: false,
  }]);
  if (choseNow) {
    impl.tell(template("MESSAGE_SQUIRREL_BLB", impl.animal));
    impl.addToPool(impl.generatePack("BLB"));
  } else {
    impl.tell(template("MESSAGE_SQUIRREL_ELD", impl.animal));
    impl.setExtras(["BLB", "ELD"]);
  }
}

// Frog boon: Leap Ahead: BLB + Explorer, skip next boon
function leapAhead(
  impl: BLB,
  set: string,
) {
  impl.tell(template("MESSAGE_FROG_INTRO", impl.animal, set));
  const packs = [
    impl.generatePack("BLB"),
    impl.generatePack(set),
  ];
  impl.addToPool(...packs);
  impl.setSkipBoon(true);
}

// Rabbit boon: Multiply: BLB + dupe a common
function multiply(impl: BLB) {
  const pack = impl.generatePack("BLB");
  const cards = impl.packContents(pack);
  const commons = cards.filter(impl.isBlbCommon);
  impl.addToPool(pack);
  impl.tell(template("MESSAGE_RABBIT_INTRO", impl.animal));
  const choice = impl.choose(
    commons.map((c) => ({ text: c, key: c, value: c })),
  );
  impl.addSingles(choice);
}

// Raccoon boon: Trash: Choose from 3 trash packs
// TODO this has inter-player state! Be careful when writing implementation!
function trash(impl: BLB) {
  const trashedPacks = shuffle(impl, [...impl.getTrashedPacks()]);
  impl.tell(
    template("MESSAGE_RACCOON_INTRO", impl.animal),
  );

  do {
    const choice = impl.choose(
      trashedPacks.slice(0, 3).map((x) => ({
        text: "https://sealeddeck.tech/" + x.id + "\n```\n" +
          impl.packContents(x).join("\n") + "\n```",
        key: x.id,
        value: x,
      })),
    );

    const success = impl.pickFromTrash(choice);
    if (success) {
      impl.addToPool(choice);
      return;
    }
    impl.tell(
      /* TODO flavor */ "Sorry, that pack was already taken. Replacing it....",
    );

    const i = trashedPacks.indexOf(choice);
    trashedPacks[i] = trashedPacks[trashedPacks.length - 1];
    trashedPacks.length--;

    // TODO what if there are no trashed packs left? The horror!
  } while (true);
}

// Bat boon: Cave Exploration: LCI + 2 maps
function caveExploration(impl: BLB) {
  impl.tell(template("MESSAGE_BAT_INTRO", impl.animal));
  impl.addToPool(impl.generatePack("LCI"));
  // map tokens are derived from history (i.e. from bat not being an available boon)
}

// Mouse boon: Tiny Might: BLB + tiny heroes
function tinyMight(impl: BLB) {
  addSetAndSheet(impl, "BLB", "Mouse", "TinyMight");
}

// Bird boon: Bird's Eye View: BLB + next choice from all
function birdsEyeView(impl: BLB) {
  impl.tell(template("MESSAGE_BIRD_INTRO", impl.animal));
  impl.addToPool(impl.generatePack("BLB"));
  impl.setNumSeen(9);
}

// Otter boon: Spellchase: BLB + Animal Arcana
function spellchase(impl: BLB) {
  addSetAndSheet(impl, "BLB", "Otter", "AnimalArcana");
}

// Lizard boon: Desert Survival: BLB + deserts
function desertSurvival(impl: BLB) {
  addSetAndSheet(impl, "OTJ", "Lizard", "DesertSurvival");
}

function addSetAndSheet(
  impl: BLB,
  set: string,
  boon: Animal,
  bonusSheet: string,
) {
  const cards = impl.packContents(impl.generatePack(bonusSheet));
  impl.tell(
    template(
      `MESSAGE_${boon.toUpperCase()}_INTRO` as `MESSAGE_${Uppercase<
        Animal
      >}_INTRO`,
      impl.animal,
      undefined,
      cards,
    ),
  );
  impl.addToPool(impl.generatePack(set));
  impl.addSingles(...cards);
}

export function onLoss(impl: BLB, realWins: number, realLosses: number) {
  console.info("hmmm", realWins, realLosses);
  if (realLosses >= 11) {
    console.info("you lose");
    impl.finish(template("MESSAGE_ELIMINATED", impl.animal));
    return;
  } else if (realWins + realLosses >= 30) {
    console.info("you win");
    const extras = impl.setExtras([]);
    const message = victoryMessage(impl, extras);
    impl.finish(message);
    return;
  }
  const boons = shuffle(impl, [...impl.unclaimedBoons()]);
  const numToSee = impl.setNumSeen(3);
  const skip = impl.setSkipBoon(false);
  const extras = impl.setExtras([]);

  impl.addToPool(...extras.map(impl.generatePack));

  const trashAvailable = (impl.getTrashedPacks()).length >= 7 ||
    boons.length === 1;
  if (!trashAvailable) {
    boons.splice(boons.indexOf("Raccoon"), 1);
  }

  const choices = boons.slice(0, numToSee);

  const frogSet = EXPLORER_SETS[impl.random() * EXPLORER_SETS.length | 0];

  // TODO ... set up NEXT_BLB, NEXT_ELD, NEXT_NEXT based on prev (& prev prev) animals
  const message = getPromptMessage(impl, extras);

  impl.tell(message);

  const choice = impl.choose(
    choices.map((x) => ({
      text: template(
        `MESSAGE_${x.toUpperCase()}_CHOICE` as ConfigKey,
        impl.animal,
        frogSet,
      ) + "\n" +
        template(
          `MESSAGE_${x.toUpperCase()}_DESCRIPTION` as ConfigKey,
          impl.animal,
        ),
      key: x,
      value: x,
    })),
  );

  const options = {
    "Bat": () => caveExploration(impl),
    "Bird": () => birdsEyeView(impl),
    "Frog": () => leapAhead(impl, frogSet),
    "Lizard": () => desertSurvival(impl),
    "Mouse": () => tinyMight(impl),
    "Otter": () => spellchase(impl),
    "Rabbit": () => multiply(impl),
    "Raccoon": () => trash(impl),
    "Rat": () => scavenge(impl),
    "Squirrel": () => stash(impl),
  };

  impl.startBoon(choice);

  if (!skip) {
    options[choice]();
  } else {
    impl.tell(
      "*Skipping " + choice + ". You won't receive any pack or bonus.*",
    );
  }

  impl.claimBoon(choice);
}

export function victoryMessage(impl: BLB, extras: readonly string[]) {
  return getPromptMessage(impl, extras).replace(
    / Which boon would you like.*/,
    "",
  ).replace(/ What will you do.*$/m, "") +
    "\n\n" + template("MESSAGE_SURVIVED", impl.animal);
}

function getPromptMessage(impl: BLB, extras: readonly string[]) {
  let message;
  if (impl.lastBoon) {
    if (impl.lastLastBoon === "Frog") {
      message = template("MESSAGE_FROG_NEXT_NEXT", impl.animal);
    } else if (impl.lastBoon === "Squirrel") {
      message = template(
        extras.length
          ? "MESSAGE_SQUIRREL_NEXT_ELD"
          : "MESSAGE_SQUIRREL_NEXT_BLB",
        impl.animal,
      );
    } else {
      const a = impl.lastBoon.toUpperCase() as Uppercase<typeof impl.lastBoon>;
      message = template(`MESSAGE_${a}_NEXT`, impl.animal);
    }
  } else {
    message = template("MESSAGE_FIRST_LOSS", impl.animal);
  }
  return message;
}

export function onReroll(impl: BLB, pack: Pack) {
  const newPack = impl.generatePack("explorer");
  impl.removeFromPool(pack);
  impl.trashPack(pack);
  impl.addToPool(newPack);
}

// Fisher-Yates shuffle, in place
function shuffle<T>(impl: BLB, items: T[]): T[] {
  for (let i = 0; i < items.length; i++) {
    const j = i + (impl.random() * (items.length - i) | 0);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function refreshConfig() {
  await go();
  setInterval(go, 300_000);

  async function go() {
    try {
      const data = await sheets.spreadsheetsValuesGet(
        "BLB!A2:B",
        "1CMTmYnmfDCOzZEF7ibTNesV-4RRRiOAkl92rM9hRd0M",
      );
      blbConfig.clear();
      for (const [k, v] of data.values!) {
        blbConfig.set(k, v);
      }
      // deno-lint-ignore no-empty
    } catch (_e) {}
  }
}
