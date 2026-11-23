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
    memory: { summary: "", facts: [], updated_at: null },
    processed_updates: []
  };
}

export async function loadState() {
  try {
    return { ...emptyState(), ...JSON.parse(await fs.readFile(STATE_PATH, "utf8")) };
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

export function rememberMessage(state, key, message) {
  const thread = state.posts[key] ||= { messages: [], discussion_chat_id: null, discussion_root_id: null };
  thread.messages.push(message);
  if (thread.messages.length > MAX_MESSAGES_PER_POST) thread.messages.splice(0, thread.messages.length - MAX_MESSAGES_PER_POST);
  return thread;
}
