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
  ROLE_STEAM_OPENWORLD_ID
} = require("../config");

const BOARD_CONFIGS = [
  {
    channelId: LOL_BOARD_CHANNEL_ID,
    gameKey: "LOL",
    boardTitle: "🏔️ 롤 구인하기",
    createLabel: "게임파티 만들기",
    displayPrefix: "롤",
    subTypes: ["협곡", "증칼", "롤체"],
    mentionRoleId: ROLE_LOL_ID,
    titleInputMode: "none"
  },
  {
    channelId: PUBG_BOARD_CHANNEL_ID,
    gameKey: "PUBG",
    boardTitle: "🪖 배그 구인하기",
    createLabel: "게임파티 만들기",
    displayPrefix: "배그",
    subTypes: ["일반", "경쟁"],
    mentionRoleId: ROLE_PUBG_ID,
    titleInputMode: "none"
  },
  {
    channelId: VALO_BOARD_CHANNEL_ID,
    gameKey: "VALO",
    boardTitle: "👣 발로란트 구인하기",
    createLabel: "게임파티 만들기",
    displayPrefix: "발로란트",
    subTypes: ["일반", "경쟁", "신속"],
    mentionRoleId: ROLE_VALO_ID,
    titleInputMode: "none"
  },
  {
    channelId: OW_BOARD_CHANNEL_ID,
    gameKey: "OW",
    boardTitle: "🔫 오버워치 구인하기",
    createLabel: "게임파티 만들기",
    displayPrefix: "오버워치",
    subTypes: ["빠대", "경쟁"],
    mentionRoleId: ROLE_OW_ID,
    titleInputMode: "none"
  },
  {
    channelId: STEAM_BOARD_CHANNEL_ID,
    gameKey: "STEAM",
    boardTitle: "🕹️ 스팀게임 구인하기",
    createLabel: "게임파티 만들기",
    displayPrefix: "스팀",
    subTypes: ["공포", "협동", "오픈월드"],
    mentionRoleBySubType: {
      "공포": ROLE_STEAM_HORROR_ID,
      "협동": ROLE_STEAM_COOP_ID,
      "오픈월드": ROLE_STEAM_OPENWORLD_ID
    },
    titleInputMode: "gameTitle"
  },
  {
    channelId: ETC_BOARD_CHANNEL_ID,
    gameKey: "ETC",
    boardTitle: "🥰 기타게임 구인하기",
    createLabel: "파티 만들기",
    displayPrefix: "기타",
    subTypes: ["게임", "노래", "수다", "영화"],
    titleInputMode: "freeTitle"
  }
].filter((x) => x.channelId);

function getBoardConfigByChannelId(channelId) {
  return BOARD_CONFIGS.find((x) => x.channelId === channelId) ?? null;
}

function getAllBoardConfigs() {
  return BOARD_CONFIGS;
}

function getMentionRoleId(config, subType) {
  if (!config) return null;
  if (config.mentionRoleId) return config.mentionRoleId;
  if (config.mentionRoleBySubType) return config.mentionRoleBySubType[subType] ?? null;
  return null;
}

function buildPartyDisplayTitle({ config, subType, title }) {
  if (!config) return title || "파티";

  if (config.gameKey === "STEAM") {
    return `[스팀-${subType}] ${title}`;
  }

  if (config.gameKey === "ETC") {
    return `[기타-${subType}] ${title}`;
  }

  return `[${config.displayPrefix}] ${subType}`;
}

module.exports = {
  getBoardConfigByChannelId,
  getAllBoardConfigs,
  getMentionRoleId,
  buildPartyDisplayTitle
};