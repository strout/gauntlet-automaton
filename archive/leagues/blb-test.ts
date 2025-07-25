import { discordBackendFor, TEST_USER_ID } from "./blb-backend.ts";
import {
  Animal,
  ANIMALS,
  BLB,
  onLoss,
  onWin,
  Pack,
  TrashedPack,
} from "./blb.ts";
import * as djs from "discord.js";
import { auth, Sheets } from "sheets";
import { load } from "@std/dotenv";
import { fastForward, initState, tryRun } from "./blb-replay.ts";

const env = await load({ export: true });

function makeTestImpl(sharedTrash: undefined | TrashedPack[] = undefined) {
  const boons = [...ANIMALS];
  const trashedPacks = sharedTrash ?? [];
  const poolPacks: Pack[] = [];
  const rerollable: Pack[] = [];
  const singles: string[] = [];
  let skipBoon = false;
  let extras: readonly string[] = [];
  let numSeen = 3;
  let mapTokens = 0;

  const testImpl: BLB & { mapTokens: number } = {
    get mapTokens(): number {
      return mapTokens;
    },
    random: function (): number {
      return Math.random();
    },
    trashPack: function (pack: Pack): void {
      trashedPacks.push(pack);
    },
    getTrashedPacks: function (): readonly Pack[] {
      console.log("Packs in trash:", trashedPacks.length);
      return trashedPacks;
    },
    generatePack: function (set: string): Pack {
      return {
        id: set + "!" + Math.random().toString(),
      };
    },
    packContents(pack: Pack) {
      const [set] = pack.id.split("!");
      return (/[a-z]/.test(set) ? [1, 2] : [1, 2, 3, 4, 5]).map((x) =>
        `${set} card ${x}`
      );
    },
    pickFromTrash: function (pack: Pack): boolean {
      console.log("Removing from trash.");
      const idx = trashedPacks.indexOf(pack);
      if (idx >= 0) trashedPacks.splice(idx, 1);
      else return false;
      return true;
    },
    tell: function (message: string): void {
      console.log("DM >>>", message);
    },
    choose: function <T>(choices: { text: string; value: T }[]): T {
      if (choices.length === 0) throw new Error("Can't choose from nothing!");
      const idx = Math.random() * choices.length | 0;
      console.log(
        "Chose",
        choices[idx].text,
        choices.map((x) => x.text.slice(0, 50)),
      );
      return choices[idx].value;
    },
    addToPool: function (...packs: Pack[]): void {
      if (packs.length) console.log("Adding packs:", ...packs);
      poolPacks.push(...packs);
      rerollable.push(...packs);
    },
    addSingles: function (...cards: string[]): void {
      if (singles.length) console.log("Adding singles:", ...cards);
      singles.push(...cards);
    },
    setSkipBoon: function (skip: boolean): boolean {
      if (skip) console.log("Skipping next boon.");
      let ret;
      [ret, skipBoon] = [skipBoon, skip];
      return ret;
    },
    setExtras: function (sets: readonly string[]): readonly string[] {
      let ret;
      [ret, extras] = [extras, sets];
      return ret;
    },
    setNumSeen: function (num: number): number {
      let ret;
      [ret, numSeen] = [numSeen, num];
      return ret;
    },
    isBlbCommon: function (card: string): boolean {
      return +card.charCodeAt(card.length - 1) > 2;
    },
    unclaimedBoons: function (): readonly Animal[] {
      console.log("Unclaimed boons:", boons.length);
      return boons;
    },
    claimBoon: function (boon: Animal): void {
      const idx = boons.indexOf(boon);
      if (idx >= 0) boons.splice(idx, 1);
    },
    removeFromPool: function (pack: Pack): void {
      const idx = poolPacks.indexOf(pack);
      if (idx >= 0) poolPacks.splice(idx, 1);
    },
  };
  return testImpl;
}

Deno.test("no crash", () => {
  const trash: Pack[] = [];
  const players = Array(80).fill("").map((_) => makeTestImpl(trash));
  console.log(players.length);
  while (players.length) {
    for (let i = players.length; i-- > 0;) {
      const p = players[i];
      // const rerollable = p.getRerollable();
      const unclaimed = p.unclaimedBoons();
      console.log(
        "Next",
        i,
        unclaimed,
        p.mapTokens,
      );
      if (
        unclaimed.length === 0 &&
        (p.mapTokens === 0 /* || rerollable.length === 0 */ ||
          Math.random() < 0.75)
      ) {
        // this player's done
        players.splice(i, 1);
        continue;
      }
      const choices = [() => onWin(p)];
      if (unclaimed.length) choices.push(() => onLoss(p));
      /*
      if (rerollable.length && Math.random() < 0.25) {
        choices.push(() =>
          onReroll(p, rerollable[Math.random() * rerollable.length | 0])
        );
      }
      */
      choices[Math.random() * choices.length | 0]();
    }
  }
});

Deno.test.only("integration", async () => {
  const djs_client = new djs.Client({
    intents: djs.GatewayIntentBits.GuildMembers |
      djs.GatewayIntentBits.DirectMessages |
      djs.GatewayIntentBits.GuildMessages,
    partials: [djs.Partials.Channel /* needed for DMs */],
  });
  djs_client.rest.setToken(env["DISCORD_TOKEN"]);
  const sheets = new Sheets((await auth.getApplicationDefault()).credential);
  const AGL_GUILD_ID = 714554601445130331n;
  const guild = await djs_client.guilds.fetch(`${AGL_GUILD_ID}`);
  const player = await guild.members.fetch(`${TEST_USER_ID}`);
  const backend = await discordBackendFor(sheets, player, 1);
  const state = fastForward(await initState(backend));
  console.log(state);
  console.log(await tryRun(backend, state, (blb) => onLoss(blb)));
  await djs_client.destroy();
});
