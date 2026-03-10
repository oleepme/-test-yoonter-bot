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
  },
  {
    key: "PUBG",
    channelId: PUBG_BOARD_CHANNEL_ID,
    boardTitle: "🪖 배그 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "배그",
    mentionRoleId: ROLE_PUBG_ID,
  },
  {
    key: "VALO",
    channelId: VALO_BOARD_CHANNEL_ID,
    boardTitle: "👣 발로란트 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "발로란트",
    mentionRoleId: ROLE_VALO_ID,
  },
  {
    key: "OW",
    channelId: OW_BOARD_CHANNEL_ID,
    boardTitle: "🔫 오버워치 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "오버워치",
    mentionRoleId: ROLE_OW_ID,
  },
  {
    key: "STEAM",
    channelId: STEAM_BOARD_CHANNEL_ID,
    boardTitle: "🕹️ 스팀게임 구인하기",
    allowedKinds: ["GAME"],
    createButtonLabel: "게임파티 만들기",
    partyPrefix: "스팀",
    // 스팀은 제목 입력값으로 [스팀] 게임명 형태로 두고,
    // 역할 멘션은 제목 앞머리 키워드 또는 운영 규칙으로 추후 확장 가능.
    mentionRoleByTitle: [
      { includes: "공포", roleId: ROLE_STEAM_HORROR_ID },
      { includes: "협동", roleId: ROLE_STEAM_COOP_ID },
      { includes: "오픈월드", roleId: ROLE_STEAM_OPENWORLD_ID },
    ],
  },
  {
    key: "ETC",
    channelId: ETC_BOARD_CHANNEL_ID,
    boardTitle: "🥰 기타게임 구인하기",
    allowedKinds: ["GAME", "MUSIC", "CHAT", "MOVIE"],
    createButtonLabel: null,
    partyPrefix: "기타",
    mentionRoleId: "",
  },
].filter((x) => x.channelId);

function getBoardConfigByChannelId(channelId) {
  return BOARD_CONFIGS.find((x) => x.channelId === channelId) ?? null;
}

function getAllBoardConfigs() {
  return BOARD_CONFIGS;
}

function getMentionRoleId(config, title = "") {
  if (!config) return "";
  if (config.mentionRoleId) return config.mentionRoleId;

  const text = String(title || "");
  if (Array.isArray(config.mentionRoleByTitle)) {
    const found = config.mentionRoleByTitle.find((x) => text.includes(x.includes) && x.roleId);
    return found?.roleId || "";
  }

  return "";
}

function buildDisplayTitle(config, title, kind) {
  const clean = String(title || "").trim() || "(제목없음)";

  if (!config) return clean;

  if (config.key === "ETC") {
    if (kind === "MUSIC") return `[기타-노래] ${clean}`;
    if (kind === "CHAT") return `[기타-수다] ${clean}`;
    if (kind === "MOVIE") return `[기타-영화] ${clean}`;
    return `[기타-게임] ${clean}`;
  }

  return `[${config.partyPrefix}] ${clean}`;
}

module.exports = {
  getBoardConfigByChannelId,
  getAllBoardConfigs,
  getMentionRoleId,
  buildDisplayTitle,
};