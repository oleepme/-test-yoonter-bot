async function findManagedMessage(channel, footerText, recentLimit = 30) {
  // 1) pinned 메시지 먼저 확인
  const pins = await channel.messages.fetchPins().catch(() => null);
  const pinnedMatch = pins?.find(
    (m) => m.embeds?.[0]?.footer?.text === footerText
  );
  if (pinnedMatch) {
    console.log("PIN_REUSED", { channelId: channel.id, source: "pins", footerText });
    return pinnedMatch;
  }

  // 2) 최근 메시지 검색
  const recentMessages = await channel.messages.fetch({ limit: recentLimit }).catch(() => null);
  const recentMatch = recentMessages?.find(
    (m) => m.embeds?.[0]?.footer?.text === footerText
  );
  if (recentMatch) {
    console.log("PIN_REUSED", { channelId: channel.id, source: "recent", footerText });

    // 최근 메시지에서 찾았으면 다시 pin 보장
    await recentMatch.pin().catch(() => {});
    return recentMatch;
  }

  return null;
}

async function ensurePinnedMessage(channel, footerText, payloadBuilder) {
  const existing = await findManagedMessage(channel, footerText);
  if (existing) return existing;

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});

  console.log("PIN_CREATED", { channelId: channel.id, footerText });
  return msg;
}

module.exports = {
  ensurePinnedMessage,
  findManagedMessage
};