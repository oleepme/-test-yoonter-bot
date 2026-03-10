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

const HANDLER_BUILD = "2026-03-10-party-board-split-final-v5";
console.log("[HANDLER_BUILD]", HANDLER_BUILD);

const ERROR_EPHEMERAL_MS = 8000;
const WAIT_PREFIX = "__WAIT__:";
const createDraft = new Map();

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

async function deleteCreatePrompt(client, draft) {
  try {
    if (!draft?.originApplicationId || !draft?.originToken) return;
    const messageId = draft.originMessageId || "@original";
    await client.rest.delete(
      `/webhooks/${draft.originApplicationId}/${draft.originToken}/messages/${messageId}`
    ).catch(() => {});
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

function getOptionalTextInputValue(interaction, customId) {
  try {
    return safeTrim(interaction.fields.getTextInputValue(customId));
  } catch {
    return "";
  }
}

function normalizeText(v) {
  return (v ?? "").toString().trim().toLowerCase();
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
  const subKind = (party.sub_kind ?? "").toString().trim();
  const bigTitle = buildDisplayTitle(boardConfig, rawTitle, party.kind, subKind);

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
      return;
    } catch {}
  }

  const ended = await getParty(party.message_id);
  if (ended) await refreshPartyMessage(guild, ended);
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

function parseDisplayEntry(body) {
  const raw = (body ?? "").toString().trim();
  if (!raw) return { raw: "", name: "", note: "" };
  const [namePart, ...rest] = raw.split(/\s+—\s+/);
  return {
    raw,
    name: (namePart || "").trim(),
    note: rest.join(" — ").trim(),
  };
}

function parseManagedSlotsText(text, party) {
  const lines = (text ?? "").toString().split(/\r?\n/);
  const maxPlayers = Number(party.max_players) || 4;
  const playing = Array.from({ length: maxPlayers }, () => ({ name: "", note: "", raw: "" }));
  const waiting = [];
  let inWaiting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "대기") {
      inWaiting = true;
      continue;
    }

    if (!inWaiting) {
      const m = trimmed.match(/^(\d+)\.\s*(.*)$/);
      if (!m) continue;
      const idx = Number(m[1]) - 1;
      if (idx < 0 || idx >= maxPlayers) continue;
      playing[idx] = parseDisplayEntry(m[2]);
      continue;
    }

    const bullet = trimmed.match(/^[•\-*]\s*(.*)$/);
    waiting.push(parseDisplayEntry(bullet ? bullet[1] : trimmed));
  }

  return { playing, waiting };
}

async function resolveGuildMemberByLooseName(guild, raw) {
  const input = (raw ?? "").toString().trim();
  if (!input) return { member: null, reason: "empty" };

  const mention = input.match(/^<@!?(\d+)>$/);
  if (mention) {
    const member = await guild.members.fetch(mention[1]).catch(() => null);
    return member ? { member, reason: "mention" } : { member: null, reason: "not_found" };
  }

  const members = await guild.members.fetch().catch(() => null);
  if (!members) return { member: null, reason: "not_found" };

  const q = normalizeText(input);
  const all = [...members.values()];

  const exact = all.filter((m) => {
    const display = normalizeText(m.displayName);
    const username = normalizeText(m.user?.username);
    const globalName = normalizeText(m.user?.globalName);
    return display === q || username === q || globalName === q;
  });

  if (exact.length === 1) return { member: exact[0], reason: "exact" };
  if (exact.length > 1) return { member: null, reason: "ambiguous", candidates: exact };

  const partial = all.filter((m) => {
    const display = normalizeText(m.displayName);
    const username = normalizeText(m.user?.username);
    const globalName = normalizeText(m.user?.globalName);
    return display.includes(q) || username.includes(q) || globalName.includes(q);
  });

  if (partial.length === 1) return { member: partial[0], reason: "partial" };
  if (partial.length > 1) return { member: null, reason: "ambiguous", candidates: partial };
  return { member: null, reason: "not_found" };
}

