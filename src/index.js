const { initDb } = require("./db");

const http = require("http");
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { registerCommands } = require("./discord/registerCommands");
const {
  DISCORD_TOKEN,
  GUILD_ID,
  PARTY_BOARD_CHANNEL_ID,
  NICK_HELP_CHANNEL_ID,
  ENABLE_NICK,
  ENABLE_PARTY,
  ENABLE_WELCOME,
  WELCOME_BOARD_CHANNEL_ID,
  ALT_ROLE_ID,
  OUT_ROLE_ID,
  ROLE_NEWBIE_ID,
  ROLE_MEMBER_ID,
  ROLE_ELITE_MEMBER_ID,
  ROLE_SENIOR_MEMBER_ID,
} = require("./config");

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
  const pins = await channel.messages.fetchPins().catch(() => null);
  if (pins?.find((m) => m.embeds?.[0]?.footer?.text === footerText)) return;

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});
}

// =========================
// Member export (CSV)
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

// included export에서 쓰는 제외 규칙
function isCountExcluded(member) {
  if (!member) return true;
  if (member.user?.bot) return true;

  if (OUT_ROLE_ID && member.roles?.cache?.has?.(OUT_ROLE_ID)) return true;
  if (ALT_ROLE_ID && member.roles?.cache?.has?.(ALT_ROLE_ID)) return true;

  return false;
}

function hasAnyIncludedBaseRole(member) {
  const includedRoleIds = [
    ROLE_NEWBIE_ID,
    ROLE_MEMBER_ID,
    ROLE_ELITE_MEMBER_ID,
    ROLE_SENIOR_MEMBER_ID,
  ].filter(Boolean);

  if (!includedRoleIds.length) return false;
  return includedRoleIds.some((roleId) => member.roles?.cache?.has?.(roleId));
}

function isIncludedCountMember(member) {
  if (!member) return false;
  if (member.user?.bot) return false;
  if (OUT_ROLE_ID && member.roles?.cache?.has?.(OUT_ROLE_ID)) return false;
  if (ALT_ROLE_ID && member.roles?.cache?.has?.(ALT_ROLE_ID)) return false;
  return hasAnyIncludedBaseRole(member);
}

async function calculateVisibleMemberCount(guild) {
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  return members.filter((m) => isIncludedCountMember(m)).size;
}

function getUserLine(member) {
  const displayName = member.displayName || member.nickname || member.user?.displayName || member.user?.username || "알수없음";
  const username = member.user?.username || "unknown";
  return `${displayName} · ${username} (<@${member.id}>)`;
}

function getRoleSummary(member) {
  const lines = [];

  const rolePairs = [
    ROLE_NEWBIE_ID ? [ROLE_NEWBIE_ID, member.guild.roles.cache.get(ROLE_NEWBIE_ID)?.name] : null,
    ROLE_MEMBER_ID ? [ROLE_MEMBER_ID, member.guild.roles.cache.get(ROLE_MEMBER_ID)?.name] : null,
    ROLE_ELITE_MEMBER_ID ? [ROLE_ELITE_MEMBER_ID, member.guild.roles.cache.get(ROLE_ELITE_MEMBER_ID)?.name] : null,
    ROLE_SENIOR_MEMBER_ID ? [ROLE_SENIOR_MEMBER_ID, member.guild.roles.cache.get(ROLE_SENIOR_MEMBER_ID)?.name] : null,
  ].filter(Boolean);

  for (const [roleId, roleName] of rolePairs) {
    if (roleId && member.roles.cache.has(roleId) && roleName) {
      lines.push(roleName);
    }
  }

  if (!lines.length) return "(역할 없음)";
  return `(${lines.join(" · ")})`;
}

