const {
  ENABLE_WELCOME,
  WELCOME_BOARD_CHANNEL_ID
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

async function sendWelcomeCountLog(guild, title, beforeCount, afterCount, memberLike) {
  if (!ENABLE_WELCOME) return;
  if (!WELCOME_BOARD_CHANNEL_ID) return;

  const channel = await guild.channels.fetch(WELCOME_BOARD_CHANNEL_ID).catch(() => null);
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

  await channel.send({ embeds: [embed] }).catch((e) => {
    console.error("WELCOME_LOG_SEND_FAIL", e);
  });
}

async function initWelcomeFeature(guild) {
  if (!ENABLE_WELCOME) {
    console.log("WELCOME_DISABLED");
    return;
  }

  const config = getWelcomeConfig();
  await initWelcomeCount(guild, config);
}

function bindWelcomeEvents(client) {
  client.on("guildMemberAdd", async (member) => {
    try {
      if (!ENABLE_WELCOME) return;

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
    try {
      if (!ENABLE_WELCOME) return;

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
    try {
      if (!ENABLE_WELCOME) return;

      const config = getWelcomeConfig();
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
