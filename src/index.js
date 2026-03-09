// src/index.js
const { initDb } = require("./db");

const http = require("http");
const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
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

// ✅ 카카오 TXT import/rebuild/reset (기존 기능과 분리)
const {
  handleKakaoImport,
  handleKakaoRebuild,
  handleKakaoClear
} = require("./features/kakao/handler");

console.log("BOOT_OK");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// (A) 더미 웹 서버 (Railway 헬스용)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end("OK"); })
  .listen(PORT, () => console.log(`🌐 Dummy web server running on port ${PORT}`));

async function ensurePinnedMessage(channel, footerText, payloadBuilder) {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  if (pins?.find(m => m.embeds?.[0]?.footer?.text === footerText)) return;

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});
}

// =========================
// ✅ Member export (CSV)
// =========================
function csvEscape(value) {
  const s = (value ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const header = ["userId", "username", "nickname", "roles", "joinedAt", "isBot"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      csvEscape(r.userId),
      csvEscape(r.username),
      csvEscape(r.nickname),
      csvEscape(r.roles),
      csvEscape(r.joinedAt),
      csvEscape(r.isBot)
    ].join(","));
  }
  return "\uFEFF" + lines.join("\n");
}

// ✅ included export에서 쓰는 제외 규칙
function isCountExcluded(member) {
  if (!member) return true;
  if (member.user?.bot) return true;

  const OUT_ROLE_ID = process.env.OUT_ROLE_ID || "";
  const ALT_ROLE_ID = process.env.ALT_ROLE_ID || "";

  if (OUT_ROLE_ID && member.roles?.cache?.has?.(OUT_ROLE_ID)) return true;
  if (ALT_ROLE_ID && member.roles?.cache?.has?.(ALT_ROLE_ID)) return true;

  return false;
}

initDb()
  .then(() => console.log("DB_OK"))
  .catch((e) => {
    console.error("DB_INIT_FAIL", e);
    process.exit(1);
  });

client.once("ready", async () => {
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

client.on("interactionCreate", async (interaction) => {
  try {
    // ✅ 카카오 import/rebuild/reset (처리되면 바로 return: 기존 기능 침범 방지)
    if (await handleKakaoImport(interaction)) return;
    if (await handleKakaoRebuild(interaction)) return;
    if (await handleKakaoClear(interaction)) return;

    // 슬래시
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    }

    // ✅ 멤버 내보내기
    if (interaction.isChatInputCommand() && interaction.commandName === "member_export") {
      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("길드 정보를 찾지 못했습니다.");
        return;
      }

      const members = await guild.members.fetch();
      const rows = members.map((m) => {
        const roles = m.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => r.name)
          .join("|");

        return {
          userId: `\t${m.user.id}`,
          username: m.user.username,
          nickname: m.nickname ?? "",
          roles,
          joinedAt: m.joinedAt ? m.joinedAt.toISOString() : "",
          isBot: m.user.bot ? "true" : "false",
        };
      });

      const csv = toCsv(rows);
      const filename = `member_export_${guild.id}_${Date.now()}.csv`;
      const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: filename });

      await interaction.editReply({
        content: `✅ 멤버 ${rows.length}명 CSV 내보내기 완료`,
        files: [file],
      });
      return;
    }

    // ✅ 인원 카운트 포함(included) 멤버만 내보내기
    if (interaction.isChatInputCommand() && interaction.commandName === "included_members_export") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("길드 정보를 찾지 못했습니다.").catch(() => {});
        return;
      }

      // 멤버 전체 fetch (캐시 미스 방지)
      const members = await guild.members.fetch();

      // included만 필터
      const included = members.filter((m) => !isCountExcluded(m));

      const rows = included.map((m) => {
        const roles = m.roles.cache
          .filter((r) => r.name !== "@everyone")
          .map((r) => r.name)
          .join("|");

        return {
          // ✅ Excel 과학표기/정밀도 손실 방지: 텍스트로 강제
          userId: `\t${m.user.id}`,
          username: m.user.username,
          nickname: m.nickname ?? "",
          roles,
          joinedAt: m.joinedAt ? m.joinedAt.toISOString() : "",
          isBot: m.user.bot ? "TRUE" : "FALSE",
          excludedReason: "",
        };
      });

      const csv = toCsv(rows);
      const filename = `included_members_export_${guild.id}_${Date.now()}.csv`;
      const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: filename });

      await interaction.editReply({
        content: `✅ included 멤버 ${rows.length}명 CSV 내보내기 완료 (제외: 봇/외출/부계)`,
        files: [file],
      }).catch(() => {});
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
        await interaction.reply({ content: "⚠️ 오류가 발생했습니다. 로그 채널을 확인하세요.", ephemeral: true });
      } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);