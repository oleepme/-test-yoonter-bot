const {
  ROLE_NEWBIE_ID,
  ROLE_MEMBER_ID,
  ROLE_ELITE_MEMBER_ID,
  ROLE_SENIOR_MEMBER_ID,
  OUT_ROLE_ID,
  ALT_ROLE_ID
} = require("../../config");

let currentWelcomeCount = 0;

function getWelcomeConfig() {
  return {
    ROLE_NEWBIE_ID,
    ROLE_MEMBER_ID,
    ROLE_ELITE_MEMBER_ID,
    ROLE_SENIOR_MEMBER_ID,
    OUT_ROLE_ID,
    ALT_ROLE_ID
  };
}

function hasAnyRole(member, roleIds = []) {
  return roleIds.filter(Boolean).some((roleId) => member.roles?.cache?.has(roleId));
}

function isCountTarget(member, config = getWelcomeConfig()) {
  if (!member || member.user?.bot) return false;

  const includedRoleIds = [
    config.ROLE_NEWBIE_ID,
    config.ROLE_MEMBER_ID,
    config.ROLE_ELITE_MEMBER_ID,
    config.ROLE_SENIOR_MEMBER_ID
  ].filter(Boolean);

  if (!hasAnyRole(member, includedRoleIds)) return false;
  if (config.OUT_ROLE_ID && member.roles?.cache?.has(config.OUT_ROLE_ID)) return false;
  if (config.ALT_ROLE_ID && member.roles?.cache?.has(config.ALT_ROLE_ID)) return false;

  return true;
}

async function initWelcomeCount(guild, config = getWelcomeConfig()) {
  await guild.members.fetch();

  currentWelcomeCount = [...guild.members.cache.values()].filter((member) =>
    isCountTarget(member, config)
  ).length;

  console.log("WELCOME_COUNT_INIT", currentWelcomeCount);
  return currentWelcomeCount;
}

function getWelcomeCount() {
  return currentWelcomeCount;
}

function setWelcomeCount(nextCount) {
  currentWelcomeCount = Math.max(0, nextCount);
  return currentWelcomeCount;
}

function countDelta(oldIncluded, newIncluded) {
  if (oldIncluded && !newIncluded) return -1;
  if (!oldIncluded && newIncluded) return 1;
  return 0;
}

function detectWelcomeUpdateType(oldMember, newMember, config = getWelcomeConfig()) {
  const hadOut = config.OUT_ROLE_ID ? oldMember.roles.cache.has(config.OUT_ROLE_ID) : false;
  const hasOut = config.OUT_ROLE_ID ? newMember.roles.cache.has(config.OUT_ROLE_ID) : false;

  const hadAlt = config.ALT_ROLE_ID ? oldMember.roles.cache.has(config.ALT_ROLE_ID) : false;
  const hasAlt = config.ALT_ROLE_ID ? newMember.roles.cache.has(config.ALT_ROLE_ID) : false;

  if (!hadOut && hasOut) return "✈ 외출";
  if (hadOut && !hasOut) return "🏠 복귀";
  if (!hadAlt && hasAlt) return "👥 부계정";
  if (hadAlt && !hasAlt) return "👥 부계정 해제";

  const oldIncluded = isCountTarget(oldMember, config);
  const newIncluded = isCountTarget(newMember, config);

  // 포함 역할이 처음 붙는 순간만 로그
  if (!oldIncluded && newIncluded) return "🏷 역할부여";

  // 입장카운트 제외 로그는 더 이상 쓰지 않음
  return null;
}

module.exports = {
  getWelcomeConfig,
  hasAnyRole,
  isCountTarget,
  initWelcomeCount,
  getWelcomeCount,
  setWelcomeCount,
  countDelta,
  detectWelcomeUpdateType
};