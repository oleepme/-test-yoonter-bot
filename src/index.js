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
  ENABLE_PARTY,
  ENABLE_WELCOME,
  ALT_ROLE_ID,
  OUT_ROLE_ID,
  ROLE_NEWBIE_ID,
  ROLE_MEMBER_ID,
} = require("./config");

const { logEmbed, field } = require("./discord/log");

const { partyBoardEmbed, partyBoardComponents } = require("./party/ui");
const { nicknameBoardComponents } = require("./features/nickname/ui");
const { handleNickname } = require("./features/nickname/handler");
const { handleParty } = require("./party/handler");

// ✅ 카카오 TXT import/rebuild/reset
const {
  handleKakaoImport,
  handleKakaoRebuild,
  handleKakaoClear,
} = require("./features/kakao/handler");

console.log("BOOT_OK");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// (A) 더미 웹 서버 (Railway 헬스용)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("OK");
  })
  .listen(PORT, () => console.log(`🌐 Dummy web server running on port ${PORT}`));

async function ensurePinnedMessage(channel, footerText, payloadBuilder) {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  if (pins?.find((m) => m.embeds?.[0]?.footer?.text === footerText)) return;

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
    lines.push(
      [
        csvEscape(r.userId),
        csvEscape(r.username),
        csvEscape(r.nickname),
        csvEscape(r.roles),
        csvEscape(r.joinedAt),
        csvEscape(r.isBot),
      ].join(",")
    );
  }
  return "\uFEFF" + lines.join("\n");
}

// ✅ included export에서 쓰는 제외 규칙
function isCountExcluded(member) {
  if (!member) return true;
  if (member.user?.bot) return true;

  if (OUT_ROLE_ID && member.roles?.cache?.has?.(OUT_ROLE_ID)) return true;
  if (ALT_ROLE_ID && member.roles?.cache?.has?.(ALT_ROLE_ID)) return true;

  return false;
}

function formatRoleMentions(roleIds) {
  const arr = roleIds.filter(Boolean);
  return arr.length ? arr.map((id) => `<@&${id}>`).join(" ") : "(없음)";
}

function formatUserLabel(member) {
  const display = member.displayName || member.user?.displayName || member.user?.username || "알수없음";
  const username = member.user?.username || "unknown";
  return `${display}\n${username}\n<@${member.id}>`;
}

async function writeWelcomeLog(guild, payload) {
  await logEmbed(guild, { type: "WELCOME", ...payload });
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
        components: partyBoardComponents(),
      }));
    }
  }

  // 닉네임 도움 핀 보장
  if (ENABLE_NICK && NICK_HELP_CHANNEL_ID) {
    const nickCh = await guild.channels.fetch(NICK_HELP_CHANNEL_ID).catch(() => null);
    if (nickCh?.isTextBased()) {
      await ensurePinnedMessage(nickCh, "DDG|nickboard|v1", () => ({
        embeds: [
          {
            title: "🪪 닉네임 설정",
            description: "아래 버튼으로 서버 별명을 변경합니다.",
            footer: { text: "DDG|nickboard|v1" },
          },
        ],
        components: nicknameBoardComponents(),
      }));
    }
  }
});

// =========================
// ✅ 입퇴장 / 외출 / 부계정 알림
// =========================
client.on("guildMemberAdd", async (member) => {
  if (!ENABLE_WELCOME) return;
  if (member.guild.id !== GUILD_ID) return;

  const beforeCount = Math.max(0, member.guild.memberCount - 1);
  const afterCount = member.guild.memberCount;

  await writeWelcomeLog(member.guild, {
    title: `입장 (${beforeCount} → ${afterCount})`,
    color: 0x2ecc71,
    fields: [
      field("닉네임 / 계정 / 멘션", formatUserLabel(member)),
      field("역할", formatRoleMentions([ROLE_NEWBIE_ID, ROLE_MEMBER_ID])),
      field("사유", "서버 입장"),
    ],
  });
});

