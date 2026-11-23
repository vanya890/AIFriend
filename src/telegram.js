const API = "https://api.telegram.org";

function getToken() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return value;
}

export async function telegram(method, payload = {}) {
  const response = await fetch(`${API}/bot${getToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram API ${method} failed: ${result.description || response.status}`);
  }
  return result.result;
}

export async function getUpdates(offset) {
  return telegram("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["channel_post", "edited_channel_post", "message", "my_chat_member"]
  });
}

export async function sendMessage(chatId, text, replyToMessageId = null) {
  const payload = { chat_id: chatId, text: String(text).slice(0, 4096) };
  if (replyToMessageId) {
    payload.reply_parameters = {
      message_id: replyToMessageId,
      allow_sending_without_reply: false
    };
  }
  return telegram("sendMessage", payload);
}
