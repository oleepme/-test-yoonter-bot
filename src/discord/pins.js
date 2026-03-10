async function ensurePinnedMessage(channel, footerText, payloadBuilder) {
  const pins = await channel.messages.fetchPins().catch(() => null);
  if (pins?.find((m) => m.embeds?.[0]?.footer?.text === footerText)) return;

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  await msg.pin().catch(() => {});
}

module.exports = { ensurePinnedMessage };