async function sendWelcomeEmbed(guild, { title, member, showRoles = true, color = 0x5865f2 }) {
  if (!ENABLE_WELCOME) return;
  if (!WELCOME_BOARD_CHANNEL_ID) return;

  const ch = await guild.channels.fetch(WELCOME_BOARD_CHANNEL_ID).catch(() => null);
  if (!ch?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      showRoles
        ? `${getUserLine(member)}\n${getRoleSummary(member)}`
        : `${getUserLine(member)}`
    );

  await ch.send({ embeds: [embed] }).catch((e) => {
    console.error("[WELCOME_SEND_FAIL]", e?.message || e);
  });
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
// 입퇴장 / 외출 / 복귀 / 부계정
// =========================
client.on("guildMemberAdd", async (member) => {
  try {
    if (!ENABLE_WELCOME) return;
    if (member.guild.id !== GUILD_ID) return;

    const afterCount = await calculateVisibleMemberCount(member.guild);
    const beforeCount = Math.max(0, afterCount - (isIncludedCountMember(member) ? 1 : 0));

    await sendWelcomeEmbed(member.guild, {
      title: `⭕ 입장 (${beforeCount} → ${afterCount})`,
      member,
      showRoles: true,
      color: 0xed4245,
    });
  } catch (e) {
    console.error("[WELCOME_ADD_FAIL]", e?.message || e);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    if (!ENABLE_WELCOME) return;
    if (member.guild.id !== GUILD_ID) return;

    const wasIncluded = isIncludedCountMember(member);
    const afterCount = await calculateVisibleMemberCount(member.guild);
    const beforeCount = wasIncluded ? afterCount + 1 : afterCount;

    await sendWelcomeEmbed(member.guild, {
      title: `❌ 퇴장 (${beforeCount} → ${afterCount})`,
      member,
      showRoles: false,
      color: 0xed4245,
    });
  } catch (e) {
    console.error("[WELCOME_REMOVE_FAIL]", e?.message || e);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (!ENABLE_WELCOME) return;
    if (newMember.guild.id !== GUILD_ID) return;

    const oldOut = OUT_ROLE_ID ? oldMember.roles.cache.has(OUT_ROLE_ID) : false;
    const newOut = OUT_ROLE_ID ? newMember.roles.cache.has(OUT_ROLE_ID) : false;
    const oldAlt = ALT_ROLE_ID ? oldMember.roles.cache.has(ALT_ROLE_ID) : false;
    const newAlt = ALT_ROLE_ID ? newMember.roles.cache.has(ALT_ROLE_ID) : false;

    const oldIncluded = isIncludedCountMember(oldMember);
    const newIncluded = isIncludedCountMember(newMember);
    const nowCount = await calculateVisibleMemberCount(newMember.guild);

    // 외출
    if (!oldOut && newOut) {
      const beforeCount = oldIncluded && !newIncluded ? nowCount + 1 : nowCount;
      const afterCount = nowCount;

      await sendWelcomeEmbed(newMember.guild, {
        title: `✈️ 외출 (${beforeCount} → ${afterCount})`,
        member: newMember,
        showRoles: true,
        color: 0xf1c40f,
      });
      return;
    }

    // 복귀
    if (oldOut && !newOut) {
      const beforeCount = !oldIncluded && newIncluded ? Math.max(0, nowCount - 1) : nowCount;
      const afterCount = nowCount;

      await sendWelcomeEmbed(newMember.guild, {
        title: `🏠 복귀 (${beforeCount} → ${afterCount})`,
        member: newMember,
        showRoles: true,
        color: 0x2ecc71,
      });
      return;
    }

    // 부계정 부여
    if (!oldAlt && newAlt) {
      const beforeCount = oldIncluded && !newIncluded ? nowCount + 1 : nowCount;
      const afterCount = nowCount;

      await sendWelcomeEmbed(newMember.guild, {
        title: `👥 부계정 (${beforeCount} → ${afterCount})`,
        member: newMember,
        showRoles: true,
        color: 0x9b59b6,
      });
      return;
    }

    // 부계정 해제
    if (oldAlt && !newAlt) {
      const beforeCount = !oldIncluded && newIncluded ? Math.max(0, nowCount - 1) : nowCount;
      const afterCount = nowCount;

      await sendWelcomeEmbed(newMember.guild, {
        title: `👥 부계정 해제 (${beforeCount} → ${afterCount})`,
        member: newMember,
        showRoles: true,
        color: 0x95a5a6,
      });
      return;
    }
  } catch (e) {
    console.error("[WELCOME_UPDATE_FAIL]", e?.message || e);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    // 카카오 import/rebuild/reset
    if (await handleKakaoImport(interaction)) return;
    if (await handleKakaoRebuild(interaction)) return;
    if (await handleKakaoClear(interaction)) return;

    // 슬래시
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      await interaction.reply({ content: "pong", ephemeral: true });
      return;
    }

    // 멤버 내보내기
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

    // included 멤버만 내보내기
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