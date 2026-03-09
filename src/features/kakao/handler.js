// src/features/kakao/handler.js

const { parseKakaoTxt } = require("./parser");
const db = require("../../db");

const {
  insertKakaoEvents,
  markKakaoEventsPosted,
  getKakaoEventsRange,
  clearKakaoEvents,
} = db;

const { KAKAO_LOG_CHANNEL_ID, KAKAO_IMPORT_CHANNEL_ID } = require("../../config");

async function fetchAttachmentText(attachment) {
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Failed to download attachment: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // ✅ 카카오 TXT는 UTF-8 / UTF-16LE 등으로 저장될 수 있어 자동 디코딩
  const hasUtf8Bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const hasUtf16LeBom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;

  // NULL 바이트 비율이 높으면 UTF-16LE 가능성이 큼
  let nulls = 0;
  for (let i = 0; i < Math.min(buf.length, 2000); i++) {
    if (buf[i] === 0x00) nulls++;
  }
  const nullRatio = nulls / Math.min(buf.length, 2000);

  if (hasUtf16LeBom || nullRatio > 0.2) {
    return buf.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (hasUtf8Bom) {
    return buf.toString("utf8").replace(/^\uFEFF/, "");
  }
  return buf.toString("utf8");
}

function weekdayKo(d) {
  if (!d || d === "UNKNOWN") return "";
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  return ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][dt.getDay()] ?? "";
}

// 원본 양식 유지
function formatHeader(d) {
  if (d === "UNKNOWN") return "날짜 미상";
  const [y, m, day] = d.split("-");
  return `${y}.${m}.${day} ${weekdayKo(d)}`;
}

// 원본 양식 유지
function formatLine(r) {
  const act = r.event_type === "JOIN" ? "들어왔습니다" : "나갔습니다";
  const t = r.time_24 && r.time_24 !== "??:??" ? r.time_24 : "??:??";
  return `[${t}] ${r.kakao_name}님이 ${act}`;
}

async function postGroupedToChannel(guild, rows) {
  if (!KAKAO_LOG_CHANNEL_ID) return { ok: false, posted: 0 };

  const ch = await guild.channels.fetch(KAKAO_LOG_CHANNEL_ID).catch(() => null);
  if (!ch?.isTextBased()) return { ok: false, posted: 0 };

  rows.sort((a, b) => {
    const da = a.date_key ?? "UNKNOWN";
    const db = b.date_key ?? "UNKNOWN";

    if (da !== db) {
      if (da === "UNKNOWN") return 1;
      if (db === "UNKNOWN") return -1;
      return da.localeCompare(db);
    }

    return (a.time_24 ?? "??:??").localeCompare(b.time_24 ?? "??:??");
  });

  const blocks = [];
  let currentBlock = "";
  let lastDate = null;

  for (const row of rows) {
    let line = "";

    if (row.date_key !== lastDate) {
      if (lastDate !== null) line += "\n";
      line += formatHeader(row.date_key) + "\n";
      lastDate = row.date_key;
    }

    line += formatLine(row);

    if ((currentBlock + "\n" + line).length > 1900) {
      blocks.push(currentBlock);
      currentBlock = line;
    } else {
      if (currentBlock.length > 0) currentBlock += "\n";
      currentBlock += line;
    }
  }

  if (currentBlock.trim().length > 0) blocks.push(currentBlock);

  for (const c of blocks) {
    await ch.send({ content: c }).catch(() => {});
  }

  return { ok: true, posted: rows.length };
}

async function handleKakaoImport(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "kakao_import") return false;

  if (KAKAO_IMPORT_CHANNEL_ID && interaction.channelId !== KAKAO_IMPORT_CHANNEL_ID) {
    await interaction.reply({
      content: `지정된 채널 <#${KAKAO_IMPORT_CHANNEL_ID}>에서만 가능합니다.`,
      ephemeral: true
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const file = interaction.options.getAttachment("file", true);
    const txt = await fetchAttachmentText(file);
    const parsed = parseKakaoTxt(txt, interaction.guild.id);

    if (!parsed.length) {
      await interaction.editReply("내용을 찾을 수 없습니다.");
      return true;
    }

    const { insertedCount, insertedRows } = await insertKakaoEvents(parsed);

    if (insertedCount > 0) {
      const res = await postGroupedToChannel(interaction.guild, insertedRows);
      if (res.ok) {
        await markKakaoEventsPosted(insertedRows.map((r) => r.id));
      }
      await interaction.editReply(`✅ **${insertedCount}건** 저장 및 게시 완료`);
    } else {
      await interaction.editReply("✅ 모두 이미 저장된 내용입니다. (내용이 짤렸다면 **/kakao_reset** 후 다시 시도)");
    }

    return true;
  } catch (e) {
    console.error(e);
    await interaction.editReply("오류 발생: " + e.message);
    return true;
  }
}

async function handleKakaoRebuild(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "kakao_rebuild") return false;

  await interaction.deferReply({ ephemeral: true });

  try {
    const days = interaction.options.getInteger("days") || 30;

    if (typeof getKakaoEventsRange !== "function") {
      const keys = Object.keys(db || {}).sort().join(", ");
      throw new Error(`DB에서 getKakaoEventsRange 함수를 찾지 못했습니다. (exports: ${keys})`);
    }

    const rows = await getKakaoEventsRange(interaction.guild.id, days);

    if (!rows.length) {
      await interaction.editReply("기록이 없습니다.");
      return true;
    }

    const res = await postGroupedToChannel(interaction.guild, rows);
    await interaction.editReply(`✅ 재게시 완료 (${res.posted}건)`);
    return true;
  } catch (e) {
    console.error(e);
    await interaction.editReply("오류: " + e.message);
    return true;
  }
}

async function handleKakaoClear(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "kakao_reset") return false;

  await interaction.deferReply({ ephemeral: true });

  try {
    const days = interaction.options.getInteger("days") || 1;

    if (typeof clearKakaoEvents !== "function") {
      throw new Error("db.js 업데이트 필요");
    }

    const count = await clearKakaoEvents(interaction.guild.id, days);
    await interaction.editReply(`🔥 최근 ${days}일 데이터 ${count}건 삭제 완료.`);
    return true;
  } catch (e) {
    console.error(e);
    await interaction.editReply("삭제 실패: " + e.message);
    return true;
  }
}

module.exports = {
  handleKakaoImport,
  handleKakaoRebuild,
  handleKakaoClear
};