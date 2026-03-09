// src/discord/registerCommands.js

const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = require("../config");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("봇이 살아있는지 확인합니다.")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("member_export")
    .setDescription("서버 멤버 목록을 CSV로 내보냅니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  // ✅ included 멤버(봇/외출/부계 제외)만 CSV로 내보내기
  new SlashCommandBuilder()
    .setName("included_members_export")
    .setDescription("인원 카운트에 포함된 멤버만 CSV로 내보냅니다. (봇/외출/부계 제외)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  // ✅ 카카오 TXT 업로드 → 입/퇴장만 추출하여 요약 채널에 게시
  new SlashCommandBuilder()
    .setName("kakao_import")
    .setDescription("카카오 대화 백업(TXT)에서 입/퇴장 기록만 추출해 요약 채널에 게시합니다.")
    .addAttachmentOption((opt) =>
      opt
        .setName("file")
        .setDescription("카카오 대화 백업 TXT 파일")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  // ✅ DB에 쌓인 기록을 최신 포맷으로 다시 추가 게시
  new SlashCommandBuilder()
    .setName("kakao_rebuild")
    .setDescription("DB에 저장된 카카오 입/퇴장 기록을 최신 포맷으로 리빌드해 요약 채널에 추가 게시합니다.")
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("최근 며칠을 리빌드할지 (기본 30)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),

  // ✅ 최근 카카오 기록 삭제
  new SlashCommandBuilder()
    .setName("kakao_reset")
    .setDescription("최근 카카오 입/퇴장 기록을 삭제합니다.")
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("최근 며칠치를 삭제할지 (기본 1)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered");
}

module.exports = { registerCommands };