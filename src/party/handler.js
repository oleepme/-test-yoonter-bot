const { InteractionType, EmbedBuilder } = require("discord.js");
const { safeTrim } = require("../discord/util");
const { logEmbed, field } = require("../discord/log");
const { parseMeta } = require("./meta");
const { clearTimer } = require("./scheduler");
const {
  buildSubTypeSelectRow,
  buildDetailsModal,
  timeModeRow,
  hourSelectRow,
  minuteSelectRow,
  partyActionRow,
  joinNoteModal,
  buildPartyEmbed
} = require("./ui");
const {
  getBoardConfigByChannelId,
  getMentionRoleId,
  buildPartyDisplayTitle
} = require("./channelConfig");

const draft = new Map();

function getOwnerRoleLabel(member) {
  const roleNames = member.roles?.cache
    ?.filter((r) => r.name !== "@everyone")
    ?.map((r) => r.name) ?? [];

  return roleNames[0] ?? "";
}

function parseMembersFromEmbed(embed) {
  const fields = embed.data.fields ?? [];
  const memberField = fields.find((f) => f.name === "참가자");
  if (!memberField?.value) return [];

  return memberField.value
    .split("\n")
    .map((line) => {
      const match = line.match(/<@(\d+)>/);
      if (!match) return null;

      const noteMatch = line.split("—")[1];
      return {
        userId: match[1],
        note: noteMatch ? noteMatch.trim() : ""
      };
    })
    .filter(Boolean);
}

async function createPartyMessage({
  interaction,
  guild,
  d,
  mode,
  startAtUnix
}) {
  const board = interaction.channel;
  if (!board?.isTextBased()) {
    await interaction.reply({ content: "이 채널에서는 파티를 생성할 수 없습니다.", ephemeral: true });
    return true;
  }

  const ownerMember = await guild.members.fetch(interaction.user.id);
  const roleLabel = getOwnerRoleLabel(ownerMember);
  const displayTitle = buildPartyDisplayTitle({
    config: d.config,
    subType: d.subType,
    title: d.title
  });

  const meta = {
    owner: interaction.user.id,
    ownerRole: roleLabel || "",
    gameKey: d.config.gameKey,
    subType: d.subType,
    title: d.title || "",
    mode,
    startAt: String(startAtUnix),
    status: "RECRUIT"
  };

  const embed = buildPartyEmbed({
    ownerId: interaction.user.id,
    ownerRoleLabel: roleLabel,
    displayTitle,
    note: d.note,
    mode,
    startAtUnix,
    status: "RECRUIT",
    members: [{ userId: interaction.user.id, note: "" }],
    meta
  });

  const mentionRoleId = getMentionRoleId(d.config, d.subType);
  const content = mentionRoleId ? `<@&${mentionRoleId}>` : undefined;

  const msg = await board.send({
    content,
    embeds: [embed],
    components: [partyActionRow()],
    allowedMentions: mentionRoleId ? { roles: [mentionRoleId] } : { parse: [] }
  });

  await interaction.reply({ content: "✅ 파티가 생성되었습니다.", ephemeral: true });

  await logEmbed(guild, {
    title: mode === "ASAP" ? "✅ 파티 생성(모바시)" : "✅ 파티 생성(시간지정)",
    color: 0x2ecc71,
    fields: [
      field("파티 메시지 ID", msg.id, true),
      field("유저", `<@${interaction.user.id}>`, true),
      field("채널", `<#${board.id}>`, true),
      field("게임", d.config.displayPrefix, true),
      field("세부", d.subType, true),
      field("표시 제목", displayTitle),
      field("시작", mode === "ASAP" ? "모이면 바로 시작" : `<t:${startAtUnix}:F>`)
    ]
  });

  draft.delete(interaction.user.id);
  return true;
}

