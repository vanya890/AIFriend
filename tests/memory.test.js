import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, wasProcessed, markProcessed, rememberMessage } from "../src/memory.js";

test("state starts with empty inbox and memory", () => {
  const state = emptyState();
  assert.deepEqual(state.inbox, undefined);
  assert.deepEqual(state.memory.facts, []);
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
