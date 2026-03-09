// src/discord/log.js
const { EmbedBuilder } = require("discord.js");
const { nowUnix } = require("./util");
const {
  PARTY_LOG_CHANNEL_ID,
  NICK_LOG_CHANNEL_ID,
  SECRET_LOG_CHANNEL_ID,
  WELCOME_BOARD_CHANNEL_ID,
} = require("../config");

function pickLogChannelId(type) {
  if (type === "NICK") return NICK_LOG_CHANNEL_ID || SECRET_LOG_CHANNEL_ID;
  if (type === "WELCOME") return WELCOME_BOARD_CHANNEL_ID || SECRET_LOG_CHANNEL_ID;
  return PARTY_LOG_CHANNEL_ID || SECRET_LOG_CHANNEL_ID; // 기본 PARTY
}

async function logEmbed(guild, { type, title, fields = [], color = 0x95a5a6 }) {
  const inferred =
    !type || type === "AUTO"
      ? title && (title.includes("닉네임") || title.includes("🪪"))
        ? "NICK"
        : "PARTY"
      : type;

  const channelId = pickLogChannelId(inferred);
  if (!channelId) {
    console.warn("[LOG_SKIP] no channel id for type:", inferred, "title:", title);
    return;
  }

  const ch = await guild.channels.fetch(channelId).catch((e) => {
    console.error("[LOG_FETCH_FAIL]", inferred, channelId, e?.message || e);
    return null;
  });

  if (!ch?.isTextBased()) {
    console.warn("[LOG_SKIP] channel is not text based:", inferred, channelId);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setFooter({ text: `ts=${nowUnix()}` });

  await ch.send({ embeds: [embed] }).catch((e) => {
    console.error("[LOG_SEND_FAIL]", inferred, channelId, e?.message || e);
  });
}

function field(name, value, inline = false) {
  const v = (value ?? "").toString();
  return { name, value: v.length ? v : "(없음)", inline };
}

module.exports = { logEmbed, field };