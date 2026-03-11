const {
  LOL_BOARD_CHANNEL_ID,
  PUBG_BOARD_CHANNEL_ID,
  VALO_BOARD_CHANNEL_ID,
  OW_BOARD_CHANNEL_ID,
  STEAM_BOARD_CHANNEL_ID,
  ETC_BOARD_CHANNEL_ID,

  ROLE_LOL_ID,
  ROLE_PUBG_ID,
  ROLE_VALO_ID,
  ROLE_OW_ID,
  ROLE_STEAM_HORROR_ID,
  ROLE_STEAM_COOP_ID,
  ROLE_STEAM_OPENWORLD_ID,
  ROLE_ETC_APEX_ID,
  ROLE_ETC_SUDDEN_ID,
  ROLE_ETC_MINECRAFT_ID,
} = require("../config");

const BOARD_CONFIGS = [
  {
    key: "LOL",
    channelId: LOL_BOARD_CHANNEL_ID,
    boardTitle: "🏔️ 롤 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "롤",
    mentionRoleId: ROLE_LOL_ID,
    gameSubKinds: ["협곡", "칼바람", "롤토체스"],
  },
  {
    key: "PUBG",
    channelId: PUBG_BOARD_CHANNEL_ID,
    boardTitle: "🪖 배그 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "배그",
    mentionRoleId: ROLE_PUBG_ID,
    gameSubKinds: ["일반", "경쟁"],
  },
  {
    key: "VALO",
    channelId: VALO_BOARD_CHANNEL_ID,
    boardTitle: "👣 발로란트 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "발로란트",
    mentionRoleId: ROLE_VALO_ID,
    gameSubKinds: ["일반", "경쟁", "신속"],
  },
  {
    key: "OW",
    channelId: OW_BOARD_CHANNEL_ID,
    boardTitle: "🔫 오버워치 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "오버워치",
    mentionRoleId: ROLE_OW_ID,
    gameSubKinds: ["빠대", "경쟁"],
  },
  {
    key: "STEAM",
    channelId: STEAM_BOARD_CHANNEL_ID,
    boardTitle: "🕹️ 스팀게임 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "스팀",
    mentionRoleBySubKind: {
      공포: ROLE_STEAM_HORROR_ID,
      협동: ROLE_STEAM_COOP_ID,
      오픈월드: ROLE_STEAM_OPENWORLD_ID,
    },
    gameSubKinds: ["공포", "협동", "오픈월드"],
    usesCustomGameTitle: true, // 스팀은 실제 게임명 입력
  },
  {
    key: "ETC",
    channelId: ETC_BOARD_CHANNEL_ID,
    boardTitle: "🥰 기타게임 구인하기",
    allowedKinds: ["GAME", "MUSIC", "CHAT", "MOVIE"],
    createButtonLabel: null,
    partyPrefix: "기타",
    mentionRoleId: "",
    mentionRoleBySubKind: {
      에이팩스: ROLE_ETC_APEX_ID,
      서든어택: ROLE_ETC_SUDDEN_ID,
      마인크래프트: ROLE_ETC_MINECRAFT_ID,
    },
    gameSubKinds: ["에이팩스", "서든어택", "마인크래프트", "직접작성"],
    usesCustomGameTitle: true,
  },
].filter((x) => x.channelId);

function getBoardConfigByChannelId(channelId) {
  return BOARD_CONFIGS.find((x) => x.channelId === channelId) ?? null;
}

function getAllBoardConfigs() {
  return BOARD_CONFIGS;
}

function getMentionRoleId(config, subKind = "") {
  if (!config) return "";
  if (config.mentionRoleId) return config.mentionRoleId;

  if (config.mentionRoleBySubKind && subKind) {
    return config.mentionRoleBySubKind[subKind] || "";
  }

  return "";
}

function buildDisplayTitle(config, title, kind, subKind = "") {
  const clean = String(title || "").trim() || "(제목없음)";
  const cleanSubKind = String(subKind || "").trim();

  if (!config) return clean;

  if (config.key === "ETC") {
    if (kind === "GAME") {
      if (cleanSubKind && cleanSubKind !== "직접작성") {
        if (clean && clean !== cleanSubKind) {
          return `[기타] ${cleanSubKind} - ${clean}`;
        }
        return `[기타] ${cleanSubKind}`;
      }
      return `[기타] ${clean}`;
    }

    if (kind === "MUSIC") return `[기타] ${clean}`;
    if (kind === "CHAT") return `[기타] ${clean}`;
    if (kind === "MOVIE") return `[기타] ${clean}`;
    return `[기타] ${clean}`;
  }

  // 일반 게임 게시판: [대분류] 소분류
  if (
    config.key === "LOL" ||
    config.key === "PUBG" ||
    config.key === "VALO" ||
    config.key === "OW"
  ) {
    return `[${config.partyPrefix}] ${cleanSubKind || clean}`;
  }

  // 스팀: [스팀] 게임명
  if (config.key === "STEAM") {
    return `[스팀] ${clean}`;
  }

  return `[${config.partyPrefix}] ${clean}`;
}

module.exports = {
  getBoardConfigByChannelId,
  getAllBoardConfigs,
  getMentionRoleId,
  buildDisplayTitle,
};