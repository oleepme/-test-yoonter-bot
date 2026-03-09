// src/party/handler.js
const { InteractionType } = require("discord.js");
const HANDLER_BUILD = "2026-01-05-layout-v5.1";
console.log("[HANDLER_BUILD]", HANDLER_BUILD);
const { PARTY_BOARD_CHANNEL_ID } = require("../config");
const {
  upsertParty,
  getParty,
  setMemberNote,
  removeMember,
  deleteParty,
  listActiveParties,
} = require("../db");

const { logEmbed, field } = require("../discord/log");
const { safeTrim } = require("../discord/util");

const {
  createPartyModal,
  editPartyModal,
  manageMembersModal,
  joinNoteModal,
  waitModal,
  partyActionRows,
  endedActionRow,
  kindLabel,
  kindIcon,
  isUnlimitedKind,
} = require("./ui");

const ERROR_EPHEMERAL_MS = 8000;
const OK_BLANK = "\u200b";
const WAIT_PREFIX = "__WAIT__:";

// ---------- 공용 ----------
function isAdmin(interaction) {
  const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
  if (!ADMIN_ROLE_ID) return false;
  return !!interaction.member?.roles?.cache?.has?.(ADMIN_ROLE_ID);
}

async function ackUpdate(interaction) {
  await interaction.deferUpdate().catch(() => {});
}

async function ackModal(interaction) {
  // ModalSubmit은 3초 내 응답이 필요하므로 deferReply로 ACK만 잡습니다.
  // 성공 시에는 doneModal()에서 deleteReply로 흔적을 없앱니다.
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function doneModal(interaction) {
  // 성공 시: 에페메랄 응답을 삭제해서 “빈 메시지”가 남지 않게 합니다.
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.deleteReply().catch(() => {});
    }
  } catch {}
}

async function ephemeralError(interaction, content) {
  try {
    if (interaction.type === InteractionType.ModalSubmit) {
      await ackModal(interaction);
      await interaction.editReply({ content }).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), ERROR_EPHEMERAL_MS);
      return;
    }

    if (interaction.deferred || interaction.replied) {
      const m = await interaction.followUp({ content, ephemeral: true }).catch(() => null);
      if (m?.delete) setTimeout(() => m.delete().catch(() => {}), ERROR_EPHEMERAL_MS);
      return;
    }

    await interaction.reply({ content, ephemeral: true }).catch(() => {});
    setTimeout(() => interaction.deleteReply().catch(() => {}), ERROR_EPHEMERAL_MS);
  } catch {}
}

function parseMaxPlayers(maxRaw) {
  const n = Number(maxRaw);
  if (!Number.isInteger(n) || n < 2 || n > 20) return null;
  return n;
}

function isWaiting(note) {
  const s = (note ?? "").toString().trim();
  // ✅ 레거시 호환: 과거 저장값 "WAIT:"(대소문자 무관)도 대기로 인식
  return s.startsWith(WAIT_PREFIX) || /^wait:/i.test(s);
}

function waitingText(note) {
  const s = (note ?? "").toString().trim();
  if (s.startsWith(WAIT_PREFIX)) return s.slice(WAIT_PREFIX.length).trim();
  if (/^wait:/i.test(s)) return s.replace(/^wait:/i, "").trim();
  return "";
}

function stripWaitPrefix(note) {
  const s = (note ?? "").toString().trim();
  if (s.startsWith(WAIT_PREFIX)) return s.slice(WAIT_PREFIX.length).trim();
  if (/^wait:/i.test(s)) return s.replace(/^wait:/i, "").trim();
  return s;
}

function playingCount(party) {
  return (party.members ?? []).filter((m) => !isWaiting(m.note)).length;
}

function statusLabel(status) {
  if (status === "PLAYING") return "🟢 플레이중";
  if (status === "ENDED") return "⚫ 종료";
  return "🔴 모집중";
}

function timeDisplay(timeTextRaw) {
  const t = (timeTextRaw ?? "").toString().trim();
  return t ? t : "⚡ 모바시";
}

