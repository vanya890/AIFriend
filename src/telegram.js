const API = "https://api.telegram.org";

function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  return value;
}

export async function telegram(method, payload = {}) {
  const response = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000)
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram API ${method} failed: ${body.description || response.status}`);
  }
  return body.result;
}

export async function getUpdates(offset) {
  return telegram("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["channel_post", "edited_channel_post", "message", "my_chat_member"]
  });
}

export async function sendThreadReply(chatId, rootMessageId, text) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    reply_parameters: { message_id: rootMessageId, allow_sending_without_reply: false }
  });
}
