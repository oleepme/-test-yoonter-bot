// src/discord/log.js
const { EmbedBuilder } = require("discord.js");
const { nowUnix } = require("./util");
const { PARTY_LOG_CHANNEL_ID, NICK_LOG_CHANNEL_ID, SECRET_LOG_CHANNEL_ID } = require("../config");

function pickLogChannelId(type) {
  if (type === "NICK") return NICK_LOG_CHANNEL_ID || SECRET_LOG_CHANNEL_ID;
  return PARTY_LOG_CHANNEL_ID || SECRET_LOG_CHANNEL_ID; // 기본 PARTY
}

async function logEmbed(guild, { type, title, fields = [], color = 0x95a5a6 }) {
  // type 미지정 시 제목/이모지 기반으로 자동 분류(하위호환)
  const inferred = (!type || type === "AUTO")
    ? ((title && (title.includes("닉네임") || title.includes("🪪"))) ? "NICK" : "PARTY")
    : type;

    const channelId = pickLogChannelId(inferred);
  if (!channelId) return;

  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setFooter({ text: `ts=${nowUnix()}` });

  await ch.send({ embeds: [embed] }).catch(() => {});
}

function field(name, value, inline = false) {
  const v = (value ?? "").toString();
  return { name, value: v.length ? v : "(없음)", inline };
}

module.exports = { logEmbed, field };
