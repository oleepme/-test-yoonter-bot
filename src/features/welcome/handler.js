const {
  WELCOME_BOARD_CHANNEL_ID,
  ENABLE_WELCOME
} = require("../../config");

const { buildWelcomeEmbed } = require("./ui");
const {
  getWelcomeConfig,
  isCountTarget,
  initWelcomeCount,
  getWelcomeCount,
  setWelcomeCount,
  countDelta,
  detectWelcomeUpdateType
} = require("./service");

const TRACKED_WELCOME_TITLES = new Set([
  "⭕ 입장",
  "❌ 퇴장",
  "✈ 외출",
  "🏠 복귀",
  "🏷 역할부여",
  "👥 부계정",
  "👥 부계정 해제",
]);

function getWelcomeChannel(guild) {
  return guild.channels.fetch(WELCOME_BOARD_CHANNEL_ID).catch(() => null);
}

async function sendWelcomeCountLog(guild, title, beforeCount, afterCount, memberLike) {
  if (!ENABLE_WELCOME) return;
  if (!WELCOME_BOARD_CHANNEL_ID) return;

  const channel = await getWelcomeChannel(guild);
  if (!channel?.isTextBased()) {
    console.error("WELCOME_CHANNEL_INVALID");
    return;
  }

  const embed = buildWelcomeEmbed({
    title,
    beforeCount,
    afterCount,
    memberLike
  });

  await channel.send({
    embeds: [embed]
  }).catch((e) => {
    console.error("WELCOME_LOG_SEND_FAIL", e);
  });
}

function parseEmbedHeader(description = "") {
  const firstLine = (description || "").split("\n")[0] || "";
  const m = firstLine.match(/^## \*\*(.+?)\*\* \((\d+) → (\d+)\)$/);
  if (!m) return null;

  return {
    title: m[1],
    beforeCount: Number(m[2]),
    afterCount: Number(m[3]),
  };
}

function embedContainsUserId(embed, userId) {
  const desc = embed?.description || "";
  return desc.includes(String(userId));
}

async function refreshTrackedWelcomeEmbeds(guild, memberLike) {
  if (!ENABLE_WELCOME) return;
  if (!WELCOME_BOARD_CHANNEL_ID) return;
  if (!memberLike?.id) return;

  const channel = await getWelcomeChannel(guild);
  if (!channel?.isTextBased()) return;

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return;

  const botId = guild.client.user?.id;

  for (const msg of recent.values()) {
    if (msg.author?.id !== botId) continue;
    const embed = msg.embeds?.[0];
    if (!embed) continue;
    if (!embedContainsUserId(embed, memberLike.id)) continue;

    const parsed = parseEmbedHeader(embed.description || "");
    if (!parsed) continue;
    if (!TRACKED_WELCOME_TITLES.has(parsed.title)) continue;

    const nextEmbed = buildWelcomeEmbed({
      title: parsed.title,
      beforeCount: parsed.beforeCount,
      afterCount: parsed.afterCount,
      memberLike,
    });

    await msg.edit({ embeds: [nextEmbed] }).catch((e) => {
      console.error("WELCOME_EDIT_FAIL", e);
    });
  }
}

async function initWelcomeFeature(guild) {
  if (!ENABLE_WELCOME) return;

  const config = getWelcomeConfig();
  await initWelcomeCount(guild, config);
}

function bindWelcomeEvents(client) {
  client.on("guildMemberAdd", async (member) => {
    if (!ENABLE_WELCOME) return;

    try {
      const config = getWelcomeConfig();
      const included = isCountTarget(member, config);

      const beforeCount = getWelcomeCount();
      const afterCount = included ? beforeCount + 1 : beforeCount;

      setWelcomeCount(afterCount);
      await sendWelcomeCountLog(member.guild, "⭕ 입장", beforeCount, afterCount, member);
    } catch (e) {
      console.error("WELCOME_ADD_EVENT_FAIL", e);
    }
  });

  client.on("guildMemberRemove", async (member) => {
    if (!ENABLE_WELCOME) return;

    try {
      const config = getWelcomeConfig();
      const included = isCountTarget(member, config);

      const beforeCount = getWelcomeCount();
      const afterCount = included ? Math.max(0, beforeCount - 1) : beforeCount;

      setWelcomeCount(afterCount);
      await sendWelcomeCountLog(member.guild, "❌ 퇴장", beforeCount, afterCount, member);
    } catch (e) {
      console.error("WELCOME_REMOVE_EVENT_FAIL", e);
    }
  });

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    if (!ENABLE_WELCOME) return;

    try {
      const config = getWelcomeConfig();

      // 닉네임 / 아이디 / 역할 실시간 반영
      const displayNameChanged = oldMember.displayName !== newMember.displayName;
      const usernameChanged = oldMember.user?.username !== newMember.user?.username;
      const rolesChanged =
        oldMember.roles.cache.size !== newMember.roles.cache.size ||
        [...oldMember.roles.cache.keys()].some((id) => !newMember.roles.cache.has(id)) ||
        [...newMember.roles.cache.keys()].some((id) => !oldMember.roles.cache.has(id));

      if (displayNameChanged || usernameChanged || rolesChanged) {
        await refreshTrackedWelcomeEmbeds(newMember.guild, newMember);
      }

      const title = detectWelcomeUpdateType(oldMember, newMember, config);
      if (!title) return;

      const oldIncluded = isCountTarget(oldMember, config);
      const newIncluded = isCountTarget(newMember, config);
      const delta = countDelta(oldIncluded, newIncluded);

      const beforeCount = getWelcomeCount();
      const afterCount = Math.max(0, beforeCount + delta);

      setWelcomeCount(afterCount);
      await sendWelcomeCountLog(newMember.guild, title, beforeCount, afterCount, newMember);
    } catch (e) {
      console.error("WELCOME_UPDATE_EVENT_FAIL", e);
    }
  });
}

module.exports = {
  initWelcomeFeature,
  bindWelcomeEvents
};