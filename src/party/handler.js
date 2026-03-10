// src/party/handler.js
const {
  InteractionType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const {
  upsertParty,
  getParty,
  setMemberNote,
  removeMember,
  deleteParty,
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

const {
  getBoardConfigByChannelId,
  getMentionRoleId,
  buildDisplayTitle,
} = require("./channelConfig");

const HANDLER_BUILD = "2026-03-10-party-board-split-final-v2";
console.log("[HANDLER_BUILD]", HANDLER_BUILD);

const ERROR_EPHEMERAL_MS = 8000;
const WAIT_PREFIX = "__WAIT__:";
const createDraft = new Map();

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
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
  }
}

async function doneModal(interaction) {
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

function playingMembers(party) {
  return (party.members ?? []).filter((m) => !isWaiting(m.note));
}

function waitingMembers(party) {
  return (party.members ?? []).filter((m) => isWaiting(m.note));
}

function playingCount(party) {
  return playingMembers(party).length;
}

function statusLabel(status) {
  if (status === "PLAYING") return "🟢 플레이중";
  if (status === "ENDED") return "⚫ 종료";
  return "🔴 모집중";
}

function timeDisplay(timeTextRaw) {
  const t = (timeTextRaw ?? "").toString().trim();
  return t ? t : "⚡ 모이면 바로 시작";
}

function getDisplayNameFromInteraction(interaction) {
  return (
    interaction?.member?.displayName ||
    interaction?.member?.nickname ||
    interaction?.user?.globalName ||
    interaction?.user?.username ||
    "알수없음"
  );
}

async function getDisplayNameByUserId(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached?.displayName) return cached.displayName;

  try {
    const fetched = await guild.members.fetch(userId);
    if (fetched?.displayName) return fetched.displayName;
  } catch {}

  return `<@${userId}>`;
}

async function buildParticipants(guild, party) {
  const playing = playingMembers(party);
  const waiting = waitingMembers(party);

  if (isUnlimitedKind(party.kind)) {
    const lines = [];

    if (playing.length === 0) {
      lines.push("(참가자 없음)");
    } else {
      for (const m of playing) {
        const dn = await getDisplayNameByUserId(guild, m.user_id);
        const note = stripWaitPrefix(m.note);
        lines.push(`• ${dn}${note ? ` — ${note}` : ""}`);
      }
    }

    if (waiting.length > 0) {
      lines.push("");
      lines.push("대기");
      for (const m of waiting) {
        const dn = await getDisplayNameByUserId(guild, m.user_id);
        const w = waitingText(m.note);
        lines.push(`• ${dn}${w ? ` — ${w}` : ""}`);
      }
    }

    return lines.join("\n");
  }

  const maxPlayers = Number(party.max_players) || 4;
  const lines = [];

  for (let i = 0; i < maxPlayers; i++) {
    const m = playing[i];
    if (!m) {
      lines.push(`${i + 1}.`);
    } else {
      const dn = await getDisplayNameByUserId(guild, m.user_id);
      const note = stripWaitPrefix(m.note);
      lines.push(`${i + 1}. ${dn}${note ? ` — ${note}` : ""}`);
    }
  }

  if (waiting.length > 0) {
    lines.push("");
    lines.push("대기");
    for (const m of waiting) {
      const dn = await getDisplayNameByUserId(guild, m.user_id);
      const w = waitingText(m.note);
      lines.push(`• ${dn}${w ? ` — ${w}` : ""}`);
    }
  }

  return lines.join("\n");
}

async function buildPartyEmbed(guild, party) {
  const icon = kindIcon(party.kind);
  const label = kindLabel(party.kind);
  const boardConfig = getBoardConfigByChannelId(party.channel_id);
  const rawTitle = (party.title ?? "").toString().trim() || "(제목 없음)";
  const bigTitle = buildDisplayTitle(boardConfig, rawTitle, party.kind);

  const participantsText = await buildParticipants(guild, party);

  return {
    color:
      party.status === "PLAYING"
        ? 0x2ecc71
        : party.status === "ENDED"
          ? 0x95a5a6
          : 0xe74c3c,

    author: {
      name: `${statusLabel(party.status)}\n${icon} ${label}`,
    },

    description: `## **${bigTitle}**`,

    fields: [
      {
        name: "📄 특이사항",
        value: (party.party_note ?? "").toString().trim() || "(없음)",
        inline: false,
      },
      {
        name: "⏰ 시간",
        value: timeDisplay(party.time_text),
        inline: true,
      },
      {
        name: "👤 참가자 목록",
        value: participantsText,
        inline: false,
      },
    ],
  };
}

