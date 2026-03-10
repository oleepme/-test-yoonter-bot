const { EmbedBuilder } = require("discord.js");

function getLiveNickname(memberLike) {
  return (
    memberLike?.displayName ||
    memberLike?.nickname ||
    memberLike?.user?.globalName ||
    memberLike?.user?.username ||
    "알 수 없음"
  );
}

function getLiveUsername(memberLike) {
  return memberLike?.user?.username || "unknown";
}

function getLiveMention(memberLike) {
  return memberLike?.id ? `<@${memberLike.id}>` : "(알 수 없음)";
}

function getLiveRoleNames(memberLike) {
  const roles = memberLike?.roles?.cache
    ? [...memberLike.roles.cache.values()]
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name)
    : [];

  return roles.length ? roles.join(" · ") : "역할 없음";
}

function buildWelcomeEmbed({ title, beforeCount, afterCount, memberLike }) {
  const nickname = getLiveNickname(memberLike);
  const username = getLiveUsername(memberLike);
  const mention = getLiveMention(memberLike);
  const roleNames = getLiveRoleNames(memberLike);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(
      [
        `## **${title}** (${beforeCount} → ${afterCount})`,
        `**${nickname} · ${username} (${mention})**`,
        `\`${roleNames}\``,
      ].join("\n")
    )
    .setTimestamp();
}

module.exports = {
  buildWelcomeEmbed,
};