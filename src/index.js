const { initDb } = require("./db");

const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { registerCommands } = require("./discord/registerCommands");
const {
  DISCORD_TOKEN,
  GUILD_ID,
  NICK_HELP_CHANNEL_ID,
  ENABLE_NICK
} = require("./config");

const { nicknameBoardComponents } = require("./features/nickname/ui");
const { handleNickname } = require("./features/nickname/handler");
const { handleParty } = require("./party/handler");
const { initWelcomeFeature, bindWelcomeEvents } = require("./features/welcome/handler");
const { getAllBoardConfigs } = require("./party/channelConfig");
const { buildBoardEmbed, buildBoardComponents } = require("./party/ui");

console.log("BOOT_OK");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

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

function normalizeMessages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw.values === "function") return [...raw.values()];
  return [];
}

async function ensurePinnedMessage(channel, matcher, payloadBuilder) {
  // 1) pinned 메시지 먼저 검색
  const pinsRaw = await channel.messages.fetchPins().catch((e) => {
    console.error("PIN_FETCH_FAIL", e);
    return null;
  });

  const pins = normalizeMessages(pinsRaw);
  const pinnedMatch = pins.find((m) => matcher(m));

  if (pinnedMatch) {
    console.log("PIN_REUSED", {
      channelId: channel.id,
      source: "pins",
      messageId: pinnedMatch.id
    });
    return pinnedMatch;
  }

  // 2) 최근 메시지 검색
  const recentRaw = await channel.messages.fetch({ limit: 50 }).catch((e) => {
    console.error("RECENT_FETCH_FAIL", e);
    return null;
  });

  const recentMessages = normalizeMessages(recentRaw);
  const recentMatch = recentMessages.find((m) => matcher(m));

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

  await initWelcomeFeature(guild);

  // 게임별 파티 게시판 고정 메시지 보장
  for (const config of getAllBoardConfigs()) {
    const board = await guild.channels.fetch(config.channelId).catch((e) => {
      console.error("PARTY_BOARD_FETCH_FAIL", config.channelId, e);
      return null;
    });

    if (!board?.isTextBased()) {
      console.error("PARTY_BOARD_INVALID", config.channelId);
      continue;
    }

    await ensurePinnedMessage(
      board,
      (message) => {
        const embed = message.embeds?.[0];
        return (
          embed?.title === config.boardTitle &&
          hasCustomId(message, "party:create")
        );
      },
      () => ({
        embeds: [buildBoardEmbed(config)],
        components: buildBoardComponents(config)
      })
    );
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

    {
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