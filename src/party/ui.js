const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const { buildMeta } = require("./meta");

function buildBoardEmbed(config) {
  return new EmbedBuilder()
    .setColor(0x95a5a6)
    .setTitle(config.boardTitle)
    .setDescription("아래 버튼을 눌러 파티를 생성합니다.");
}

function buildBoardComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("party:create")
        .setLabel(`➕ ${config.createLabel}`)
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildSubTypeSelectRow(config) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("party:draft:subtype")
      .setPlaceholder("세부 항목을 선택하세요")
      .addOptions(
        config.subTypes.map((value) => ({
          label: value,
          value
        }))
      )
  );
}

function buildDetailsModal(config) {
  const modal = new ModalBuilder()
    .setCustomId("party:draft:details")
    .setTitle("파티 정보 입력");

  const note = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("특이사항(선택)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  if (config.titleInputMode === "gameTitle") {
    const gameTitle = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("게임명 입력")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(gameTitle),
      new ActionRowBuilder().addComponents(note)
    );
    return modal;
  }

  if (config.titleInputMode === "freeTitle") {
    const freeTitle = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("제목 또는 게임명 입력")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(freeTitle),
      new ActionRowBuilder().addComponents(note)
    );
    return modal;
  }

  // 롤/배그/발로/옵치: 제목 직접입력 없음
  modal.addComponents(new ActionRowBuilder().addComponents(note));
  return modal;
}

function timeModeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("party:draft:asap").setLabel("⚡ 모이면 바로 시작").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("party:draft:time").setLabel("🕒 시간 지정").setStyle(ButtonStyle.Secondary)
  );
}

function hourSelectRow(customId) {
  const options = [];
  for (let h = 0; h <= 23; h += 1) {
    options.push({ label: `${String(h).padStart(2, "0")}시`, value: String(h) });
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("시 선택")
      .addOptions(options.slice(0, 25))
  );
}

function minuteSelectRow(customId) {
  const options = [];
  for (let m = 0; m < 60; m += 5) {
    options.push({ label: `${String(m).padStart(2, "0")}분`, value: String(m) });
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("분(5분 단위) 선택")
      .addOptions(options)
  );
}

function partyActionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("party:join").setLabel("참가/비고").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("party:leave").setLabel("나가기").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("party:time").setLabel("시간변경").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("party:start").setLabel("시작").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("party:end").setLabel("종료").setStyle(ButtonStyle.Danger)
  );
}

function joinNoteModal(msgId) {
  const modal = new ModalBuilder().setCustomId(`party:joinnote:${msgId}`).setTitle("참가 비고(선택)");
  const input = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("비고(선택) 예: 늦참10 / 마이크X / 뉴비")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function statusLabel(status) {
  if (status === "PLAYING") return "🟢 플레이중";
  if (status === "END") return "⚫ 종료";
  return "🔴 모집중";
}

function buildPartyEmbed({
  ownerId,
  ownerRoleLabel,
  displayTitle,
  note,
  mode,
  startAtUnix,
  status,
  members,
  meta
}) {
  const startLine = mode === "ASAP"
    ? "⚡ 모이면 바로 시작"
    : `🕒 <t:${startAtUnix}:F> ( <t:${startAtUnix}:R> )`;

  const noteLine = note?.trim() ? note.trim() : "(없음)";
  const memberLines = (members?.length ? members : [{ userId: ownerId, note: "" }])
    .map((m, idx) => `${idx + 1}. <@${m.userId}>${m.note ? ` — ${m.note}` : ""}`)
    .join("\n");

  return new EmbedBuilder()
    .setColor(status === "PLAYING" ? 0x2ecc71 : 0xe74c3c)
    .setTitle(displayTitle)
    .setDescription(
      ownerRoleLabel
        ? `👤 파티장: <@${ownerId}> (${ownerRoleLabel})`
        : `👤 파티장: <@${ownerId}>`
    )
    .addFields(
      { name: "상태", value: statusLabel(status), inline: true },
      { name: "시간", value: startLine, inline: true },
      { name: "주문서 특이사항", value: noteLine, inline: false },
      { name: "참가자", value: memberLines, inline: false }
    )
    .setFooter({ text: buildMeta(meta) });
}

module.exports = {
  buildBoardEmbed,
  buildBoardComponents,
  buildSubTypeSelectRow,
  buildDetailsModal,
  timeModeRow,
  hourSelectRow,
  minuteSelectRow,
  partyActionRow,
  joinNoteModal,
  buildPartyEmbed
};