import { makeClient, DISCORD_TOKEN } from './main.ts';
import { CONFIG } from './config.ts';
import { buildMoveMessage, buildMapState, readMapState } from './eoe.ts';
import { initSheets } from "./sheets.ts";

await initSheets();

const mapState = await readMapState("18atT4Xd_GdWl8YpX2qjCKNyxJ_MeCvMtJaH9sRQGurw");

const client = makeClient();
client.once('ready', async client => {
  const owner = await client.users.fetch(CONFIG.OWNER_ID);
  await owner.send(buildMoveMessage(mapState, "Ahoy"));
  await owner.send(buildMoveMessage(mapState, "Not-Ahoy"));
  await client.destroy();
  Deno.exit(0);
});

await client.login(DISCORD_TOKEN);