function buildCreatingEmbed(kind) {
  return {
    color: 0x95a5a6,
    title: `🛠️ 파티 생성 중`,
    description: `${kindIcon(kind)} ${kindLabel(kind)}`,
  };
}

async function refreshPartyMessage(guild, party) {
  const ch = await guild.channels.fetch(party.channel_id).catch(() => null);
  if (!ch?.isTextBased()) return;

  const msg = await ch.messages.fetch(party.message_id).catch(() => null);
  if (!msg) return;

  const embed = await buildPartyEmbed(guild, party);
  const components = party.status === "ENDED" ? [endedActionRow()] : partyActionRows();

  await msg.edit({
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function endParty(guild, party, reason, message) {
  await upsertParty({
    ...party,
    status: "ENDED",
    mode: "TEXT",
    start_at: 0,
  });

  if (message) {
    try {
      await message.delete();
      await deleteParty(party.message_id);

      await logEmbed(guild, {
        title: "⚫ 파티 종료(메시지 삭제)",
        color: 0x95a5a6,
        fields: [
          field("파티", `${kindIcon(party.kind)} ${party.title}`),
          field("파티 메시지 ID", party.message_id, true),
          field("사유", reason),
        ],
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
      field("처리", "메시지 삭제 실패 → 종료 상태 유지 + 🗑 삭제 버튼"),
    ],
  });
}

function createGameSubKindRow(boardConfig) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("party:create:game:subkind")
      .setPlaceholder("게임 세부 카테고리 선택")
      .addOptions(
        (boardConfig.gameSubKinds || []).map((x) => ({
          label: x,
          value: x,
        }))
      )
  );
}

function extractIds(raw) {
  const ids = [];
  const s = String(raw || "");
  const mentionMatches = [...s.matchAll(/<@!?(\d+)>/g)];
  for (const m of mentionMatches) ids.push(m[1]);

  const rawMatches = [...s.matchAll(/\b(\d{17,20})\b/g)];
  for (const m of rawMatches) ids.push(m[1]);

  return [...new Set(ids)];
}

async function resolveMemberId(guild, raw) {
  const text = (raw ?? "").toString().trim();
  if (!text) return null;

  const ids = extractIds(text);
  if (ids.length) return ids[0];

  const q = text.toLowerCase();

  const exactCached = guild.members.cache.find(
    (m) => (m.displayName ?? "").toLowerCase() === q
  );
  if (exactCached) return exactCached.id;

  try {
    const found = await guild.members.search({ query: text, limit: 10 });
    const exact = found.filter((m) => (m.displayName ?? "").toLowerCase() === q);
    if (exact.size === 1) return exact.first().id;
    if (found.size === 1) return found.first().id;
  } catch {}

  try {
    const matches = guild.members.cache.filter((m) =>
      (m.displayName ?? "").toLowerCase().includes(q)
    );
    if (matches.size === 1) return matches.first().id;
  } catch {}

  return null;
}

// ---------- 메인 ----------
async function handleParty(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;

  // 0) 생성 버튼
  if (interaction.isButton() && interaction.customId.startsWith("party:create:")) {
    const boardConfig = getBoardConfigByChannelId(interaction.channelId);
    if (!boardConfig) {
      await ephemeralError(interaction, "이 채널은 파티 생성 게시판이 아닙니다.");
      return true;
    }

    const kind = interaction.customId.split(":")[2];

    if (!boardConfig.allowedKinds.includes(kind)) {
      await ephemeralError(interaction, "이 채널에서는 해당 종류의 파티를 만들 수 없습니다.");
      return true;
    }

    // 기타-게임은 이제 바로 모달 (세부 카테고리 삭제)
    if (boardConfig.key === "ETC" && kind === "GAME") {
      await interaction.showModal(createPartyModal(kind)).catch(() => {});
      return true;
    }

    // 일반 게임 게시판은 세부 카테고리 1회 선택
    if (kind === "GAME" && Array.isArray(boardConfig.gameSubKinds) && boardConfig.gameSubKinds.length > 0) {
      createDraft.set(interaction.user.id, {
        boardChannelId: interaction.channelId,
        kind,
      });

      await interaction.reply({
        content: "게임 세부 카테고리를 선택하세요.",
        components: [createGameSubKindRow(boardConfig)],
        ephemeral: true,
      }).catch(() => {});
      return true;
    }

    await interaction.showModal(createPartyModal(kind)).catch(() => {});
    return true;
  }

  // 0-1) 게임 세부 카테고리 선택
  if (interaction.isStringSelectMenu() && interaction.customId === "party:create:game:subkind") {
    const d = createDraft.get(interaction.user.id);
    if (!d || d.boardChannelId !== interaction.channelId || d.kind !== "GAME") {
      await ephemeralError(interaction, "생성 세션이 만료되었습니다. 다시 버튼을 눌러주세요.");
      return true;
    }

    d.subKind = interaction.values[0];
    createDraft.set(interaction.user.id, d);

    await interaction.showModal(createPartyModal("GAME")).catch(() => {});
    return true;
  }

  // 1) 생성 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:create:submit:")) {
    await ackModal(interaction);

    const kind = interaction.customId.split(":")[3];

    try {
      const note = safeTrim(interaction.fields.getTextInputValue("note"));
      const time = safeTrim(interaction.fields.getTextInputValue("time"));
      let title = safeTrim(interaction.fields.getTextInputValue("title"));

      const board = interaction.channel;
      if (!board?.isTextBased()) {
        await ephemeralError(interaction, "게시판 채널을 찾지 못했습니다.");
        return true;
      }

      const boardConfig = getBoardConfigByChannelId(board.id);
      if (!boardConfig) {
        await ephemeralError(interaction, "이 채널은 파티 생성 게시판이 아닙니다.");
        return true;
      }

      if (!boardConfig.allowedKinds.includes(kind)) {
        await ephemeralError(interaction, "이 채널에서는 해당 종류의 파티를 만들 수 없습니다.");
        return true;
      }

      const draft = createDraft.get(interaction.user.id);

      // 일반 게임 게시판은 세부 카테고리를 제목 앞에 붙임
      if (
        kind === "GAME" &&
        boardConfig.key !== "ETC" &&
        draft?.subKind
      ) {
        title = draft.subKind;
      }

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
      }

      const mentionRoleId = getMentionRoleId(boardConfig, title);

      const msg = await board.send({
        content: mentionRoleId ? `<@&${mentionRoleId}>` : undefined,
        embeds: [buildCreatingEmbed(kind)],
        components: [],
        allowedMentions: mentionRoleId
          ? { roles: [mentionRoleId] }
          : { parse: [] },
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

      await setMemberNote(msg.id, interaction.user.id, "");

      const party = await getParty(msg.id);
      if (party) await refreshPartyMessage(guild, party);

      await logEmbed(guild, {
        title: "✅ 파티 생성",
        color: 0x2ecc71,
        fields: [
          field("채널", `<#${board.id}>`, true),
          field("종류", kindLabel(kind), true),
          field("제목", title || "(제목 없음)"),
          field("시간", time || "모이면 바로 시작"),
          field("멘션 역할", mentionRoleId ? `<@&${mentionRoleId}>` : "(없음)"),
        ],
      });

      createDraft.delete(interaction.user.id);
      await doneModal(interaction);
      return true;
    } catch (err) {
      console.error("[CREATE_PARTY_ERR]", err);
      await ephemeralError(interaction, `파티 생성 처리 중 오류: ${err?.message ?? err}`);
      return true;
    }
  }

  // 2) 버튼
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

    if (interaction.customId === "party:manage") {
      if (!isAdmin(interaction)) {
        await ephemeralError(interaction, "운영진만 사용할 수 있습니다.");
        return true;
      }

      const slotsText = await buildParticipants(guild, party);
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
        await upsertParty({
          ...party,
          status: "PLAYING",
          mode: "TEXT",
          start_at: 0,
        });

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
      const base = me ? stripWaitPrefix(me.note) : "";
      const finalNote = inputNote || base || "";

      await setMemberNote(msgId, interaction.user.id, finalNote);

      const updated = await getParty(msgId);
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
      await setMemberNote(msgId, interaction.user.id, `${WAIT_PREFIX}${note}`);

      const updated = await getParty(msgId);
      if (updated) await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "대기 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  // 5) 수정 submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:edit:submit:")) {
    await ackModal(interaction);

    try {
      const msgId = interaction.customId.split(":")[3] || interaction.customId.split(":")[2];
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

  // 6) 인원 관리 submit
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

      const slotsText = safeTrim(interaction.fields.getTextInputValue("slots_text"));
      const lines = slotsText.split("\n");

      let mode = "playing";
      const desiredPlaying = [];
      const desiredWaiting = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line === "대기") {
          mode = "waiting";
          continue;
        }

        let namePart = line;
        let notePart = "";

        const slotMatch = line.match(/^\d+\.\s*(.*)$/);
        if (slotMatch) namePart = slotMatch[1];

        const bulletMatch = namePart.match(/^•\s*(.*)$/);
        if (bulletMatch) namePart = bulletMatch[1];

        const parts = namePart.split("—");
        namePart = (parts[0] ?? "").trim();
        notePart = (parts[1] ?? "").trim();

        if (!namePart) continue;

        const userId = await resolveMemberId(guild, namePart);
        if (!userId) continue;

        const memberObj = { userId, note: notePart };

        if (mode === "waiting") desiredWaiting.push(memberObj);
        else desiredPlaying.push(memberObj);
      }

      const wantIds = new Set([...desiredPlaying, ...desiredWaiting].map((x) => x.userId));
      const currentMembers = Array.isArray(party.members) ? party.members : [];

      for (const m of currentMembers) {
        if (!wantIds.has(m.user_id)) {
          await removeMember(msgId, m.user_id);
        }
      }

      async function ensureMember(userId, wantWaiting, explicitNote) {
        const prev = currentMembers.find((m) => m.user_id === userId);
        const prevNote = (prev?.note ?? "").toString();

        let nextNote = explicitNote ?? prevNote;
        if (wantWaiting) {
          if (!isWaiting(nextNote)) nextNote = `${WAIT_PREFIX}${stripWaitPrefix(nextNote)}`;
        } else {
          nextNote = stripWaitPrefix(nextNote);
        }

        await setMemberNote(msgId, userId, nextNote);
      }

      for (const m of desiredPlaying) {
        await ensureMember(m.userId, false, m.note);
      }
      for (const m of desiredWaiting) {
        await ensureMember(m.userId, true, m.note);
      }

      const updated = await getParty(msgId);

      if (!updated || (updated.members?.length ?? 0) === 0) {
        const ch = await guild.channels.fetch(party.channel_id).catch(() => null);
        const msg = ch?.isTextBased() ? await ch.messages.fetch(party.message_id).catch(() => null) : null;
        await endParty(guild, party, "운영진 인원관리로 전원 제거", msg);
        await doneModal(interaction);
        return true;
      }

      await refreshPartyMessage(guild, updated);

      await doneModal(interaction);
      return true;
    } catch {
      await ephemeralError(interaction, "인원 관리 처리 중 오류가 발생했습니다.");
      return true;
    }
  }

  return false;
}

async function syncOrderMessage(guild, messageId) {
  const party = await getParty(messageId);
  if (!party) return;
  await refreshPartyMessage(guild, party);
}

async function runPartyTick(_client) {
  return;
}

module.exports = {
  handleParty,
  syncOrderMessage,
  runPartyTick,
};