client.on("guildMemberRemove", async (member) => {
  if (!ENABLE_WELCOME) return;
  if (member.guild.id !== GUILD_ID) return;

  const beforeCount = member.guild.memberCount + 1;
  const afterCount = member.guild.memberCount;

  const alt = ALT_ROLE_ID && member.roles?.cache?.has?.(ALT_ROLE_ID);
  const out = OUT_ROLE_ID && member.roles?.cache?.has?.(OUT_ROLE_ID);

  let title = `퇴장 (${beforeCount} → ${afterCount})`;
  if (alt) title = `부계정 (${beforeCount} → ${afterCount})`;
  else if (out) title = `외출 (${beforeCount} → ${afterCount})`;

  await writeWelcomeLog(member.guild, {
    title,
    color: 0xe74c3c,
    fields: [
      field("닉네임 / 계정", `${member.displayName || member.user?.username || "알수없음"}\n${member.user?.username || "unknown"}`),
      field("멘션/ID", `<@${member.id}> / ${member.id}`),
      field(
        "보유 역할",
        [
          alt ? "부계정" : "",
          out ? "외출" : "",
        ]
          .filter(Boolean)
          .join(", ") || "(없음)"
      ),
    ],
  });
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!ENABLE_WELCOME) return;
  if (newMember.guild.id !== GUILD_ID) return;

  const oldAlt = ALT_ROLE_ID ? oldMember.roles.cache.has(ALT_ROLE_ID) : false;
  const newAlt = ALT_ROLE_ID ? newMember.roles.cache.has(ALT_ROLE_ID) : false;
  const oldOut = OUT_ROLE_ID ? oldMember.roles.cache.has(OUT_ROLE_ID) : false;
  const newOut = OUT_ROLE_ID ? newMember.roles.cache.has(OUT_ROLE_ID) : false;

  // 외출 부여
  if (!oldOut && newOut) {
    await writeWelcomeLog(newMember.guild, {
      title: `외출 (${newMember.guild.memberCount} → ${newMember.guild.memberCount})`,
      color: 0xf1c40f,
      fields: [
        field("닉네임 / 계정 / 멘션", formatUserLabel(newMember)),
        field("역할", "<외출>"),
        field("사유", "외출 역할 부여"),
      ],
    });
  }

  // 외출 해제(복귀)
  if (oldOut && !newOut) {
    await writeWelcomeLog(newMember.guild, {
      title: `복귀 (${newMember.guild.memberCount} → ${newMember.guild.memberCount})`,
      color: 0x3498db,
      fields: [
        field("닉네임 / 계정 / 멘션", formatUserLabel(newMember)),
        field("역할", "(외출 해제)"),
        field("사유", "외출 역할 제거"),
      ],
    });
  }

  // 부계정 부여
  if (!oldAlt && newAlt) {
    await writeWelcomeLog(newMember.guild, {
      title: `부계정 (${newMember.guild.memberCount} → ${newMember.guild.memberCount})`,
      color: 0x9b59b6,
      fields: [
        field("닉네임 / 계정 / 멘션", formatUserLabel(newMember)),
        field("역할", "<부계정>"),
        field("사유", "부계정 역할 부여"),
      ],
    });
  }

  // 부계정 해제
  if (oldAlt && !newAlt) {
    await writeWelcomeLog(newMember.guild, {
      title: `부계정 해제 (${newMember.guild.memberCount} → ${newMember.guild.memberCount})`,
      color: 0x95a5a6,
      fields: [
        field("닉네임 / 계정 / 멘션", formatUserLabel(newMember)),
        field("역할", "(부계정 해제)"),
        field("사유", "부계정 역할 제거"),
      ],
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    // ✅ 카카오 import/rebuild/reset
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
        const roles = m.roles.cache.filter((r) => r.name !== "@everyone").map((r) => r.name).join("|");

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

    // ✅ included 멤버만 내보내기
    if (interaction.isChatInputCommand() && interaction.commandName === "included_members_export") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("길드 정보를 찾지 못했습니다.").catch(() => {});
        return;
      }

      const members = await guild.members.fetch();
      const included = members.filter((m) => !isCountExcluded(m));

      const rows = included.map((m) => {
        const roles = m.roles.cache.filter((r) => r.name !== "@everyone").map((r) => r.name).join("|");

        return {
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

      await interaction
        .editReply({
          content: `✅ included 멤버 ${rows.length}명 CSV 내보내기 완료 (제외: 봇/외출/부계)`,
          files: [file],
        })
        .catch(() => {});
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
    console.error(e);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({
          content: "⚠️ 오류가 발생했습니다. 로그 채널을 확인하세요.",
          ephemeral: true,
        });
      } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);