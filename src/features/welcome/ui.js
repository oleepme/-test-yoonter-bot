const { EmbedBuilder } = require("discord.js");
const { getDisplayName, getRoleNamesForLog } = require("../../discord/util");

function buildWelcomeEmbed({ memberLike }) {
  const displayName = getDisplayName(memberLike);
  const username = memberLike?.user?.username ?? "unknown";
  const mention = memberLike?.id ? `<@${memberLike.id}>` : "(알 수 없음)";
  const roleNames = getRoleNamesForLog(memberLike);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .addFields(
      {
        name: "대상",
        value: `**${displayName}** · ${username} · ${mention}`,
        inline: false
      },
      {
        name: "현재 역할",
        value: roleNames,
        inline: false
      }
    )
    .setTimestamp();
}

function buildWelcomeHeadline(title, beforeCount, afterCount) {
  return `# ${title} (${beforeCount} → ${afterCount})`;
}

module.exports = {
  buildWelcomeEmbed,
  buildWelcomeHeadline
};