async function handleParty(interaction) {
  const guild = interaction.guild;
  if (!guild) return false;

  // 1) 게시판 생성 버튼
  if (interaction.isButton() && interaction.customId === "party:create") {
    const config = getBoardConfigByChannelId(interaction.channelId);
    if (!config) {
      await interaction.reply({ content: "이 채널은 파티 생성 채널이 아닙니다.", ephemeral: true });
      return true;
    }

    draft.set(interaction.user.id, {
      channelId: interaction.channelId,
      config
    });

    await interaction.reply({
      content: "세부 항목을 선택하세요.",
      components: [buildSubTypeSelectRow(config)],
      ephemeral: true
    });
    return true;
  }

  // 2) 세부 항목 선택
  if (interaction.isStringSelectMenu() && interaction.customId === "party:draft:subtype") {
    const d = draft.get(interaction.user.id);
    if (!d?.config) {
      await interaction.reply({ content: "세션이 만료되었습니다. 다시 만들어주세요.", ephemeral: true });
      return true;
    }

    d.subType = interaction.values[0];
    draft.set(interaction.user.id, d);

    const modal = buildDetailsModal(d.config);
    await interaction.showModal(modal);
    return true;
  }

  // 3) 상세 정보 모달 제출
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "party:draft:details") {
    const d = draft.get(interaction.user.id);
    if (!d?.config || !d?.subType) {
      await interaction.reply({ content: "세션이 만료되었습니다. 다시 만들어주세요.", ephemeral: true });
      return true;
    }

    const note = safeTrim(interaction.fields.getTextInputValue("note")).slice(0, 300);

    if (d.config.titleInputMode === "gameTitle" || d.config.titleInputMode === "freeTitle") {
      const title = safeTrim(interaction.fields.getTextInputValue("title")).slice(0, 80);
      if (!title) {
        await interaction.reply({ content: "제목 또는 게임명을 입력해주세요.", ephemeral: true });
        return true;
      }
      d.title = title;
    } else {
      d.title = "";
    }

    d.note = note;
    draft.set(interaction.user.id, d);

    await interaction.reply({
      content: "시작 방식을 선택하세요.",
      components: [timeModeRow()],
      ephemeral: true
    });
    return true;
  }

  // 4) 모이면 바로 시작
  if (interaction.isButton() && interaction.customId === "party:draft:asap") {
    const d = draft.get(interaction.user.id);
    if (!d?.config || !d?.subType) {
      await interaction.reply({ content: "세션이 만료되었습니다. 다시 만들어주세요.", ephemeral: true });
      return true;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    return createPartyMessage({
      interaction,
      guild,
      d,
      mode: "ASAP",
      startAtUnix: nowUnix
    });
  }

  // 5) 시간 지정 - 시 선택
  if (interaction.isButton() && interaction.customId === "party:draft:time") {
    await interaction.reply({
      content: "시를 선택하세요.",
      components: [hourSelectRow("party:draft:hh")],
      ephemeral: true
    });
    return true;
  }

  // 6) 시 선택
  if (interaction.isStringSelectMenu() && interaction.customId === "party:draft:hh") {
    const d = draft.get(interaction.user.id) ?? {};
    d.hh = Number(interaction.values[0]);
    draft.set(interaction.user.id, d);

    await interaction.reply({
      content: "분(5분 단위)을 선택하세요.",
      components: [minuteSelectRow("party:draft:mm")],
      ephemeral: true
    });
    return true;
  }

  // 7) 분 선택 후 생성
  if (interaction.isStringSelectMenu() && interaction.customId === "party:draft:mm") {
    const d = draft.get(interaction.user.id);
    if (!d?.config || !d?.subType || typeof d.hh !== "number") {
      await interaction.reply({ content: "세션이 만료되었습니다. 다시 만들어주세요.", ephemeral: true });
      return true;
    }

    const mm = Number(interaction.values[0]);
    const start = new Date();
    start.setSeconds(0, 0);
    start.setHours(d.hh, mm, 0, 0);

    const startAtUnix = Math.floor(start.getTime() / 1000);

    return createPartyMessage({
      interaction,
      guild,
      d,
      mode: "TIME",
      startAtUnix
    });
  }

  // 8) 파티 메시지 버튼들
  if (interaction.isButton() && interaction.customId.startsWith("party:")) {
    const msg = interaction.message;
    const embed = msg.embeds?.[0];
    const meta = parseMeta(embed?.footer?.text);

    if (!meta) {
      await interaction.reply({ content: "이 메시지는 파티 주문서가 아닙니다.", ephemeral: true });
      return true;
    }

    if (interaction.customId === "party:join") {
      await interaction.showModal(joinNoteModal(msg.id));
      return true;
    }

    if (interaction.customId === "party:leave") {
      const rebuilt = EmbedBuilder.from(embed);
      const members = parseMembersFromEmbed(rebuilt).filter((m) => m.userId !== interaction.user.id);

      const newEmbed = EmbedBuilder.from(embed);
      const fields = newEmbed.data.fields ?? [];
      const idx = fields.findIndex((f) => f.name === "참가자");
      const memberLines = members.length
        ? members.map((m, i) => `${i + 1}. <@${m.userId}>${m.note ? ` — ${m.note}` : ""}`).join("\n")
        : "1.";

      if (idx >= 0) fields[idx].value = memberLines;
      newEmbed.setFields(fields);

      await msg.edit({ embeds: [newEmbed], components: [partyActionRow()] });
      await interaction.reply({ content: "➖ 나가기 처리 완료", ephemeral: true });

      await logEmbed(guild, {
        title: "➖ 파티 나가기",
        fields: [
          field("파티 메시지 ID", msg.id, true),
          field("유저", `<@${interaction.user.id}>`, true)
        ]
      });
      return true;
    }

    if (interaction.customId === "party:end") {
      if (interaction.user.id !== meta.owner) {
        await interaction.reply({ content: "파티장만 종료할 수 있습니다.", ephemeral: true });
        await logEmbed(guild, {
          title: "🛑 종료 시도(거부)",
          color: 0xe67e22,
          fields: [
            field("파티 메시지 ID", msg.id, true),
            field("시도 유저", `<@${interaction.user.id}>`, true),
            field("파티장", `<@${meta.owner}>`, true)
          ]
        });
        return true;
      }

      clearTimer(msg.id);
      await interaction.reply({ content: "🛑 파티를 종료하고 주문서를 삭제합니다.", ephemeral: true });

      await logEmbed(guild, {
        title: "🛑 파티 종료",
        color: 0xe74c3c,
        fields: [
          field("파티 메시지 ID", msg.id, true),
          field("종료자", `<@${interaction.user.id}>`, true)
        ]
      });

      await msg.delete().catch(() => {});
      return true;
    }

    await interaction.reply({ content: "이 기능은 다음 단계에서 확장합니다.", ephemeral: true });
    return true;
  }

  // 9) 참가 비고 모달 제출
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith("party:joinnote:")) {
    const msgId = interaction.customId.split(":")[2];
    const board = interaction.channel;
    if (!board?.isTextBased()) {
      await interaction.reply({ content: "주문서를 찾지 못했습니다.", ephemeral: true });
      return true;
    }

    const msg = await board.messages.fetch(msgId).catch(() => null);
    if (!msg) {
      await interaction.reply({ content: "주문서를 찾지 못했습니다.", ephemeral: true });
      return true;
    }

    const embed = msg.embeds?.[0];
    const meta = parseMeta(embed?.footer?.text);
    if (!meta) {
      await interaction.reply({ content: "주문서 메타를 찾지 못했습니다.", ephemeral: true });
      return true;
    }

    const rebuilt = EmbedBuilder.from(embed);
    const members = parseMembersFromEmbed(rebuilt);
    const inputNote = safeTrim(interaction.fields.getTextInputValue("note")).slice(0, 80);

    const idx = members.findIndex((m) => m.userId === interaction.user.id);
    if (idx >= 0) members[idx].note = inputNote;
    else members.push({ userId: interaction.user.id, note: inputNote });

    const newEmbed = EmbedBuilder.from(embed);
    const fields = newEmbed.data.fields ?? [];
    const fidx = fields.findIndex((f) => f.name === "참가자");
    const memberLines = members
      .map((m, i) => `${i + 1}. <@${m.userId}>${m.note ? ` — ${m.note}` : ""}`)
      .join("\n");

    if (fidx >= 0) fields[fidx].value = memberLines;
    newEmbed.setFields(fields);

    await msg.edit({ embeds: [newEmbed], components: [partyActionRow()] });
    await interaction.reply({ content: "➕ 참가/비고 반영 완료", ephemeral: true });

    await logEmbed(guild, {
      title: "➕ 파티 참가/비고",
      fields: [
        field("파티 메시지 ID", msg.id, true),
        field("유저", `<@${interaction.user.id}>`, true),
        field("비고", inputNote || "(없음)")
      ]
    });
    return true;
  }

  return false;
}

module.exports = { handleParty };