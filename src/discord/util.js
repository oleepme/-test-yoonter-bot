function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function safeTrim(s) {
  return (s ?? "").toString().trim();
}

function hasAnyRole(member, roleIds = []) {
  return roleIds.filter(Boolean).some((roleId) => member.roles?.cache?.has(roleId));
}

function isCountTarget(member, config) {
  if (!member || member.user?.bot) return false;

  const includedRoleIds = [
    config.ROLE_NEWBIE_ID,
    config.ROLE_MEMBER_ID,
    config.ROLE_ELITE_MEMBER_ID,
    config.ROLE_SENIOR_MEMBER_ID
  ].filter(Boolean);

  const hasIncludedRole = hasAnyRole(member, includedRoleIds);
  if (!hasIncludedRole) return false;

  if (config.OUT_ROLE_ID && member.roles?.cache?.has(config.OUT_ROLE_ID)) return false;
  if (config.ALT_ROLE_ID && member.roles?.cache?.has(config.ALT_ROLE_ID)) return false;

  return true;
}

async function countIncludedMembers(guild, config) {
  await guild.members.fetch();

  let count = 0;
  for (const [, member] of guild.members.cache) {
    if (isCountTarget(member, config)) count += 1;
  }
  return count;
}

function getDisplayName(memberLike) {
  return (
    memberLike?.displayName ||
    memberLike?.nickname ||
    memberLike?.user?.globalName ||
    memberLike?.user?.username ||
    "알 수 없음"
  );
}

function getRoleNamesForLog(memberLike) {
  const roleNames = memberLike?.roles?.cache
    ? memberLike.roles.cache
        .filter((role) => role.name !== "@everyone")
        .map((role) => role.name)
    : [];

  return roleNames.length ? roleNames.join(" · ") : "역할 없음";
}

module.exports = {
  nowUnix,
  safeTrim,
  hasAnyRole,
  isCountTarget,
  countIncludedMembers,
  getDisplayName,
  getRoleNamesForLog
};
