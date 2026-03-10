const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { DISCORD_TOKEN } = require("./config");
const { bindEvents } = require("./bootstrap/bindEvents");
const { onReady } = require("./bootstrap/onReady");

console.log("BOOT_OK");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// Railway 헬스체크용 더미 웹 서버
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => console.log(`🌐 Dummy web server running on port ${PORT}`));

client.once("clientReady", async () => {
  try {
    await onReady(client);
  } catch (e) {
    console.error("ON_READY_FAIL", e);
  }
});

bindEvents(client);

client.login(DISCORD_TOKEN);
