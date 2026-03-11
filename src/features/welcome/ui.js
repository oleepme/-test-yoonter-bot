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

function getProfileLink(memberLike) {
  if (!memberLike?.id) return "(알 수 없음)";
  return `[프로필 보기](https://discord.com/users/${memberLike.id})`;
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
  const profileLink = getProfileLink(memberLike);
  const roleNames = getLiveRoleNames(memberLike);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(
      [
        `## **${title}** (${beforeCount} → ${afterCount})`,
        `**닉네임:** ${nickname}`,
        `**아이디:** ${username}`,
        `**프로필:** ${profileLink}`,
        `\`${roleNames}\``,
      ].join("\n")
    )
    .setTimestamp();
}

module.exports = {
  buildWelcomeEmbed,
};