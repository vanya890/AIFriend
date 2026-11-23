import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH = process.env.STATE_PATH || "data/state.json";
const MAX_PROCESSED = 10000;
const MAX_MESSAGES_PER_POST = 100;

export function emptyState() {
  return {
    schema_version: 1,
    offset: 0,
    channels: {},
    posts: {},
    discussions: {},
    private_chats: {},
    inbox: [],
    memory: { summary: "", facts: [], updated_at: null },
    processed_updates: []
  };
}

export function normalizeState(raw = {}) {
  const base = emptyState();
  return {
    ...base,
    ...raw,
    channels: raw.channels && typeof raw.channels === "object" ? raw.channels : {},
    posts: raw.posts && typeof raw.posts === "object"
      ? raw.posts
      : raw.threads && typeof raw.threads === "object" ? raw.threads : {},
    discussions: raw.discussions && typeof raw.discussions === "object" ? raw.discussions : {},
    private_chats: raw.private_chats && typeof raw.private_chats === "object" ? raw.private_chats : {},
    inbox: Array.isArray(raw.inbox) ? raw.inbox : [],
    memory: { ...base.memory, ...(raw.memory || {}) },
    processed_updates: Array.isArray(raw.processed_updates) ? raw.processed_updates : [],
    offset: Number.isSafeInteger(raw.offset) && raw.offset >= 0 ? raw.offset : 0
  };
}

export async function loadState() {
  try {
    return normalizeState(JSON.parse(await fs.readFile(STATE_PATH, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return emptyState();
  }
}

export async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temp = STATE_PATH + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fs.rename(temp, STATE_PATH);
}

export function wasProcessed(state, id) {
  return state.processed_updates.includes(id);
}

export function markProcessed(state, id) {
  state.processed_updates.push(id);
  if (state.processed_updates.length > MAX_PROCESSED) {
    state.processed_updates = state.processed_updates.slice(-MAX_PROCESSED);
  }
}

export function createPrivateMessageEntry(message, updateId, receivedAt = new Date().toISOString()) {
  const from = message.from || {};
  const text = message.text || message.caption || (
    message.photo ? "[photo]" :
    message.video ? "[video]" :
    message.document ? "[document]" :
    "[non-text message]"
  );
  return {
    update_id: updateId,
    type: "private_message",
    chat_id: message.chat.id,
    message_id: message.message_id,
    user_id: from.id,
    username: from.username || null,
    display_name: [from.first_name, from.last_name].filter(Boolean).join(" "),
    text,
    date: message.date,
    received_at: receivedAt,
    status: "pending"
  };
}

export function rememberMessage(state, key, message) {
  const thread = state.posts[key] ||= { messages: [], discussion_chat_id: null, discussion_root_id: null };
  thread.messages.push(message);
  if (thread.messages.length > MAX_MESSAGES_PER_POST) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES_PER_POST);
  return thread;
}
