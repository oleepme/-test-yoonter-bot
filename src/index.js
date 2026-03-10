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

// Railway 헬스 체크용
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  })
  .listen(PORT, () => console.log(`🌐 Dummy web server running on port ${PORT}`));

function hasCustomId(message, customId) {
  return (message.components ?? []).some((row) =>
    (row.components ?? []).some((component) => component.customId === customId)
  );
}

async function ensurePinnedMessage(channel, matcher, payloadBuilder) {
  // 1) pinned 메시지 먼저 검색
  const pins = await channel.messages.fetchPins().catch((e) => {
    console.error("PIN_FETCH_FAIL", e);
    return null;
  });

  const pinnedMatch = pins?.find((m) => matcher(m));
  if (pinnedMatch) {
    console.log("PIN_REUSED", {
      channelId: channel.id,
      source: "pins",
      messageId: pinnedMatch.id
    });
    return pinnedMatch;
  }

  // 2) 최근 메시지 검색
  const recentMessages = await channel.messages.fetch({ limit: 30 }).catch((e) => {
    console.error("RECENT_FETCH_FAIL", e);
    return null;
  });

  const recentMatch = recentMessages?.find((m) => matcher(m));
  if (recentMatch) {
    console.log("PIN_REUSED", {
      channelId: channel.id,
      source: "recent",
      messageId: recentMatch.id
    });

    await recentMatch.pin().catch((e) => {
      console.error("PIN_REAPPLY_FAIL", e);
    });

    return recentMatch;
  }

  // 3) 진짜 없을 때만 새 생성
  const payload = payloadBuilder();
  const msg = await channel.send(payload).catch((e) => {
    console.error("PIN_MESSAGE_SEND_FAIL", e);
    return null;
  });

  if (!msg) return null;

  await msg.pin().catch((e) => {
    console.error("PIN_CREATE_FAIL", e);
  });

  console.log("PIN_CREATED", {
    channelId: channel.id,
    messageId: msg.id
  });

  return msg;
}

async function onReady() {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  await registerCommands();

  const guild = await client.guilds.fetch(GUILD_ID);

  // welcome 초기 카운트
  await initWelcomeFeature(guild);

  // 파티 현황판 고정 메시지 보장
  if (ENABLE_PARTY && PARTY_BOARD_CHANNEL_ID) {
    const board = await guild.channels.fetch(PARTY_BOARD_CHANNEL_ID).catch((e) => {
      console.error("PARTY_BOARD_FETCH_FAIL", e);
      return null;
    });

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
    } else {
      console.error("PARTY_BOARD_INVALID");
    }
  }

  // 닉네임 안내 고정 메시지 보장
  if (ENABLE_NICK && NICK_HELP_CHANNEL_ID) {
    const nickCh = await guild.channels.fetch(NICK_HELP_CHANNEL_ID).catch((e) => {
      console.error("NICK_HELP_CHANNEL_FETCH_FAIL", e);
      return null;
    });

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
          embeds: [
            {
              title: "🪪 닉네임 설정",
              description: "아래 버튼으로 서버 별명을 변경합니다."
            }
          ],
          components: nicknameBoardComponents()
        })
      );
    } else {
      console.error("NICK_HELP_CHANNEL_INVALID");
    }
  }
}

client.once("clientReady", async () => {
  try {
    await onReady();
  } catch (e) {
    console.error("READY_FAIL", e);
  }
});

// welcome 이벤트 바인딩
bindWelcomeEvents(client);

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    }

    if (ENABLE_NICK) {
      const handled = await handleNickname(interaction);
      if (handled) return;
    }

    if (ENABLE_PARTY) {
      const handled = await handleParty(interaction);
      if (handled) return;
    }
  } catch (e) {
    console.error("INTERACTION_FAIL", e);

    if (interaction.isRepliable()) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "⚠️ 오류가 발생했습니다. 로그를 확인해주세요.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "⚠️ 오류가 발생했습니다. 로그를 확인해주세요.",
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error("INTERACTION_ERROR_REPLY_FAIL", replyError);
      }
    }
  }
});

initDb()
  .then(() => {
    console.log("DB_OK");
    return client.login(DISCORD_TOKEN);
  })
  .catch((e) => {
    console.error("BOOT_FAIL", e);
    process.exit(1);
  });