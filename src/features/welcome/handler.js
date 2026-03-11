// src/features/welcome/handler.js
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

const {
  upsertMemberProfile,
  createWelcomeSession,
  getActiveWelcomeSession,
  updateActiveWelcomeSessionIdentity,
  endWelcomeSession,
  insertWelcomeLog,
  getWelcomeLogsBySession,
} = require("../../db");

function getWelcomeChannel(guild) {
  return guild.channels.fetch(WELCOME_BOARD_CHANNEL_ID).catch(() => null);
}

async function sendWelcomeCountLog(guild, title, beforeCount, afterCount, memberLike) {
  if (!ENABLE_WELCOME) return null;
  if (!WELCOME_BOARD_CHANNEL_ID) return null;

  const channel = await getWelcomeChannel(guild);
  if (!channel?.isTextBased()) {
    console.error("WELCOME_CHANNEL_INVALID");
    return null;
  }

  const embed = buildWelcomeEmbed({
    title,
    beforeCount,
    afterCount,
    memberLike
  });

  const sent = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch((e) => {
    console.error("WELCOME_LOG_SEND_FAIL", e);
    return null;
  });

  return sent;
}

async function refreshTrackedWelcomeEmbeds(guild, memberLike) {
  if (!ENABLE_WELCOME) return;
  if (!memberLike?.id) return;

  const activeSession = await getActiveWelcomeSession(guild.id, memberLike.id).catch((e) => {
    console.error("WELCOME_GET_ACTIVE_SESSION_FAIL", e);
    return null;
  });

  if (!activeSession?.session_id) return;

  const logs = await getWelcomeLogsBySession(
    guild.id,
    memberLike.id,
    activeSession.session_id
  ).catch((e) => {
    console.error("WELCOME_GET_SESSION_LOGS_FAIL", e);
    return [];
  });

  if (!logs?.length) return;

  const channelCache = new Map();

  for (const row of logs) {
    try {
      let channel = channelCache.get(row.channel_id);
      if (!channel) {
        channel = await guild.channels.fetch(row.channel_id).catch(() => null);
        if (channel) channelCache.set(row.channel_id, channel);
      }
      if (!channel?.isTextBased()) continue;

      const msg = await channel.messages.fetch(row.message_id).catch(() => null);
      if (!msg) continue;

      const nextEmbed = buildWelcomeEmbed({
        title: row.kind,
        beforeCount: row.before_count,
        afterCount: row.after_count,
        memberLike,
      });

      await msg.edit({
        embeds: [nextEmbed],
        allowedMentions: { parse: [] },
      }).catch((e) => {
        console.error("WELCOME_EDIT_FAIL", e);
      });
    } catch (e) {
      console.error("WELCOME_REFRESH_ONE_FAIL", e);
    }
  }
}

