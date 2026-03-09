// src/features/kakao/parser.js

const JOIN_WORDS = ["님이 들어왔습니다", "invited to", "초대했습니다"];
const LEAVE_WORDS = ["님이 나갔습니다", "left", "내보냈습니다"];

function normalizeLine(line) {
  return (line ?? "").toString().trim();
}

function parseDateHeader(line) {
  const s = normalizeLine(line);
  // 1. "2025년 8월 22일"
  let m = s.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  
  // 2. "2025. 1. 13." (점 찍힌 날짜 대응 추가)
  m = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;

  return null;
}

function parseTime24FromAnyLine(line) {
  const s = (line ?? "").toString();

  // 1. "오전 10:00" 또는 "[오전 10:00]" (괄호 유무 상관없이 인식)
  let m = s.match(/\[?\s*(오전|오후)\s*(\d{1,2}):(\d{2})\s*\]?/);
  if (m) {
    const ap = m[1];
    let hh = Number(m[2]);
    const mm = m[3];
    if (ap === "오전") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }
    return `${String(hh).padStart(2, "0")}:${mm}`;
  }

  // 2. "15:30" (24시간제)
  m = s.match(/\[?\s*(\d{1,2}):(\d{2})\s*\]?/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h < 24 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, "0")}:${min}`;
    }
  }
  return null;
}

function detectType(line) {
  if (JOIN_WORDS.some((w) => line.includes(w))) return "JOIN";
  if (LEAVE_WORDS.some((w) => line.includes(w))) return "LEAVE";
  return null;
}

function extractName(line) {
  // 1) Korean: "OOO님이 들어왔습니다/나갔습니다"
  let m = line.match(/(.+?)님이\s*(들어왔습니다|나갔습니다)/);
  if (m) return m[1].trim();

  // 2) English (fallback): "NAME invited to ..." / "NAME left"
  m = line.match(/^(.+?)\s+(invited to|left)\b/i);
  if (m) return m[1].trim();

  // 3) Korean admin actions: "OOO님을 내보냈습니다" / "OOO님을 초대했습니다"
  m = line.match(/(.+?)님을\s*(내보냈습니다|초대했습니다)/);
  if (m) return m[1].trim();

  return null;
}


function resolveEventTime(lines, idx, lastSeenTime24) {
  const self = parseTime24FromAnyLine(lines[idx]);
  if (self) return self;

  // 위아래 3줄 탐색
  for (let k = 1; k <= 3; k++) {
    if (idx - k >= 0) {
      const prev = parseTime24FromAnyLine(lines[idx - k]);
      if (prev) return prev;
    }
    if (lines[idx + k]) {
      const next = parseTime24FromAnyLine(lines[idx + k]);
      if (next) return next;
    }
  }
  return lastSeenTime24 ?? "??:??";
}

function parseKakaoTxt(text, guildId) {
  const rawLines = (text ?? "").toString().split(/\r?\n/);
  const lines = rawLines.map(normalizeLine).filter(Boolean);

  const events = [];
  let currentDate = null;
  let lastSeenTime24 = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateKey = parseDateHeader(line);
    if (dateKey) {
      currentDate = dateKey;
      continue;
    }

    const observed = parseTime24FromAnyLine(line);
    if (observed) lastSeenTime24 = observed;

    const type = detectType(line);
    if (!type) continue;

    const name = extractName(line);
    if (!name) continue;

    events.push({
      guild_id: guildId,
      date_key: currentDate ?? "UNKNOWN",
      time_24: resolveEventTime(lines, i, lastSeenTime24),
      event_type: type,
      kakao_name: name,
      raw_line: line,
    });
  }
  return events;
}

module.exports = { parseKakaoTxt };