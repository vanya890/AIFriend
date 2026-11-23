import fs from "node:fs/promises";
import path from "node:path";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

export function selectImageFile(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    const photo = [...message.photo].sort((a, b) =>
      (b.file_size || 0) - (a.file_size || 0) ||
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
    )[0];
    return { ...photo, media_kind: "photo", mime_type: "image/jpeg" };
  }

  const document = message.document;
  if (document && /^image\/(jpeg|png|webp|gif)$/i.test(document.mime_type || "")) {
    return { ...document, media_kind: "document" };
  }
  return null;
}

export function detectImageFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime_type: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime_type: "image/png", extension: "png" };
  }
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { mime_type: "image/gif", extension: "gif" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mime_type: "image/webp", extension: "webp" };
  }
  return null;
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTelegramFile(fileId, token) {
  const apiResponse = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
    signal: AbortSignal.timeout(25_000)
  });
  const apiResult = await apiResponse.json();
  if (!apiResponse.ok || !apiResult.ok) {
    throw new Error(`Telegram getFile failed: ${apiResult.description || apiResponse.status}`);
  }
  return apiResult.result;
}

export async function saveTelegramImage(message, chat, options = {}) {
  const selected = selectImageFile(message);
  if (!selected) return null;

  if (selected.file_size && selected.file_size > MAX_IMAGE_BYTES) {
    return {
      status: "skipped",
      reason: `Image exceeds the ${MAX_IMAGE_BYTES} byte storage limit.`,
      file_size: selected.file_size
    };
  }

  const token = options.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const directory = options.directory || process.env.AIFRIEND_MEDIA_DIR || "/tmp/aifriend-media";
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const file = await fetchTelegramFile(selected.file_id, token);
      if (file.file_size && file.file_size > MAX_IMAGE_BYTES) {
        return {
          status: "skipped",
          reason: `Image exceeds the ${MAX_IMAGE_BYTES} byte storage limit.`,
          file_size: file.file_size
        };
      }
      const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
        signal: AbortSignal.timeout(25_000)
      });
      if (!response.ok) throw new Error(`Telegram file download failed: HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_IMAGE_BYTES) {
        return { status: "skipped", reason: `Image exceeds the ${MAX_IMAGE_BYTES} byte storage limit.`, file_size: contentLength };
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        return { status: "skipped", reason: "Image is empty or exceeds the storage limit.", file_size: bytes.length };
      }
      const format = detectImageFormat(bytes);
      if (!format) {
        return { status: "skipped", reason: "Downloaded file is not a supported JPEG, PNG, GIF, or WebP image." };
      }

      const chatPart = String(chat.id).replace(/[^0-9-]/g, "").replace(/-/g, "m");
      const uniquePart = String(selected.file_unique_id || selected.file_id).replace(/[^A-Za-z0-9_-]/g, "");
      const filename = `${chatPart}_${message.message_id}_${uniquePart}.${format.extension}`;
      const target = path.join(directory, filename);
      await fs.mkdir(directory, { recursive: true });
      try {
        const existing = await fs.stat(target);
        if (existing.size > 0) {
          return {
            status: "available",
            path: target,
            artifact_name: `telegram-media-${process.env.GITHUB_RUN_ID || "local"}`,\n            artifact_run_id: process.env.GITHUB_RUN_ID || null,
            mime_type: format.mime_type,
            size: existing.size,
            file_unique_id: selected.file_unique_id
          };
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      const temporary = target + ".tmp";
      await fs.writeFile(temporary, bytes, { flag: "w" });
      await fs.rename(temporary, target);
      return {
        status: "available",
        path: target,
        artifact_name: `telegram-media-${process.env.GITHUB_RUN_ID || "local"}`,\n        artifact_run_id: process.env.GITHUB_RUN_ID || null,
        mime_type: format.mime_type,
        size: bytes.length,
        file_unique_id: selected.file_unique_id
      };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < MAX_ATTEMPTS) await wait(500 * (2 ** attempt));
    }
  }
  throw new Error(`Unable to retrieve Telegram image after ${MAX_ATTEMPTS} attempts: ${lastError?.message || "unknown error"}`);
}