function getDisplayNameFromInteraction(interaction) {
  return (
    interaction?.member?.displayName ||
    interaction?.member?.nickname ||
    interaction?.user?.username ||
    "알수없음"
  );
}

async function hydrateDisplayNames(guild, party) {
  const members = Array.isArray(party.members) ? party.members : [];
  if (!members.length) return party;

  const nextMembers = [];
  for (const m of members) {
    const userId = m.user_id;
    let dn = (m.display_name ?? "").toString().trim();

    if (!dn) {
      const cached = guild.members.cache.get(userId);
      if (cached?.displayName) dn = cached.displayName;
    }
    if (!dn) {
      try {
        const fetched = await guild.members.fetch(userId);
        dn = fetched?.displayName || "";
      } catch {}
    }

    nextMembers.push({ ...m, display_name: dn || "알수없음" });
  }

  return { ...party, members: nextMembers };
}

function buildParticipants(party) {
  const kind = party.kind;
  const members = Array.isArray(party.members) ? party.members : [];

  const waiting = [];
  const playing = [];
  for (const m of members) (isWaiting(m.note) ? waiting : playing).push(m);

  const nameOf = (m) => {
    const n = (m.display_name ?? "").toString().trim();
    return n || "알수없음";
  };

  if (isUnlimitedKind(kind)) {
    const lines = [];
    if (playing.length === 0) lines.push("(참가자 없음)");
    else {
      lines.push(
        playing
          .map((m) => {
            const name = nameOf(m);
            const note = stripWaitPrefix((m.note ?? "").toString().trim());
            return `• ${name}${note ? ` — ${note}` : ""}`;
          })
          .join("\n")
      );
    }

    if (waiting.length > 0) {
      lines.push("");
      lines.push("대기");
      lines.push(
        waiting
          .map((m) => {
            const name = nameOf(m);
            const w = waitingText(m.note);
            return `• ${name}${w ? ` — ${w}` : ""}`;
          })
          .join("\n")
      );
    }
    return lines.join("\n");
  }

  const maxPlayers = Number(party.max_players) || 4;
  const lines = [];

  for (let i = 0; i < maxPlayers; i++) {
    const m = playing[i];
    if (!m) lines.push(`${i + 1}.`);
    else {
      const name = nameOf(m);
      const note = stripWaitPrefix((m.note ?? "").toString().trim());
      lines.push(`${i + 1}. ${name}${note ? ` — ${note}` : ""}`);
    }
  }

  if (waiting.length > 0) {
    lines.push("");
    lines.push("대기");
    lines.push(
      waiting
        .map((m) => {
          const name = nameOf(m);
          const w = waitingText(m.note);
          return `• ${name}${w ? ` — ${w}` : ""}`;
        })
        .join("\n")
    );
  }

  return lines.join("\n");
}

function buildPartyEmbed(party) {
  const icon = kindIcon(party.kind);
  const label = kindLabel(party.kind);

  const titleText = (party.title ?? "").toString().trim();
  const bigTitle = titleText || "(제목없음)";

  return {
    color:
      party.status === "PLAYING"
        ? 0x2ecc71
        : party.status === "ENDED"
          ? 0x95a5a6
          : 0xe74c3c,

    // 상단: 상태 + 카테고리 (작게) — 카테고리를 게임 제목 위로 올림
    author: {
      name: `${statusLabel(party.status)}
${icon} ${label}`,
    },

    // ✅ 게임 제목 "크게 보이기" 트릭
    // - Discord embed title은 더 커질 수 없어서, description에 마크다운 헤딩(##)을 사용합니다.
    // - 환경(클라이언트)에 따라 렌더링이 들쭉날쭉할 수 있지만, 요구사항대로 "크게"를 우선합니다.
    description: `## **${bigTitle}**`,

    fields: [
      {
        name: "📄 특이사항",
        value: (party.party_note ?? "").toString().trim() || "(없음)",
        inline: false,
      },
      {
        name: "⏰ 시간",
        value: (party.time_text ?? "").toString().trim() || "⚡ 모이면 바로 시작",
        inline: true,
      },
      {
        name: "👤 참가자 목록",
        value: buildParticipants(party),
        inline: false,
      },
    ],
  };
}