async function resolveManagedEntries(guild, entries, waiting = false) {
  const resolved = [];
  const errors = [];

  for (const entry of entries) {
    if (!entry?.name) {
      resolved.push(null);
      continue;
    }

    const found = await resolveGuildMemberByLooseName(guild, entry.name);
    if (!found.member) {
      if (found.reason === "ambiguous") {
        errors.push(`"${entry.name}" 와 일치하는 닉네임이 여러 명입니다. 더 구체적으로 적어주세요.`);
      } else {
        errors.push(`"${entry.name}" 사용자를 찾지 못했습니다.`);
      }
      resolved.push(null);
      continue;
    }

    resolved.push({
      userId: found.member.id,
      displayName: found.member.displayName,
      note: waiting ? `${WAIT_PREFIX}${entry.note || ""}` : (entry.note || ""),
    });
  }

  const ids = resolved.filter(Boolean).map((x) => x.userId);
  const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
  if (dup) {
    errors.push("같은 사용자가 여러 슬롯에 중복 배치되었습니다.");
  }

  return { resolved, errors };
}

async function applyManagedMembers(msgId, guild, party, slotsText) {
  const parsed = parseManagedSlotsText(slotsText, party);
  const currentPlaying = playingMembers(party);
  const currentWaiting = waitingMembers(party);

  const playingResolved = await resolveManagedEntries(guild, parsed.playing, false);
  const waitingResolved = await resolveManagedEntries(guild, parsed.waiting, true);
  const errors = [...playingResolved.errors, ...waitingResolved.errors];
  if (errors.length > 0) {
    return { ok: false, error: errors[0] };
  }

  const desiredPlaying = playingResolved.resolved;
  const desiredWaiting = waitingResolved.resolved.filter(Boolean);
  const desiredPlayingIds = new Set(desiredPlaying.filter(Boolean).map((x) => x.userId));

  for (const item of desiredWaiting) {
    if (desiredPlayingIds.has(item.userId)) {
      return { ok: false, error: "같은 사용자를 참가 슬롯과 대기에 동시에 넣을 수 없습니다." };
    }
  }

  const desiredAllIds = new Set([
    ...desiredPlaying.filter(Boolean).map((x) => x.userId),
    ...desiredWaiting.map((x) => x.userId),
  ]);

  for (const member of party.members ?? []) {
    if (!desiredAllIds.has(member.user_id)) {
      await removeMember(msgId, member.user_id);
    }
  }

  for (let i = 0; i < desiredPlaying.length; i++) {
    const item = desiredPlaying[i];
    if (!item) continue;
    await setMemberNote(msgId, item.userId, item.displayName, item.note || "");
  }

  for (const item of desiredWaiting) {
    await setMemberNote(msgId, item.userId, item.displayName, item.note || `${WAIT_PREFIX}`);
  }

  return { ok: true };
}

