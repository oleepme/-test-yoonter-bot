// src/config.js
function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function opt(name, fallback = "") {
  return process.env[name] ?? fallback;
}

module.exports = {
  DISCORD_TOKEN: req("DISCORD_TOKEN"),
  CLIENT_ID: req("CLIENT_ID"),
  GUILD_ID: req("GUILD_ID"),

  PARTY_BOARD_CHANNEL_ID: req("PARTY_BOARD_CHANNEL_ID"),

  // ✅ 로그 채널 분리(기존 유지)
  PARTY_LOG_CHANNEL_ID: opt("PARTY_LOG_CHANNEL_ID"),
  NICK_LOG_CHANNEL_ID: opt("NICK_LOG_CHANNEL_ID"),
  SECRET_LOG_CHANNEL_ID: opt("SECRET_LOG_CHANNEL_ID"),

  // 역할 표기용 (둘 중 하나 없으면 표기 생략 가능하게 opt)
  ROLE_NEWBIE_ID: opt("ROLE_NEWBIE_ID"),
  ROLE_MEMBER_ID: opt("ROLE_MEMBER_ID"),

  // 닉네임 도움 메시지 채널(선택)
  NICK_HELP_CHANNEL_ID: opt("NICK_HELP_CHANNEL_ID"),

  // ✅ 입퇴장/상태변경(외출/복귀/부계정) 로그 채널
  WELCOME_BOARD_CHANNEL_ID: opt("WELCOME_BOARD_CHANNEL_ID"),

  // ✅ 카운트 제외 역할
  ALT_ROLE_ID: opt("ALT_ROLE_ID"), // 부계
  OUT_ROLE_ID: opt("OUT_ROLE_ID"), // 외출

  ENABLE_NICK: opt("ENABLE_NICK", "true") === "true",
  ENABLE_PARTY: opt("ENABLE_PARTY", "true") === "true",

  // ✅ 입퇴장 로그 기능 on/off (기본 true)
  ENABLE_WELCOME: opt("ENABLE_WELCOME", "true") === "true",

  // ✅ 유저별 최근 로그 메시지 저장 개수 (닉변 시 edit 대상)
  MEMBER_LOG_KEEP: Number(opt("MEMBER_LOG_KEEP", "30")) || 30,

  // ✅ 카카오 입/퇴장 요약 게시판 채널 (TXT import 결과를 올릴 곳)
  KAKAO_LOG_CHANNEL_ID: opt("KAKAO_LOG_CHANNEL_ID"),

  // ✅ 카카오 TXT import 업로드 전용 채널 (여기서만 /kakao_import 허용)
  KAKAO_IMPORT_CHANNEL_ID: opt("KAKAO_IMPORT_CHANNEL_ID"),

};