function buildCreatingEmbed(kind) {
  return {
    color: 0x95a5a6,
    title: `🛠️ 파티 생성 중...\n${kindIcon(kind)} ${kindLabel(kind)}`,
    description: OK_BLANK,
  };
}

async function refreshPartyMessage(guild, party) {
  const ch = await guild.channels.fetch(party.channel_id).catch(() => null);
  if (!ch?.isTextBased()) return;

  const msg = await ch.messages.fetch(party.message_id).catch(() => null);
  if (!msg) return;

  const hydrated = await hydrateDisplayNames(guild, party);

  const embed = buildPartyEmbed(hydrated);
  const components = hydrated.status === "ENDED" ? [endedActionRow()] : partyActionRows();

  await msg
    .edit({
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
}

async function endParty(guild, party, reason, message) {
  await upsertParty({ ...party, status: "ENDED", mode: "TEXT", start_at: 0 });

  if (message) {
    try {
      await message.delete();
      await deleteParty(party.message_id);
      await logEmbed(guild, {
        title: "⚫ 파티 종료(메시지 삭제)",
        color: 0x95a5a6,
        fields: [
        field("파티", `${kindIcon(party.kind)} ${party.title}`),field("파티 메시지 ID", party.message_id, true), field("사유", reason)],
      });
      return;
    } catch {}
  }

  const ended = await getParty(party.message_id);
  if (ended) await refreshPartyMessage(guild, ended);

  await logEmbed(guild, {
    title: "⚫ 파티 종료(메시지 유지)",
    color: 0x95a5a6,
    fields: [
        field("파티", `${kindIcon(party.kind)} ${party.title}`),
      field("파티 메시지 ID", party.message_id, true),
      field("사유", reason),
      field("처리", "메시지 삭제 실패 → 종료 고정 + 🗑 삭제 버튼 제공"),
    ],
  });
}

// ---------- 인원관리 모달 텍스트 파싱 ----------
function parseSlotsText(slotsText) {
  const lines = (slotsText ?? "")
    .toString()
    .split("\n")
    .map((s) => s.trim());

  const playingTokens = [];
  const waitingTokens = [];

  let inWaiting = false;

  for (const line of lines) {
    if (!line) continue;

    if (/^대기\s*:?$/i.test(line)) {
      inWaiting = true;
      continue;
    }

    const m = line.match(/^\d+\.\s*(.*)$/);
    if (m) {
      const token = (m[1] ?? "").trim();
      if (token) playingTokens.push(token);
      continue;
    }

    const b = line.match(/^[-•]\s*(.*)$/);
    if (b) {
      const token = (b[1] ?? "").trim();
      if (token) (inWaiting ? waitingTokens : playingTokens).push(token);
      continue;
    }

    if (inWaiting) waitingTokens.push(line);
    else playingTokens.push(line);
  }

  // “— 비고”가 같이 들어오면 앞부분만 유저 토큰으로 사용
  const clean = (t) => t.split("—")[0].split("-")[0].trim();

  return {
    playingTokens: playingTokens.map(clean).filter(Boolean),
    waitingTokens: waitingTokens.map(clean).filter(Boolean),
  };
}

function extractIds(text) {
  const s = (text ?? "").toString();
  const ids = new Set();

  const mentionRe = /<@!?(\d{15,21})>/g;
  let m;
  while ((m = mentionRe.exec(s))) ids.add(m[1]);

  const rawRe = /\b(\d{15,21})\b/g;
  while ((m = rawRe.exec(s))) ids.add(m[1]);

  return [...ids];
}

async function resolveOneUserId(guild, token) {
  const raw = (token ?? "").toString().trim();
  if (!raw) return null;

  // 1) mention / raw id 우선
  const ids = extractIds(raw);
  if (ids.length) return ids[0];

  const q = raw.toLowerCase();

  // 2) 캐시에서 "완전 일치" 먼저(오탐 방지)
  const exactCached = guild.members.cache.find((m) => (m.displayName ?? "").toLowerCase() === q);
  if (exactCached) return exactCached.id;

  // 3) Discord API 검색(대규모 서버/캐시 미구축 대비)
  // - 여러 명 나오면 "완전 일치 1명"이면 채택, 아니면 실패 처리(안전)
  try {
    const found = await guild.members.search({ query: raw, limit: 10 });
    const exact = found.filter((m) => (m.displayName ?? "").toLowerCase() === q);
    if (exact.size === 1) return exact.first().id;
    if (found.size === 1) return found.first().id;
  } catch {}

  // 4) 마지막: 부분 포함 1명일 때만 허용(안전)
  try {
    const matches = guild.members.cache.filter((m) => (m.displayName ?? "").toLowerCase().includes(q));
    if (matches.size === 1) return matches.first().id;
  } catch {}

  return null;
}

// ---------- 메인 ----------
async function handleParty(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;

  // 0) 생성
  if (interaction.isButton() && interaction.customId.startsWith("party:create:")) {
    const kind = interaction.customId.split(":")[2];
    await interaction.showModal(createPartyModal(kind)).catch(() => {});
    return true;
  }

  // 1) 생성 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:create:submit:")) {
    await ackModal(interaction);

    const kind = interaction.customId.split(":")[3];

    try {
      const note = safeTrim(interaction.fields.getTextInputValue("note"));
      const time = safeTrim(interaction.fields.getTextInputValue("time"));
      const title = safeTrim(interaction.fields.getTextInputValue("title"));

      if (!isUnlimitedKind(kind) && !title) {
        await ephemeralError(interaction, "제목은 필수입니다.");
        return true;
      }

      let maxPlayers = 0;
      if (!isUnlimitedKind(kind)) {
        const parsed = parseMaxPlayers(safeTrim(interaction.fields.getTextInputValue("max")));
        if (!parsed) {
          await ephemeralError(interaction, "인원제한은 2~20 사이 숫자여야 합니다.");
          return true;
        }
        maxPlayers = parsed;
      } else {
        maxPlayers = 0;
      }

      const board = await guild.channels.fetch(PARTY_BOARD_CHANNEL_ID).catch(() => null);
      if (!board?.isTextBased()) {
        await ephemeralError(interaction, "게시판 채널을 찾지 못했습니다.");
        return true;
      }

      const msg = await board.send({
        embeds: [buildCreatingEmbed(kind)],
        components: [],
        allowedMentions: { parse: [] },
      });

      await upsertParty({
        message_id: msg.id,
        channel_id: msg.channel.id,
        guild_id: guild.id,
        owner_id: interaction.user.id,
        kind,
        title: title || "(제목 없음)",
        party_note: note,
        time_text: time || "",
        mode: "TEXT",
        start_at: 0,
        status: "RECRUIT",
        max_players: maxPlayers,
      });

      // 파티장 자동 참가
      const displayName = getDisplayNameFromInteraction(interaction);
      await setMemberNote(msg.id, interaction.user.id, displayName, "");

      const party = await getParty(msg.id);
      if (party) await refreshPartyMessage(guild, party);

      await doneModal(interaction);
      return true;
    } catch (err) {
      console.error("[CREATE_PARTY_ERR]", err);
      await ephemeralError(interaction, `파티 생성 처리 중 오류: ${err?.message ?? err}`);
      return true;
    }
  }

  // 2) 파티 메시지 버튼
  if (interaction.isButton() && interaction.customId.startsWith("party:")) {
    const msgId = interaction.message?.id;
    if (!msgId) {
      await ephemeralError(interaction, "메시지 정보를 찾지 못했습니다.");
      return true;
    }

    const party = await getParty(msgId);
    if (!party) {
      await ephemeralError(interaction, "DB에 등록된 파티가 아닙니다.");
      return true;
    }

    if (party.status === "ENDED" && interaction.customId !== "party:delete") {
      await ephemeralError(interaction, "이미 종료된 파티입니다.");
      return true;
    }

    if (interaction.customId === "party:join") {
      await interaction.showModal(joinNoteModal(msgId)).catch(() => {});
      return true;
    }

    if (interaction.customId === "party:wait") {
      await interaction.showModal(waitModal(msgId)).catch(() => {});
      return true;
    }

    if (interaction.customId === "party:waitoff") {
      await ackUpdate(interaction);

      const me = (party.members ?? []).find((m) => m.user_id === interaction.user.id);
      if (!me || !isWaiting(me.note)) {
        await ephemeralError(interaction, "대기 상태가 아닙니다.");
        return true;
      }

      await removeMember(msgId, interaction.user.id);
      const updated = await getParty(msgId);
      if (updated) await refreshPartyMessage(guild, updated);
      return true;
    }

    if (interaction.customId === "party:leave") {
      await ackUpdate(interaction);

      const isMember = (party.members ?? []).some((m) => m.user_id === interaction.user.id);
      if (!isMember) {
        await ephemeralError(interaction, "현재 파티에 참가/대기 중이 아닙니다.");
        return true;
      }

      await removeMember(msgId, interaction.user.id);
      const after = await getParty(msgId);

      if (!after || (after.members?.length ?? 0) === 0) {
        await endParty(guild, party, "전원 이탈(자동종료)", interaction.message);
        return true;
      }

      await refreshPartyMessage(guild, after);
      return true;
    }

    // ✅ 수정(파티 정보만)
    if (interaction.customId === "party:edit") {
      const admin = isAdmin(interaction);
      const ok = admin || interaction.user.id === party.owner_id;
      if (!ok) {
        await ephemeralError(interaction, "파티장 또는 운영진만 수정할 수 있습니다.");
        return true;
      }

      await interaction.showModal(editPartyModal(msgId, party, admin)).catch(() => {});
      return true;
    }

    // ✅ 인원 관리(운영진 전용)
    if (interaction.customId === "party:manage") {
      if (!isAdmin(interaction)) {
        await ephemeralError(interaction, "운영진만 사용할 수 있습니다.");
        return true;
      }

      // 최신 표시명 반영 후 텍스트 생성
      const hydrated = await hydrateDisplayNames(guild, party);
      const slotsText = buildParticipants(hydrated);

      await interaction.showModal(manageMembersModal(msgId, slotsText)).catch(() => {});
      return true;
    }

    if (interaction.customId === "party:start" || interaction.customId === "party:end") {
      const isMember = (party.members ?? []).some((m) => m.user_id === interaction.user.id);
      const ok = isMember || interaction.user.id === party.owner_id || isAdmin(interaction);
      if (!ok) {
        await ephemeralError(interaction, "파티원/파티장/운영진만 가능합니다.");
        return true;
      }

      await ackUpdate(interaction);

      if (interaction.customId === "party:start") {
        await upsertParty({ ...party, status: "PLAYING", mode: "TEXT", start_at: 0 });
        const updated = await getParty(msgId);
        if (updated) await refreshPartyMessage(guild, updated);
        return true;
      }

      await endParty(guild, party, "수동 종료", interaction.message);
      return true;
    }

    if (interaction.customId === "party:delete") {
      const ok = interaction.user.id === party.owner_id || isAdmin(interaction);
      if (!ok) {
        await ephemeralError(interaction, "파티장 또는 운영진만 삭제할 수 있습니다.");
        return true;
      }

      await ackUpdate(interaction);

      try {
        await interaction.message.delete();
        await deleteParty(msgId);
      } catch {
        await ephemeralError(interaction, "메시지 삭제에 실패했습니다. (봇 권한 확인)");
      }
      return true;
    }

    return false;
  }

  // 3) 참가/비고 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:joinnote:")) {
    await ackModal(interaction);

    try {
      const msgId = interaction.customId.split(":")[2];
      const party = await getParty(msgId);

      if (!party) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");
      if (party.status === "ENDED") return ephemeralError(interaction, "이미 종료된 파티입니다.");

      const inputNote = safeTrim(interaction.fields.getTextInputValue("note")).slice(0, 80);

      if (!isUnlimitedKind(party.kind)) {
        const maxPlayers = Number(party.max_players) || 4;
        const existsAsPlaying = (party.members ?? []).some(
          (m) => m.user_id === interaction.user.id && !isWaiting(m.note)
        );
        const count = playingCount(party);
        if (!existsAsPlaying && count >= maxPlayers) {
          return ephemeralError(interaction, `이미 정원이 찼습니다. (최대 ${maxPlayers}명)`);
        }
      }

      const me = (party.members ?? []).find((m) => m.user_id === interaction.user.id);
      const base = me?.note ? stripWaitPrefix(me.note) : "";
      const finalNote = inputNote || base || "";

      const displayName = getDisplayNameFromInteraction(interaction);
      await setMemberNote(msgId, interaction.user.id, displayName, finalNote);

      const updated = await getParty(msgId);

      // ✅ 운영진이 인원관리로 전원을 제거한 경우: 자동 종료(메시지 삭제)
      if (updated && Array.isArray(updated.members) && updated.members.length === 0) {
        const ch = await guild.channels.fetch(updated.channel_id).catch(() => null);
        const msg = ch?.isTextBased() ? await ch.messages.fetch(updated.message_id).catch(() => null) : null;
        await endParty(guild, updated, "운영진 인원관리로 전원 제거", msg);
        await doneModal(interaction);
        return true;
      }

      if (updated) await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "참가/비고 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  // 4) 대기 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:wait:submit:")) {
    await ackModal(interaction);

    try {
      const msgId = interaction.customId.split(":")[3];
      const party = await getParty(msgId);

      if (!party) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");
      if (party.status === "ENDED") return ephemeralError(interaction, "이미 종료된 파티입니다.");

      const note = safeTrim(interaction.fields.getTextInputValue("note")).slice(0, 120);
      const displayName = getDisplayNameFromInteraction(interaction);

      await setMemberNote(msgId, interaction.user.id, displayName, `${WAIT_PREFIX}${note}`);

      const updated = await getParty(msgId);
      if (updated) await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "대기 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  // 5) 파티 정보 수정 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:edit:submit:")) {
    await ackModal(interaction);

    try {
      const msgId = interaction.customId.split(":")[3] || interaction.customId.split(":")[2]; // 하위호환
      const party = await getParty(msgId);
      if (!party) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");

      const admin = isAdmin(interaction);
      const ok = admin || interaction.user.id === party.owner_id;
      if (!ok) return ephemeralError(interaction, "파티장 또는 운영진만 수정할 수 있습니다.");

      const note = safeTrim(interaction.fields.getTextInputValue("note"));
      const time = safeTrim(interaction.fields.getTextInputValue("time"));
      const title = safeTrim(interaction.fields.getTextInputValue("title"));

      if (!isUnlimitedKind(party.kind) && !title) {
        return ephemeralError(interaction, "제목은 필수입니다.");
      }

      let maxPlayers = 0;
      if (!isUnlimitedKind(party.kind)) {
        const maxRaw = safeTrim(interaction.fields.getTextInputValue("max"));
        const parsed = parseMaxPlayers(maxRaw);
        if (!parsed) return ephemeralError(interaction, "인원제한은 2~20 사이 숫자여야 합니다.");

        const currentPlaying = playingCount(party);
        if (parsed < currentPlaying) {
          return ephemeralError(interaction, `현재 플레이 참가자가 ${currentPlaying}명입니다. 그 미만으로 줄일 수 없습니다.`);
        }
        maxPlayers = parsed;
      }

      await upsertParty({
        ...party,
        title: title || "(제목 없음)",
        party_note: note,
        time_text: time || "",
        max_players: maxPlayers,
        mode: "TEXT",
        start_at: 0,
      });

      const updated = await getParty(msgId);
      if (updated) await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "파티 수정 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  // 6) ✅ 인원 관리 submit (운영진)
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:manage:submit:")) {
    await ackModal(interaction);

    if (!isAdmin(interaction)) {
      await ephemeralError(interaction, "운영진만 사용할 수 있습니다.");
      return true;
    }

    try {
      const msgId = interaction.customId.split(":")[3];
      const party = await getParty(msgId);
      if (!party) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");
      if (party.status === "ENDED") return ephemeralError(interaction, "이미 종료된 파티입니다.");

      const slotsText = interaction.fields.getTextInputValue("slots_text");
      const { playingTokens, waitingTokens } = parseSlotsText(slotsText);

      // 토큰 -> userId 해석(유일 매칭 강제)
      const playingIds = [];
      for (const t of playingTokens) {
        const id = await resolveOneUserId(guild, t);
        if (!id) return ephemeralError(interaction, `참가 슬롯에서 유저를 특정할 수 없습니다: ${t}`);
        playingIds.push(id);
      }

      const waitingIds = [];
      for (const t of waitingTokens) {
        const id = await resolveOneUserId(guild, t);
        if (!id) return ephemeralError(interaction, `대기 슬롯에서 유저를 특정할 수 없습니다: ${t}`);
        waitingIds.push(id);
      }

      // 정원 체크(제한 파티만)
      if (!isUnlimitedKind(party.kind)) {
        const maxP = Number(party.max_players) || 4;
        if (playingIds.length > maxP) {
          return ephemeralError(interaction, `참가자가 정원(${maxP}명)을 초과했습니다.`);
        }
      }

      // 기존 멤버 맵(비고 보존용)
      const current = Array.isArray(party.members) ? party.members : [];
      const currentById = new Map(current.map((m) => [m.user_id, m]));

      const nextIds = new Set([...playingIds, ...waitingIds]);

      // 1) 삭제: next에 없는 애만 제거 (바카 삭제하면 바카만 삭제 + note도 같이 삭제)
      for (const m of current) {
        if (!nextIds.has(m.user_id)) {
          await removeMember(msgId, m.user_id);
        }
      }

      // 2) 추가/상태 전환/표시명 갱신
      async function ensureMember(id, wantWaiting) {
        let dn = "알수없음";
        try {
          const mem = await guild.members.fetch(id);
          dn = mem?.displayName || dn;
        } catch {}

        const prev = currentById.get(id);
        const prevNote = (prev?.note ?? "").toString();

        // 비고 보존 정책:
        // - 삭제된 건 이미 removeMember로 row 삭제됨
        // - 유지된 건 note를 그대로 유지
        // - 참가<->대기 전환 시 WAIT_PREFIX만 붙였다/뗌
        let nextNote = prevNote;

        if (wantWaiting) {
          if (!isWaiting(prevNote)) {
            // 참가 -> 대기: 기존 비고를 대기코멘트로 보존
            const base = stripWaitPrefix(prevNote);
            nextNote = `${WAIT_PREFIX}${base}`;
          }
          // 이미 대기면 그대로(코멘트 유지)
        } else {
          if (isWaiting(prevNote)) {
            // 대기 -> 참가: 대기코멘트를 참가 비고로 보존
            nextNote = stripWaitPrefix(prevNote);
          }
          // 이미 참가면 그대로(비고 유지)
        }

        await setMemberNote(msgId, id, dn, nextNote);
      }

      for (const id of playingIds) {
        await ensureMember(id, false);
      }
      for (const id of waitingIds) {
        await ensureMember(id, true);
      }

      const updated = await getParty(msgId);
      if (updated) await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "인원 관리 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  return false;
}

// index.js 연동용
async function syncOrderMessage(guild, messageId) {
  const party = await getParty(messageId);
  if (!party) return;
  await refreshPartyMessage(guild, party);
}

async function runPartyTick(client) {
  return;
}

module.exports = {
  handleParty,
  syncOrderMessage,
  runPartyTick,
};