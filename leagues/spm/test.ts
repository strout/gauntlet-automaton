import { CONFIG } from "../../config.ts";
import { dispatch } from "../../dispatch.ts";
import { DISCORD_TOKEN, makeClient } from "../../main.ts";
import { initSheets } from "../../sheets.ts";
import { sendHeroPack, sendPackChoice, sendVillainPack, setup } from "./mod.ts";

await initSheets();
const client = makeClient();
const { interactionHandlers } = await setup();
client.on("interactionCreate", async (interaction) => {
  const { finish } = await dispatch(interaction, interactionHandlers);
  await finish;
});
client.on("ready", async (client) => {
  const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
  const owner = await guild.members.fetch(CONFIG.OWNER_ID);
  await sendPackChoice(owner, CONFIG.BOT_BUNKER_CHANNEL_ID);
  await sendHeroPack(owner, CONFIG.BOT_BUNKER_CHANNEL_ID);
  await sendVillainPack(owner, CONFIG.BOT_BUNKER_CHANNEL_ID);
});
await client.login(DISCORD_TOKEN);
