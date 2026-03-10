const { ENABLE_NICK, ENABLE_PARTY, ENABLE_WELCOME } = require("../config");
const { handleNickname } = require("../features/nickname/handler");
const { handleParty } = require("../party/handler");
const { bindWelcomeEvents } = require("../features/welcome/handler");

function bindEvents(client) {
  if (ENABLE_WELCOME) {
    bindWelcomeEvents(client);
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
        await interaction.reply({ content: "pong", ephemeral: true });
        return;
      }

      if (ENABLE_NICK) {
        const handled = await handleNickname(interaction);
        if (handled) return;
      }

      if (ENABLE_PARTY) {
        const handled = await handleParty(interaction);
        if (handled) return;
      }
    } catch (e) {
      console.error("INTERACTION_CREATE_FAIL", e);
      if (interaction.isRepliable()) {
        try {
          await interaction.reply({
            content: "⚠️ 오류가 발생했습니다. 로그 채널을 확인하세요.",
            ephemeral: true
          });
        } catch {}
      }
    }
  });
}

module.exports = { bindEvents };
