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

  // 기존 단일 파티 게시판 (하위 호환용으로 일단 유지)
  PARTY_BOARD_CHANNEL_ID: opt("PARTY_BOARD_CHANNEL_ID"),

  // 게임별 구인 게시판 채널
  LOL_BOARD_CHANNEL_ID: opt("LOL_BOARD_CHANNEL_ID"),
  PUBG_BOARD_CHANNEL_ID: opt("PUBG_BOARD_CHANNEL_ID"),
  VALO_BOARD_CHANNEL_ID: opt("VALO_BOARD_CHANNEL_ID"),
  OW_BOARD_CHANNEL_ID: opt("OW_BOARD_CHANNEL_ID"),
  STEAM_BOARD_CHANNEL_ID: opt("STEAM_BOARD_CHANNEL_ID"),
  ETC_BOARD_CHANNEL_ID: opt("ETC_BOARD_CHANNEL_ID"),

  // 로그 채널
  PARTY_LOG_CHANNEL_ID: opt("PARTY_LOG_CHANNEL_ID"),
  NICK_LOG_CHANNEL_ID: opt("NICK_LOG_CHANNEL_ID"),
  SECRET_LOG_CHANNEL_ID: opt("SECRET_LOG_CHANNEL_ID"),

  // 입퇴장 카운트 포함 역할
  ROLE_NEWBIE_ID: opt("ROLE_NEWBIE_ID"),
  ROLE_MEMBER_ID: opt("ROLE_MEMBER_ID"),
  ROLE_ELITE_MEMBER_ID: opt("ROLE_ELITE_MEMBER_ID"),
  ROLE_SENIOR_MEMBER_ID: opt("ROLE_SENIOR_MEMBER_ID"),

  // 게임별 멘션 역할
  ROLE_LOL_ID: opt("ROLE_LOL_ID"),
  ROLE_PUBG_ID: opt("ROLE_PUBG_ID"),
  ROLE_VALO_ID: opt("ROLE_VALO_ID"),
  ROLE_OW_ID: opt("ROLE_OW_ID"),

  // 스팀 카테고리별 멘션 역할
  ROLE_STEAM_HORROR_ID: opt("ROLE_STEAM_HORROR_ID"),
  ROLE_STEAM_COOP_ID: opt("ROLE_STEAM_COOP_ID"),
  ROLE_STEAM_OPENWORLD_ID: opt("ROLE_STEAM_OPENWORLD_ID"),

  // 기타게임 세부 카테고리별 멘션 역할
  ROLE_ETC_APEX_ID: opt("ROLE_ETC_APEX_ID"),
  ROLE_ETC_SUDDEN_ID: opt("ROLE_ETC_SUDDEN_ID"),
  ROLE_ETC_MINECRAFT_ID: opt("ROLE_ETC_MINECRAFT_ID"),

  // 닉네임 도움 메시지 채널
  NICK_HELP_CHANNEL_ID: opt("NICK_HELP_CHANNEL_ID"),

  // 입퇴장 알림 채널
  WELCOME_BOARD_CHANNEL_ID: opt("WELCOME_BOARD_CHANNEL_ID"),

  // 카운트 제외 역할
  ALT_ROLE_ID: opt("ALT_ROLE_ID"), // 부계
  OUT_ROLE_ID: opt("OUT_ROLE_ID"), // 외출

  ENABLE_NICK: opt("ENABLE_NICK", "true") === "true",
  ENABLE_PARTY: opt("ENABLE_PARTY", "true") === "true",
  ENABLE_WELCOME: opt("ENABLE_WELCOME", "true") === "true",

  MEMBER_LOG_KEEP: Number(opt("MEMBER_LOG_KEEP", "30")) || 30,

  KAKAO_LOG_CHANNEL_ID: opt("KAKAO_LOG_CHANNEL_ID"),
  KAKAO_IMPORT_CHANNEL_ID: opt("KAKAO_IMPORT_CHANNEL_ID"),
};