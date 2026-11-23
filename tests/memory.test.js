import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, wasProcessed, markProcessed, rememberMessage, createPrivateMessageEntry } from "../src/memory.js";

test("state starts with initialized inbox and memory", () => {
  const state = emptyState();
  assert.deepEqual(state.inbox, []);
  assert.deepEqual(state.private_chats, {});
  assert.deepEqual(state.memory.facts, []);
});

test("legacy state migrates threads and initializes missing collections", () => {
  const state = normalizeState({
    offset: 7,
    threads: { "-100:5": { messages: [{ text: "saved" }] } },
    memory: { summary: "keep this", facts: ["fact"] },
    processed_updates: [1, 2]
  });
  assert.deepEqual(state.posts["-100:5"].messages, [{ text: "saved" }]);
  assert.deepEqual(state.inbox, []);
  assert.deepEqual(state.discussions, {});
  assert.equal(state.offset, 7);
  assert.equal(state.memory.summary, "keep this");
  assert.deepEqual(state.processed_updates, [1, 2]);
});

test("update ids are tracked", () => {
  const state = emptyState();
  assert.equal(wasProcessed(state, 12), false);
  markProcessed(state, 12);
  assert.equal(wasProcessed(state, 12), true);
});

test("post history is keyed and appended", () => {
  const state = emptyState();
  rememberMessage(state, "-100:5", { text: "hello" });
  assert.equal(state.posts["-100:5"].messages[0].text, "hello");
});

test("private Telegram messages become isolated pending inbox events", () => {
  const entry = createPrivateMessageEntry({
    chat: { id: 12345, type: "private" },
    from: { id: 12345, username: "alice", first_name: "Alice", last_name: "Example" },
    message_id: 77,
    date: 1795450000,
    text: "/start"
  }, 901, "2026-11-23T16:00:00.000Z");

  assert.deepEqual(entry, {
    update_id: 901,
    type: "private_message",
    chat_id: 12345,
    message_id: 77,
    user_id: 12345,
    username: "alice",
    display_name: "Alice Example",
    text: "/start",
    date: 1795450000,
    received_at: "2026-11-23T16:00:00.000Z",
    status: "pending"
  });
});

test("private message captions and non-text messages are retained", () => {
  const base = { chat: { id: 12345 }, from: { id: 12345 }, message_id: 78, date: 1795450001 };
  assert.equal(createPrivateMessageEntry({ ...base, caption: "photo caption" }, 902).text, "photo caption");
  assert.equal(createPrivateMessageEntry({ ...base, photo: [{}] }, 903).text, "[photo]");
});
