import { delay } from "@std/async/delay";
import { CONFIG, DISCORD_TOKEN, makeClient } from "../main.ts";
import { columnIndex, initSheets, sheets, sheetsAppend } from "../sheets.ts";
import { getCurrentWeek, getPlayers, getPools } from "../standings.ts";

const pretend = confirm("Pretend?");

await using client = makeClient();

await initSheets();
await client.login(DISCORD_TOKEN);
const players = await getPlayers();
const pools = await getPools();
const week = await getCurrentWeek();

for (const player of players) {
  console.log(`Messaging ${player.name} -- <@${player.id}>`);
  if (player.losses >= 11 || player.matchesPlayed >= 30) {
    console.log("they're done");
    continue;
  }
  const poolWeek = +player.row[columnIndex("AD", "A")];
  const { currentPoolLink } = pools.find((x) => x.id === player.id)!;
  console.log(poolWeek, currentPoolLink);
  const hasNewPool = poolWeek > week;

  const message = [
    `**AGL Week 6 will start <t:1738360800:R>!**`,
    hasNewPool
      ? "**Reminder**: bonus sheet cards have been replaced. Your pool for the new week is: " +
        currentPoolLink
      : "**Reminder**: bonus sheet cards will change. You should receive your new pool shortly after the new week begins, or sooner if you complete all your matches this week.",
    `**It's Devotion Week**: Remember, the color identity of your deck and any cards retrieved from your sideboard must be 2 colors or less. I can help you check: choose 'publish' in SealedDeck.tech, then send me a message like \`!deckcheck https://sealeddeck.tech/YourLinkGoesHere\` and I'll double-check the deck size and color identity for you.`,
  ].join("\n");
  console.log(player.name, message);
  if (!pretend) {
    await client.users.send(player.id, message);
    await sheetsAppend(sheets, CONFIG.LIVE_SHEET_ID, "BotStuff!A:C", [[
      player.name,
      week.toString(),
      new Date().toISOString(),
    ]]);
  }

  await delay(1000);
}
console.log("done");
await client.destroy();
