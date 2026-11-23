import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendChatContext, getImageReference, recordBotReply } from "../src/context.js";

test("keeps only the latest 50 messages in each chat window", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aifriend-context-"));
  try {
    for (let i = 1; i <= 51; i++) {
      await appendChatContext(123, {
        message_id: i,
        text: `message ${i}`,
        role: "user"
      }, { directory });
    }
    const chat = JSON.parse(await fs.readFile(path.join(directory, "123.json"), "utf8"));
    assert.equal(chat.messages.length, 50);
    assert.equal(chat.messages[0].message_id, 2);
    assert.equal(chat.messages.at(-1).message_id, 51);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("isolates chat windows and deduplicates Telegram message revisions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aifriend-context-"));
  try {
    await appendChatContext(100, { message_id: 1, text: "old", event_id: "telegram:100:1" }, { directory });
    await appendChatContext(100, { message_id: 1, text: "edited", event_id: "telegram:100:1" }, { directory });
    await appendChatContext(200, { message_id: 1, text: "other chat" }, { directory });
    const first = JSON.parse(await fs.readFile(path.join(directory, "100.json"), "utf8"));
    const second = JSON.parse(await fs.readFile(path.join(directory, "200.json"), "utf8"));
    assert.equal(first.messages.length, 1);
    assert.equal(first.messages[0].text, "edited");
    assert.equal(second.messages[0].text, "other chat");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps pending events separately from the rolling context window", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aifriend-context-"));
  try {
    for (let i = 1; i <= 52; i++) {
      await appendChatContext(123, { message_id: i, text: String(i) }, { directory, limit: 50, pending: i === 1 });
    }
    const chat = JSON.parse(await fs.readFile(path.join(directory, "123.json"), "utf8"));
    assert.equal(chat.messages.length, 50);
    assert.equal(chat.pending.length, 1);
    assert.equal(chat.pending[0].message_id, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("records bot replies as assistant messages", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aifriend-context-"));
  try {
    await recordBotReply(123, { message_id: 9, text: "hello", date: 1795450000 }, { directory });
    const chat = JSON.parse(await fs.readFile(path.join(directory, "123.json"), "utf8"));
    assert.equal(chat.messages[0].role, "assistant");
    assert.equal(chat.messages[0].text, "hello");
    assert.equal(chat.messages[0].status, "sent");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("extracts reusable Telegram file IDs without constructing download URLs", () => {
  assert.deepEqual(getImageReference({ photo: [{ file_id: "small", file_unique_id: "s" }, { file_id: "large", file_unique_id: "l" }] }), {
    file_id: "large",
    file_unique_id: "l",
    media_type: "photo",
    mime_type: "image/jpeg"
  });
  assert.equal(getImageReference({ document: { file_id: "pdf", mime_type: "application/pdf" } }), null);
});
