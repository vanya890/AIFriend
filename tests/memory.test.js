import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, normalizeState, wasProcessed, markProcessed, rememberMessage } from "../src/memory.js";

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