async function handleParty(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;

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

    if (boardConfig.key === "ETC" && kind === "GAME") {
      createDraft.delete(interaction.user.id);
      await interaction.showModal(createPartyModal(kind, boardConfig)).catch(() => {});
      return true;
    }

    if (kind === "GAME" && Array.isArray(boardConfig.gameSubKinds) && boardConfig.gameSubKinds.length > 0) {
      createDraft.set(interaction.user.id, {
        boardChannelId: interaction.channelId,
        kind,
        originApplicationId: interaction.applicationId,
        originToken: interaction.token,
        originMessageId: null,
      });

      await interaction.reply({
        content: "게임 세부 카테고리를 선택하세요.",
        components: [createGameSubKindRow(boardConfig)],
        ephemeral: true,
      }).catch(() => {});

      const replyMsg = await interaction.fetchReply().catch(() => null);
      if (replyMsg?.id) {
        const d = createDraft.get(interaction.user.id);
        if (d) {
          d.originMessageId = replyMsg.id;
          createDraft.set(interaction.user.id, d);
        }
      }

      return true;
    }

    await interaction.showModal(createPartyModal(kind, boardConfig)).catch(() => {});
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "party:create:game:subkind") {
    const d = createDraft.get(interaction.user.id);
    if (!d || d.boardChannelId !== interaction.channelId || d.kind !== "GAME") {
      await ephemeralError(interaction, "생성 세션이 만료되었습니다. 다시 버튼을 눌러주세요.");
      return true;
    }

    d.subKind = interaction.values[0];
    createDraft.set(interaction.user.id, d);

    const boardConfig = getBoardConfigByChannelId(interaction.channelId);
    await interaction.showModal(createPartyModal("GAME", boardConfig)).catch((err) => {
      console.error("[SHOW_MODAL_ERR]", err);
    });
    return true;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:create:submit:")) {
    await ackModal(interaction);

    const kind = interaction.customId.split(":")[3];

    try {
      const note = getOptionalTextInputValue(interaction, "note");
      const time = getOptionalTextInputValue(interaction, "time");
      let title = getOptionalTextInputValue(interaction, "title");

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
      const subKind = draft?.boardChannelId === interaction.channelId ? (draft.subKind || "") : "";

      if (kind === "GAME" && boardConfig.key !== "ETC" && boardConfig.key !== "STEAM" && subKind) {
        title = subKind;
      }

      if (kind === "GAME" && boardConfig.key === "STEAM" && !title) {
        await ephemeralError(interaction, "게임명을 입력해주세요.");
        return true;
      }

      if (!isUnlimitedKind(kind) && !title) {
        await ephemeralError(interaction, "제목은 필수입니다.");
        return true;
      }

      let maxPlayers = 0;
      if (!isUnlimitedKind(kind)) {
        const parsed = parseMaxPlayers(getOptionalTextInputValue(interaction, "max"));
        if (!parsed) {
          await ephemeralError(interaction, "인원제한은 2~20 사이 숫자여야 합니다.");
          return true;
        }
        maxPlayers = parsed;
      }

      const mentionRoleId = getMentionRoleId(boardConfig, subKind);

      const msg = await board.send({
        content: mentionRoleId ? `<@&${mentionRoleId}>` : undefined,
        embeds: [buildCreatingEmbed(kind)],
        components: [],
        allowedMentions: mentionRoleId
          ? { roles: [mentionRoleId] }
          : { parse: [] },
      });

      const displayName = getDisplayNameFromInteraction(interaction);

      await upsertParty({
        message_id: msg.id,
        channel_id: msg.channel.id,
        guild_id: guild.id,
        owner_id: interaction.user.id,
        kind,
        title: title || "(제목 없음)",
        sub_kind: subKind,
        party_note: note,
        time_text: time || "",
        mode: "TEXT",
        start_at: 0,
        status: "RECRUIT",
        max_players: maxPlayers,
      });

      await setMemberNote(msg.id, interaction.user.id, displayName, "");

      const party = await getParty(msg.id);
      if (party) await refreshPartyMessage(guild, party);

      await deleteCreatePrompt(interaction.client, draft);
      createDraft.delete(interaction.user.id);
      await doneModal(interaction);
      return true;
    } catch (err) {
      console.error("[CREATE_PARTY_ERR]", err);
      await ephemeralError(interaction, `파티 생성 처리 중 오류: ${err?.message ?? err}`);
      return true;
    }
  }

  const msgId = interaction.message?.id;
  if (!msgId) {
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:edit:submit:")) {
      const editMsgId = interaction.customId.split(":")[3];
      const editParty = await getParty(editMsgId);
      if (!editParty) return ephemeralError(interaction, "파티를 찾지 못했습니다.");

      const admin = isAdmin(interaction);
      const ok = admin || interaction.user.id === editParty.owner_id;
      if (!ok) return ephemeralError(interaction, "파티장 또는 운영진만 수정할 수 있습니다.");

      await ackModal(interaction);

      try {
        const boardConfig = getBoardConfigByChannelId(editParty.channel_id);
        const note = getOptionalTextInputValue(interaction, "note");
        const time = getOptionalTextInputValue(interaction, "time");
        let title = getOptionalTextInputValue(interaction, "title");

        if (editParty.kind === "GAME" && boardConfig?.key !== "ETC" && boardConfig?.key !== "STEAM" && editParty.sub_kind) {
          title = editParty.sub_kind;
        }

        if (editParty.kind === "GAME" && boardConfig?.key === "STEAM" && !title) {
          return ephemeralError(interaction, "게임명을 입력해주세요.");
        }

        if (!isUnlimitedKind(editParty.kind) && !title) {
          return ephemeralError(interaction, "제목은 필수입니다.");
        }

        let maxPlayers = Number(editParty.max_players) || 4;
        if (!isUnlimitedKind(editParty.kind)) {
          const parsed = parseMaxPlayers(getOptionalTextInputValue(interaction, "max"));
          if (!parsed) return ephemeralError(interaction, "인원제한은 2~20 사이 숫자여야 합니다.");
          maxPlayers = parsed;
        }

        await upsertParty({
          ...editParty,
          title: title || "(제목 없음)",
          party_note: note,
          time_text: time || "",
          max_players: maxPlayers,
        });

        const updated = await getParty(editMsgId);
        if (updated) await refreshPartyMessage(guild, updated);
        await doneModal(interaction);
        return true;
      } catch (err) {
        console.error("[EDIT_PARTY_ERR]", err);
        await ephemeralError(interaction, "파티 수정 중 오류가 발생했습니다.");
        return true;
      }
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:manage:submit:")) {
      const manageMsgId = interaction.customId.split(":")[3];
      const manageParty = await getParty(manageMsgId);
      if (!manageParty) return ephemeralError(interaction, "파티를 찾지 못했습니다.");
      if (!isAdmin(interaction)) return ephemeralError(interaction, "운영진만 사용할 수 있습니다.");

      await ackModal(interaction);

      try {
        const slotsText = getOptionalTextInputValue(interaction, "slots_text");
        const applied = await applyManagedMembers(manageMsgId, guild, manageParty, slotsText);
        if (!applied.ok) {
          await ephemeralError(interaction, applied.error || "인원 관리 처리에 실패했습니다.");
          return true;
        }

        const updated = await getParty(manageMsgId);
        if (updated) {
          if ((updated.members?.length ?? 0) === 0) {
            await endParty(guild, updated, "전원 이탈(자동종료)");
          } else {
            await refreshPartyMessage(guild, updated);
          }
        }

        await doneModal(interaction);
        return true;
      } catch (err) {
        console.error("[MANAGE_PARTY_ERR]", err);
        await ephemeralError(interaction, "인원 관리 처리 중 오류가 발생했습니다.");
        return true;
      }
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:joinnote:")) {
      await ackModal(interaction);

      try {
        const joinMsgId = interaction.customId.split(":")[2];
        const joinParty = await getParty(joinMsgId);

        if (!joinParty) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");
        if (joinParty.status === "ENDED") return ephemeralError(interaction, "이미 종료된 파티입니다.");

        const inputNote = getOptionalTextInputValue(interaction, "note").slice(0, 80);

        if (!isUnlimitedKind(joinParty.kind)) {
          const maxPlayers = Number(joinParty.max_players) || 4;
          const existsAsPlaying = (joinParty.members ?? []).some(
            (m) => m.user_id === interaction.user.id && !isWaiting(m.note)
          );
          const count = playingCount(joinParty);

          if (!existsAsPlaying && count >= maxPlayers) {
            return ephemeralError(interaction, `이미 정원이 찼습니다. (최대 ${maxPlayers}명)`);
          }
        }

        const me = (joinParty.members ?? []).find((m) => m.user_id === interaction.user.id);
        const base = me ? stripWaitPrefix(me.note) : "";
        const finalNote = inputNote || base || "";
        const displayName = getDisplayNameFromInteraction(interaction);

        await setMemberNote(joinMsgId, interaction.user.id, displayName, finalNote);

        const updated = await getParty(joinMsgId);
        if (updated) await refreshPartyMessage(guild, updated);

        await doneModal(interaction);
        return true;
      } catch {
        await ephemeralError(interaction, "참가/비고 처리 중 오류가 발생했습니다.");
        return true;
      }
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:wait:submit:")) {
      await ackModal(interaction);

      try {
        const waitMsgId = interaction.customId.split(":")[3];
        const waitParty = await getParty(waitMsgId);

        if (!waitParty) return ephemeralError(interaction, "DB에서 파티를 찾지 못했습니다.");
        if (waitParty.status === "ENDED") return ephemeralError(interaction, "이미 종료된 파티입니다.");

        const note = getOptionalTextInputValue(interaction, "note").slice(0, 120);
        const displayName = getDisplayNameFromInteraction(interaction);

        await setMemberNote(waitMsgId, interaction.user.id, displayName, `${WAIT_PREFIX}${note}`);

        const updated = await getParty(waitMsgId);
        if (updated) await refreshPartyMessage(guild, updated);

        await doneModal(interaction);
        return true;
      } catch (err) {
        console.error("[WAIT_SUBMIT_ERR]", err);
        await ephemeralError(interaction, "대기 처리 중 오류가 발생했습니다.");
        return true;
      }
    }

    return false;
  }

  const party = await getParty(msgId);
  if (!party) return false;

  if (interaction.isButton() && interaction.customId === "party:join") {
    await interaction.showModal(joinNoteModal(msgId)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:wait") {
    await interaction.showModal(waitModal(msgId)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:waitoff") {
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

  if (interaction.isButton() && interaction.customId === "party:leave") {
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

  if (interaction.isButton() && interaction.customId === "party:edit") {
    const admin = isAdmin(interaction);
    const ok = admin || interaction.user.id === party.owner_id;
    if (!ok) {
      await ephemeralError(interaction, "파티장 또는 운영진만 수정할 수 있습니다.");
      return true;
    }

    const boardConfig = getBoardConfigByChannelId(party.channel_id);
    await interaction.showModal(editPartyModal(msgId, party, boardConfig, admin)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:manage") {
    if (!isAdmin(interaction)) {
      await ephemeralError(interaction, "운영진만 사용할 수 있습니다.");
      return true;
    }

    const slotsText = await buildParticipants(guild, party);
    await interaction.showModal(manageMembersModal(msgId, slotsText)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:start") {
    const isMember = (party.members ?? []).some((m) => m.user_id === interaction.user.id);
    const ok = isMember || interaction.user.id === party.owner_id || isAdmin(interaction);
    if (!ok) {
      await ephemeralError(interaction, "파티원/파티장/운영진만 가능합니다.");
      return true;
    }

    await ackUpdate(interaction);
    await upsertParty({ ...party, status: "PLAYING", mode: "TEXT", start_at: 0 });
    const updated = await getParty(msgId);
    if (updated) await refreshPartyMessage(guild, updated);
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:end") {
    const isMember = (party.members ?? []).some((m) => m.user_id === interaction.user.id);
    const ok = isMember || interaction.user.id === party.owner_id || isAdmin(interaction);
    if (!ok) {
      await ephemeralError(interaction, "파티원/파티장/운영진만 가능합니다.");
      return true;
    }

    await ackUpdate(interaction);
    await endParty(guild, party, "수동 종료", interaction.message);
    return true;
  }

  if (interaction.isButton() && interaction.customId === "party:delete") {
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
