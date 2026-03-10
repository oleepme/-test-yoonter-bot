const { initDb } = require("./db");

const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { registerCommands } = require("./discord/registerCommands");
const {
  DISCORD_TOKEN,
  GUILD_ID,
  PARTY_BOARD_CHANNEL_ID,
  NICK_HELP_CHANNEL_ID,
  ENABLE_NICK,
  ENABLE_PARTY
} = require("./config");

const { partyBoardEmbed, partyBoardComponents } = require("./party/ui");
const { nicknameBoardComponents } = require("./features/nickname/ui");
const { handleNickname } = require("./features/nickname/handler");
const { handleParty } = require("./party/handler");
const { initWelcomeFeature, bindWelcomeEvents } = require("./features/welcome/handler");

console.log("BOOT_OK");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// (A) 더미 웹 서버 (Railway 헬스용)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => console.log(`🌐 Dummy web server running on port ${PORT}`));

function hasCustomId(message, customId) {
  return (message.components ?? []).some((row) =>
    (row.components ?? []).some((component) => component.customId === customId)
  );
}

async function ensurePinnedMessage(channel, matcher, payloadBuilder) {
  const pins = await channel.messages.fetchPins().catch(() => null);
  const pinnedMatch = pins?.find((m) => matcher(m));
  if (pinnedMatch) {
    console.log("PIN_REUSED", { channelId: channel.id, source: "pins" });
    return pinnedMatch;
  }

  const recentMessages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const recentMatch = recentMessages?.find((m) => matcher(m));
  if (recentMatch) {
    console.log("PIN_REUSED", { channelId: channel.id, source: "recent" });
    await recentMatch.pin().catch(() => {});
    return recentMatch;
  }

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});
  console.log("PIN_CREATED", { channelId: channel.id, messageId: msg.id });
  return msg;
}

initDb()
  .then(() => console.log("DB_OK"))
  .catch((e) => {
    console.error("DB_INIT_FAIL", e);
    process.exit(1);
  });

client.once("clientReady", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  await registerCommands();

  const guild = await client.guilds.fetch(GUILD_ID);

  // welcome 초기 카운트
  await initWelcomeFeature(guild);

  // 파티 게시판 핀 보장
  if (ENABLE_PARTY) {
    const board = await guild.channels.fetch(PARTY_BOARD_CHANNEL_ID).catch(() => null);
    if (board?.isTextBased()) {
      await ensurePinnedMessage(
        board,
        (message) => {
          const embed = message.embeds?.[0];
          return (
            embed?.title === "📌 파티 현황판" &&
            hasCustomId(message, "party:create")
          );
        },
        () => ({
          embeds: [partyBoardEmbed()],
          components: partyBoardComponents()
        })
      );
    }
  }

  // 닉네임 도움 핀 보장
  if (ENABLE_NICK && NICK_HELP_CHANNEL_ID) {
    const nickCh = await guild.channels.fetch(NICK_HELP_CHANNEL_ID).catch(() => null);
    if (nickCh?.isTextBased()) {
      await ensurePinnedMessage(
        nickCh,
        (message) => {
          const embed = message.embeds?.[0];
          return (
            embed?.title === "🪪 닉네임 설정" &&
            hasCustomId(message, "nick:open")
          );
        },
        () => ({
          embeds: [{
            title: "🪪 닉네임 설정",
            description: "아래 버튼으로 서버 별명을 변경합니다."
          }],
          components: nicknameBoardComponents()
        })
      );
    }
  }
});

bindWelcomeEvents(client);

client.on("interactionCreate", async (interaction) => {
  try {
    // 슬래시
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    }

    // 닉네임
    if (ENABLE_NICK) {
      const handled = await handleNickname(interaction);
      if (handled) return;
    }

    // 파티
    if (ENABLE_PARTY) {
      const handled = await handleParty(interaction);
      if (handled) return;
    }
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({
          content: "⚠️ 오류가 발생했습니다. 로그 채널을 확인하세요.",
          ephemeral: true
        });
      } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);