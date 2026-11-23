import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONTEXT_WINDOW = 50;
const MAX_PENDING = 10000;

function safeChatId(chatId) {
  const value = String(chatId);
  if (!/^-?\d+$/.test(value)) throw new Error("chat_id must be numeric");
  return value;
}

function emptyChat(chatId, limit) {
  return {
    schema_version: 1,
    chat_id: Number(chatId),
    window_size: limit,
    messages: [],
    pending: [],
    updated_at: null
  };
}

async function readChatFile(filePath, chatId, limit) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return {
      ...emptyChat(chatId, limit),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      pending: Array.isArray(parsed.pending) ? parsed.pending : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return emptyChat(chatId, limit);
  }
}

/**
 * Append or revise one Telegram message in a per-chat rolling context window.
 * Pending events are kept separately so a burst of messages cannot evict an
 * unprocessed event from the ChatGPT inbox before it is handled.
 */
export async function appendChatContext(chatIdInput, entry, options = {}) {
  const chatId = safeChatId(chatIdInput);
  const directory = options.directory || process.env.AIFRIEND_CONTEXT_DIR;
  if (!directory) throw new Error("Missing AIFRIEND_CONTEXT_DIR");
  const limit = Number.isSafeInteger(options.limit) && options.limit > 0
    ? options.limit
    : DEFAULT_CONTEXT_WINDOW;
  const filePath = path.join(directory, `${chatId}.json`);
  await fs.mkdir(directory, { recursive: true });
  const chat = await readChatFile(filePath, chatId, limit);
  const normalized = {
    ...entry,
    chat_id: Number(chatId),
    event_id: entry.event_id || `telegram:${chatId}:${entry.message_id}`,
    recorded_at: entry.recorded_at || new Date().toISOString()
  };

  const existingIndex = chat.messages.findIndex(item => item.event_id === normalized.event_id);
  if (existingIndex >= 0) chat.messages[existingIndex] = normalized;
  else chat.messages.push(normalized);
  chat.messages = chat.messages.slice(-limit);
  chat.window_size = limit;

  if (options.pending) {
    const pendingIndex = chat.pending.findIndex(item => item.event_id === normalized.event_id);
    if (pendingIndex >= 0) chat.pending[pendingIndex] = normalized;
    else chat.pending.push(normalized);
    chat.pending = chat.pending.slice(-MAX_PENDING);
  }

  chat.updated_at = new Date().toISOString();
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(chat, null, 2) + "\n", "utf8");
  await fs.rename(temporary, filePath);
  return chat;
}

export async function pruneProcessedPending(directory, processedUpdateIds = []) {
  if (!directory) throw new Error("Missing AIFRIEND_CONTEXT_DIR");
  const processed = new Set(processedUpdateIds.map(Number));
  let removed = 0;
  let files = [];
  try {
    files = await fs.readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  for (const name of files.filter(item => /^-?\\d+\\.json$/.test(item))) {
    const filePath = path.join(directory, name);
    const chat = JSON.parse(await fs.readFile(filePath, "utf8"));
    const pending = Array.isArray(chat.pending) ? chat.pending : [];
    const remaining = pending.filter(item => !processed.has(Number(item.update_id)));
    if (remaining.length === pending.length) continue;
    removed += pending.length - remaining.length;
    chat.pending = remaining;
    chat.updated_at = new Date().toISOString();
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(chat, null, 2) + "\\n", "utf8");
    await fs.rename(temporary, filePath);
  }
  return removed;
}

export async function readChatContext(chatIdInput, options = {}) {
  const chatId = safeChatId(chatIdInput);
  const directory = options.directory || process.env.AIFRIEND_CONTEXT_DIR;
  if (!directory) throw new Error("Missing AIFRIEND_CONTEXT_DIR");
  const requested = Number.isSafeInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, DEFAULT_CONTEXT_WINDOW)
    : DEFAULT_CONTEXT_WINDOW;
  const filePath = path.join(directory, `${chatId}.json`);
  const chat = await readChatFile(filePath, chatId, DEFAULT_CONTEXT_WINDOW);
  return {
    chat_id: Number(chatId),
    messages: chat.messages.slice(-requested),
    pending: chat.pending,
    window_size: chat.window_size || DEFAULT_CONTEXT_WINDOW
  };
}

export async function recordBotReply(chatId, message, options = {}) {
  return appendChatContext(chatId, {
    role: "assistant",
    source: "telegram_bot",
    message_id: message.message_id,
    text: message.text || "",
    date: message.date,
    reply_to_message_id: message.reply_to_message?.message_id || null,
    status: "sent"
  }, options);
}

export function getImageReference(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    const selected = [...message.photo].sort((a, b) =>
      (b.file_size || 0) - (a.file_size || 0) ||
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
    )[0];
    return {
      file_id: selected.file_id,
      file_unique_id: selected.file_unique_id || null,
      media_type: "photo",
      mime_type: "image/jpeg"
    };
  }
  const document = message.document;
  if (document && /^image\/(jpeg|png|webp|gif)$/i.test(document.mime_type || "")) {
    return {
      file_id: document.file_id,
      file_unique_id: document.file_unique_id || null,
      media_type: "document",
      mime_type: document.mime_type
    };
  }
  return null;
}
