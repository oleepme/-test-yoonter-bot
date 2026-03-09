// src/features/memberExport.js
function csvEscape(value) {
  const s = (value ?? "").toString();
  // CSV 안전 처리: 콤마/따옴표/줄바꿈 포함 시 "..."로 감싸고 내부 "는 ""로
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows) {
  const header = ["userId", "username", "nickname", "roles", "joinedAt", "isBot"];
  const lines = [header.join(",")];

  for (const r of rows) {
    lines.push([
      csvEscape(r.userId),
      csvEscape(r.username),
      csvEscape(r.nickname),
      csvEscape(r.roles),
      csvEscape(r.joinedAt),
      csvEscape(r.isBot),
    ].join(","));
  }

  return "\uFEFF" + lines.join("\n"); // UTF-8 BOM 추가
}

module.exports = { toCsv };
