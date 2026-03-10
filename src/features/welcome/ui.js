const { EmbedBuilder } = require("discord.js");
const { getDisplayName, getRoleNamesForLog } = require("../../discord/util");

function buildWelcomeEmbed({ title, beforeCount, afterCount, memberLike }) {
  const displayName = getDisplayName(memberLike);
  const username = memberLike?.user?.username ?? "unknown";
  const mention = memberLike?.id ? `<@${memberLike.id}>` : "(알 수 없음)";
  const roleNames = getRoleNamesForLog(memberLike);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${title} (${beforeCount} → ${afterCount})`)
    .addFields(
      {
        name: "\u200B",
        value: `**${displayName}** · ${username} · ${mention}\n(${roleNames || "역할 없음"})`,
        inline: false
      }
    )
    .setTimestamp();
}

module.exports = {
  buildWelcomeEmbed
};