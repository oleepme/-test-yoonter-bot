const { initDb } = require("../db");
const { registerCommands } = require("../discord/registerCommands");
const { ensurePinnedMessage } = require("../discord/pins");
const {
  GUILD_ID,
  PARTY_BOARD_CHANNEL_ID,
  NICK_HELP_CHANNEL_ID,
  ENABLE_NICK,
  ENABLE_PARTY,
  ENABLE_WELCOME
} = require("../config");
const { partyBoardEmbed, partyBoardComponents } = require("../party/ui");
const { nicknameBoardComponents } = require("../features/nickname/ui");
const { initWelcomeFeature } = require("../features/welcome/handler");

async function onReady(client) {
  try {
    await initDb();
    console.log("DB_OK");
  } catch (e) {
    console.error("DB_INIT_FAIL", e);
  }

  console.log(`🤖 Logged in as ${client.user.tag}`);

  await registerCommands();

  const guild = await client.guilds.fetch(GUILD_ID);

  if (ENABLE_WELCOME) {
    await initWelcomeFeature(guild);
  }

  if (ENABLE_PARTY) {
    const board = await guild.channels.fetch(PARTY_BOARD_CHANNEL_ID).catch(() => null);
    if (board?.isTextBased()) {
      await ensurePinnedMessage(board, "DDG|partyboard|v1", () => ({
        embeds: [partyBoardEmbed()],
        components: partyBoardComponents()
      }));
    }
  }

  if (ENABLE_NICK && NICK_HELP_CHANNEL_ID) {
    const nickCh = await guild.channels.fetch(NICK_HELP_CHANNEL_ID).catch(() => null);
    if (nickCh?.isTextBased()) {
      await ensurePinnedMessage(nickCh, "DDG|nickboard|v1", () => ({
        embeds: [{
          title: "🪪 닉네임 설정",
          description: "아래 버튼으로 서버 별명을 변경합니다.",
          footer: { text: "DDG|nickboard|v1" }
        }],
        components: nicknameBoardComponents()
      }));
    }
  }
}

module.exports = { onReady };