async function logWelcomeEvent({
  guild,
  memberLike,
  title,
  beforeCount,
  afterCount,
  sessionId,
}) {
  const sent = await sendWelcomeCountLog(
    guild,
    title,
    beforeCount,
    afterCount,
    memberLike
  );

  if (!sent) return null;

  await insertWelcomeLog({
    guildId: guild.id,
    userId: memberLike.id,
    sessionId: sessionId || null,
    channelId: sent.channel.id,
    messageId: sent.id,
    kind: title,
    beforeCount,
    afterCount,
  }).catch((e) => {
    console.error("WELCOME_INSERT_LOG_FAIL", e);
  });

  return sent;
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

      const displayName =
        member.displayName ||
        member.nickname ||
        member.user?.globalName ||
        member.user?.username ||
        "";

      const username = member.user?.username || "";

      await upsertMemberProfile(
        member.guild.id,
        member.id,
        displayName,
        username
      ).catch((e) => {
        console.error("WELCOME_PROFILE_UPSERT_FAIL", e);
      });

      const sessionId = await createWelcomeSession(
        member.guild.id,
        member.id,
        displayName,
        username
      ).catch((e) => {
        console.error("WELCOME_CREATE_SESSION_FAIL", e);
        return null;
      });

      await logWelcomeEvent({
        guild: member.guild,
        memberLike: member,
        title: "⭕ 입장",
        beforeCount,
        afterCount,
        sessionId,
      });
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

      const displayName =
        member.displayName ||
        member.nickname ||
        member.user?.globalName ||
        member.user?.username ||
        "";

      const username = member.user?.username || "";

      await upsertMemberProfile(
        member.guild.id,
        member.id,
        displayName,
        username
      ).catch((e) => {
        console.error("WELCOME_PROFILE_UPSERT_FAIL", e);
      });

      const activeSession = await getActiveWelcomeSession(
        member.guild.id,
        member.id
      ).catch((e) => {
        console.error("WELCOME_GET_ACTIVE_SESSION_FAIL", e);
        return null;
      });

      const sessionId = activeSession?.session_id || null;

      await logWelcomeEvent({
        guild: member.guild,
        memberLike: member,
        title: "❌ 퇴장",
        beforeCount,
        afterCount,
        sessionId,
      });

      await endWelcomeSession(member.guild.id, member.id).catch((e) => {
        console.error("WELCOME_END_SESSION_FAIL", e);
      });
    } catch (e) {
      console.error("WELCOME_REMOVE_EVENT_FAIL", e);
    }
  });

  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    if (!ENABLE_WELCOME) return;

    try {
      const config = getWelcomeConfig();

      const displayNameChanged = oldMember.displayName !== newMember.displayName;
      const usernameChanged = oldMember.user?.username !== newMember.user?.username;

      const hadNewbie = config.ROLE_NEWBIE_ID
        ? oldMember.roles.cache.has(config.ROLE_NEWBIE_ID)
        : false;

      const hasNewbie = config.ROLE_NEWBIE_ID
        ? newMember.roles.cache.has(config.ROLE_NEWBIE_ID)
        : false;

      const newbieRoleChanged = hadNewbie !== hasNewbie;

      const displayName =
        newMember.displayName ||
        newMember.nickname ||
        newMember.user?.globalName ||
        newMember.user?.username ||
        "";

      const username = newMember.user?.username || "";

      await upsertMemberProfile(
        newMember.guild.id,
        newMember.id,
        displayName,
        username
      ).catch((e) => {
        console.error("WELCOME_PROFILE_UPSERT_FAIL", e);
      });

      const activeSession = await getActiveWelcomeSession(
        newMember.guild.id,
        newMember.id
      ).catch((e) => {
        console.error("WELCOME_GET_ACTIVE_SESSION_FAIL", e);
        return null;
      });

      // 현재 세션이 있을 때만 현재 identity 동기화
      if (activeSession?.session_id) {
        await updateActiveWelcomeSessionIdentity(
          newMember.guild.id,
          newMember.id,
          displayName,
          username
        ).catch((e) => {
          console.error("WELCOME_UPDATE_SESSION_IDENTITY_FAIL", e);
        });
      }

      // 닉변 / 아이디변경 / 뉴비역할 변화 때만 현재 세션 메시지 갱신
      if ((displayNameChanged || usernameChanged || newbieRoleChanged) && activeSession?.session_id) {
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

      // 혹시 세션이 비어 있으면 안전하게 하나 생성
      let sessionId = activeSession?.session_id || null;
      if (!sessionId) {
        sessionId = await createWelcomeSession(
          newMember.guild.id,
          newMember.id,
          displayName,
          username
        ).catch((e) => {
          console.error("WELCOME_CREATE_SESSION_FAIL", e);
          return null;
        });
      }

      await logWelcomeEvent({
        guild: newMember.guild,
        memberLike: newMember,
        title,
        beforeCount,
        afterCount,
        sessionId,
      });
    } catch (e) {
      console.error("WELCOME_UPDATE_EVENT_FAIL", e);
    }
  });
}

module.exports = {
  initWelcomeFeature,
  bindWelcomeEvents
};