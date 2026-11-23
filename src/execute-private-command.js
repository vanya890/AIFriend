import fs from "node:fs/promises";
import path from "node:path";
import { sendMessage } from "./telegram.js";
import { recordBotReply } from "./context.js";

const commandId = process.env.AIFRIEND_COMMAND_ID || "";
const commandDirectory = process.env.AIFRIEND_COMMAND_DIR;
const contextDirectory = process.env.AIFRIEND_CONTEXT_DIR;

if (!/^[A-Za-z0-9_-]{1,100}$/.test(commandId)) {
  throw new Error("Invalid AIFRIEND_COMMAND_ID");
}
if (!commandDirectory || !contextDirectory) {
  throw new Error("Missing private command/context directory");
}

const commandPath = path.join(commandDirectory, `${commandId}.json`);
const sentDirectory = path.join(commandDirectory, "sent");
const sentPath = path.join(sentDirectory, `${commandId}.json`);

try {
  const previous = JSON.parse(await fs.readFile(sentPath, "utf8"));
  console.log(JSON.stringify({ status: "already_sent", command_id: commandId, message_id: previous.message_id }));
  process.exit(0);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const command = JSON.parse(await fs.readFile(commandPath, "utf8"));
if (!command || typeof command !== "object" || Array.isArray(command) || command.action !== "send_message") {
  throw new Error("Private command must be a send_message object");
}
const chatId = Number(command.chat_id);
if (!Number.isSafeInteger(chatId)) throw new Error("chat_id must be a numeric Telegram chat ID");
if (typeof command.text !== "string" || !command.text.trim() || command.text.length > 4096) {
  throw new Error("text must contain 1..4096 characters");
}
const replyTo = command.reply_to_message_id == null ? null : Number(command.reply_to_message_id);
if (replyTo !== null && !Number.isSafeInteger(replyTo)) {
  throw new Error("reply_to_message_id must be numeric");
}

const sent = await sendMessage(chatId, command.text, replyTo);
await recordBotReply(chatId, {
  message_id: sent.message_id,
  text: sent.text || command.text,
  date: sent.date,
  reply_to_message: replyTo === null ? null : { message_id: replyTo }
}, { directory: contextDirectory });

await fs.mkdir(sentDirectory, { recursive: true });
const marker = {
  command_id: commandId,
  chat_id: chatId,
  message_id: sent.message_id,
  sent_at: new Date().toISOString()
};
const temporary = sentPath + ".tmp";
await fs.writeFile(temporary, JSON.stringify(marker, null, 2) + "\n", "utf8");
await fs.rename(temporary, sentPath);
await fs.unlink(commandPath);

console.log(JSON.stringify({ status: "sent", command_id: commandId, message_id: sent.message_id }));
