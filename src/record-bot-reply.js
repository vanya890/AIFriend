import { recordBotReply } from "./context.js";

const required = ["AIFRIEND_CONTEXT_DIR", "AIFRIEND_CHAT_ID", "AIFRIEND_MESSAGE_ID", "AIFRIEND_TEXT"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const message = {
  message_id: Number(process.env.AIFRIEND_MESSAGE_ID),
  text: process.env.AIFRIEND_TEXT,
  date: Number(process.env.AIFRIEND_DATE || Math.floor(Date.now() / 1000)),
  reply_to_message: process.env.AIFRIEND_REPLY_TO_MESSAGE_ID
    ? { message_id: Number(process.env.AIFRIEND_REPLY_TO_MESSAGE_ID) }
    : null
};

await recordBotReply(Number(process.env.AIFRIEND_CHAT_ID), message);
console.log(JSON.stringify({
  chat_id: Number(process.env.AIFRIEND_CHAT_ID),
  message_id: message.message_id,
  role: "assistant",
  recorded: true
}));
