import test from "node:test";
import assert from "node:assert/strict";
import { selectImageFile, detectImageFormat, saveTelegramImage } from "../src/media.js";

test("selects the largest Telegram photo variant", () => {
  const selected = selectImageFile({
    photo: [
      { file_id: "small", file_unique_id: "s", file_size: 100, width: 90, height: 90 },
      { file_id: "large", file_unique_id: "l", file_size: 900, width: 1280, height: 1280 }
    ]
  });
  assert.equal(selected.file_id, "large");
  assert.equal(selected.mime_type, "image/jpeg");
});

test("accepts supported image documents and ignores other documents", () => {
  assert.equal(selectImageFile({ document: { file_id: "img", mime_type: "image/png" } }).file_id, "img");
  assert.equal(selectImageFile({ document: { file_id: "pdf", mime_type: "application/pdf" } }), null);
  assert.equal(selectImageFile({ document: { file_id: "svg", mime_type: "image/svg+xml" } }), null);
});

test("detects image bytes rather than trusting file metadata", () => {
  assert.deepEqual(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0x00])), { mime_type: "image/jpeg", extension: "jpg" });
  assert.deepEqual(detectImageFormat(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), { mime_type: "image/png", extension: "png" });
  assert.deepEqual(detectImageFormat(Buffer.from("GIF89a")), { mime_type: "image/gif", extension: "gif" });
  assert.deepEqual(detectImageFormat(Buffer.from("RIFF0000WEBP")), { mime_type: "image/webp", extension: "webp" });
  assert.equal(detectImageFormat(Buffer.from("not an image")), null);
});

test("does not publish images from channels without a public username", async () => {
  const result = await saveTelegramImage({
    photo: [{ file_id: "secret-file", file_unique_id: "secret", file_size: 100 }]
  }, { id: -100123, username: null });
  assert.equal(result.status, "not_published");
  assert.match(result.reason, /not copied to the public repository/);
});

test("skips images above the repository storage limit without downloading", async () => {
  const result = await saveTelegramImage({
    photo: [{ file_id: "large-file", file_unique_id: "large", file_size: 9 * 1024 * 1024 }]
  }, { id: -100123, username: "public_channel" });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /storage limit/);
});
