const { initDb } = require("./db");

const http = require("http");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { registerCommands } = require("./discord/registerCommands");
const {
  DISCORD_TOKEN,
  GUILD_ID,
  PARTY_BOARD_CHANNEL_ID,
  NICK_HELP_CHANNEL_ID,
  WELCOME_BOARD_CHANNEL_ID,
  ROLE_NEWBIE_ID,
  ROLE_MEMBER_ID,
  ROLE_ELITE_MEMBER_ID,
  ROLE_SENIOR_MEMBER_ID,
  OUT_ROLE_ID,
  ALT_ROLE_ID,
  ENABLE_NICK,
  ENABLE_PARTY,
  ENABLE_WELCOME
} = require("./config");

const { partyBoardEmbed, partyBoardComponents } = require("./party/ui");
const { nicknameBoardComponents } = require("./features/nickname/ui");
const { handleNickname } = require("./features/nickname/handler");
const { handleParty } = require("./party/handler");
const {
  isCountTarget,
  countIncludedMembers,
  getDisplayName,
  getRoleNamesForLog
} = require("./discord/util");

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

async function ensurePinnedMessage(channel, footerText, payloadBuilder) {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  if (pins?.find((m) => m.embeds?.[0]?.footer?.text === footerText)) return;

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});
}

async function sendWelcomeCountLog(guild, title, beforeCount, afterCount, memberLike) {
  if (!WELCOME_BOARD_CHANNEL_ID) return;

  const channel = await guild.channels.fetch(WELCOME_BOARD_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;

  const displayName = getDisplayName(memberLike);
  const username = memberLike?.user?.username ?? "unknown";
  const mention = memberLike?.id ? `<@${memberLike.id}>` : "(알 수 없음)";
  const roleNames = getRoleNamesForLog(memberLike);

  const embed = new EmbedBuilder()
    .setColor(0x95a5a6)
    .setDescription(
      `**${title} (${beforeCount} → ${afterCount})**\n\n` +
      `${displayName} · ${username} · ${mention}\n` +
      `(${roleNames})`
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch((e) => {
    console.error("WELCOME_LOG_SEND_FAIL", e);
  });
}

client.once("ready", async () => {
  try {
    await initDb();
    console.log("DB_OK");
  } catch (e) {
    console.error("DB_INIT_FAIL", e);
  }

  console.log(`🤖 Logged in as ${client.user.tag}`);

  await registerCommands();

  const guild = await client.guilds.fetch(GUILD_ID);

  // 파티 게시판 핀 보장
  if (ENABLE_PARTY) {
    const board = await guild.channels.fetch(PARTY_BOARD_CHANNEL_ID).catch(() => null);
    if (board?.isTextBased()) {
      await ensurePinnedMessage(board, "DDG|partyboard|v1", () => ({
        embeds: [partyBoardEmbed()],
        components: partyBoardComponents()
      }));
    }
  }

  // 닉네임 도움 핀 보장 (선택)
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
});

// 입장
client.on("guildMemberAdd", async (member) => {
  if (!ENABLE_WELCOME) return;

  try {
    const config = {
      ROLE_NEWBIE_ID,
      ROLE_MEMBER_ID,
      ROLE_ELITE_MEMBER_ID,
      ROLE_SENIOR_MEMBER_ID,
      OUT_ROLE_ID,
      ALT_ROLE_ID
    };

    const afterCount = await countIncludedMembers(member.guild, config);
    const joinedIncluded = isCountTarget(member, config);
    const beforeCount = joinedIncluded ? afterCount - 1 : afterCount;

    await sendWelcomeCountLog(member.guild, "⭕ 입장", beforeCount, afterCount, member);
  } catch (e) {
    console.error("WELCOME_ADD_EVENT_FAIL", e);
  }
});

// 퇴장
client.on("guildMemberRemove", async (member) => {
  if (!ENABLE_WELCOME) return;

  try {
    const config = {
      ROLE_NEWBIE_ID,
      ROLE_MEMBER_ID,
      ROLE_ELITE_MEMBER_ID,
      ROLE_SENIOR_MEMBER_ID,
      OUT_ROLE_ID,
      ALT_ROLE_ID
    };

    const afterCount = await countIncludedMembers(member.guild, config);
    const leftIncluded = isCountTarget(member, config);
    const beforeCount = leftIncluded ? afterCount + 1 : afterCount;

    await sendWelcomeCountLog(member.guild, "❌ 퇴장", beforeCount, afterCount, member);
  } catch (e) {
    console.error("WELCOME_REMOVE_EVENT_FAIL", e);
  }
});

// 외출 / 복귀 / 부계정 지정 / 해제
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!ENABLE_WELCOME) return;

  try {
    const hadOut = OUT_ROLE_ID ? oldMember.roles.cache.has(OUT_ROLE_ID) : false;
    const hasOut = OUT_ROLE_ID ? newMember.roles.cache.has(OUT_ROLE_ID) : false;

    const hadAlt = ALT_ROLE_ID ? oldMember.roles.cache.has(ALT_ROLE_ID) : false;
    const hasAlt = ALT_ROLE_ID ? newMember.roles.cache.has(ALT_ROLE_ID) : false;

    let title = null;

    if (!hadOut && hasOut) {
      title = "✈ 외출";
    } else if (hadOut && !hasOut) {
      title = "🏠 복귀";
    } else if (!hadAlt && hasAlt) {
      title = "👥 부계정";
    } else if (hadAlt && !hasAlt) {
      title = "👥 부계정 해제";
    } else {
      return;
    }

    const config = {
      ROLE_NEWBIE_ID,
      ROLE_MEMBER_ID,
      ROLE_ELITE_MEMBER_ID,
      ROLE_SENIOR_MEMBER_ID,
      OUT_ROLE_ID,
      ALT_ROLE_ID
    };

    const oldIncluded = isCountTarget(oldMember, config);
    const newIncluded = isCountTarget(newMember, config);
    const afterCount = await countIncludedMembers(newMember.guild, config);

    let beforeCount = afterCount;
    if (oldIncluded && !newIncluded) beforeCount = afterCount + 1;
    if (!oldIncluded && newIncluded) beforeCount = afterCount - 1;

    await sendWelcomeCountLog(newMember.guild, title, beforeCount, afterCount, newMember);
  } catch (e) {
    console.error("WELCOME_UPDATE_EVENT_FAIL", e);
  }
});

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
