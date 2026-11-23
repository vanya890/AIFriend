import fs from "node:fs/promises";
import path from "node:path";

const STATE_PATH = process.env.STATE_PATH || "data/state.json";
const MAX_PROCESSED = 5000;
const MAX_THREAD_MESSAGES = 40;

export async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return emptyState();
  }
}

export function emptyState() {
  return {
    schema_version: 1,
    offset: 0,
    channels: {},
    threads: {},
    memory: { summary: "", facts: [] },
    processed_updates: []
  };
}

export async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const temp = STATE_PATH + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fs.rename(temp, STATE_PATH);
}

export function wasProcessed(state, updateId) {
  return state.processed_updates.includes(updateId);
}

export function markProcessed(state, updateId) {
  state.processed_updates.push(updateId);
  if (state.processed_updates.length > MAX_PROCESSED) {
    state.processed_updates = state.processed_updates.slice(-MAX_PROCESSED);
  }
}

export function addThreadMessage(state, key, message) {
  const thread = state.threads[key] ||= { messages: [], updated_at: null, discussion_chat_id: null, root_message_id: null };
  thread.messages.push(message);
  thread.messages = thread.messages.slice(-MAX_THREAD_MESSAGES);
  thread.updated_at = new Date().toISOString();
  return thread;
}

export function buildMemoryContext(state, threadKey) {
  const thread = state.threads[threadKey];
  return {
    shared_memory: state.memory,
    recent_thread_messages: thread?.messages || []
  };
}
