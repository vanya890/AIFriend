import fs from "node:fs/promises";
import { getUpdates } from "./telegram.js";
import { loadState, saveState, wasProcessed, markProcessed, rememberMessage } from "./memory.js";
import { saveTelegramImage } from "./media.js";
import { appendChatContext, getImageReference, pruneProcessedPending } from "./context.js";

const state = await loadState();
let processedUpdateIds = [];
try {
  const ledger = JSON.parse(await fs.readFile("data/processed.json", "utf8"));
  processedUpdateIds = Array.isArray(ledger.update_ids) ? ledger.update_ids : [];
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const prunedPending = await pruneProcessedPending(process.env.AIFRIEND_CONTEXT_DIR, processedUpdateIds);
const updates = await getUpdates(state.offset);
let changed = false;

function postKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}
function messageText(message) {
  return message.text || message.caption || (
    message.photo ? "[photo]" :
    message.video ? "[video]" :
    message.document ? "[document]" :
    "[non-text message]"
  );
}
function appendInbox(entry) {
  state.inbox ||= [];
  state.inbox.push(entry);
  if (state.inbox.length > 10000) state.inbox.splice(0, state.inbox.length - 10000);
}
async function recordIncoming(message, updateId, role, type, options = {}) {
  const mediaReference = getImageReference(message);
  const media = mediaReference ? await saveTelegramImage(message, message.chat) : null;
  await appendChatContext(message.chat.id, {
    role,
    source: "telegram",
    type,
    update_id: updateId,
    message_id: message.message_id,
    chat_type: message.chat.type,
    reply_to_message_id: message.reply_to_message?.message_id || null,
    ...(message.is_automatic_forward && message.forward_origin?.type === "channel" ? {
      forward_origin: {
        channel_id: message.forward_origin.chat.id,
        channel_message_id: message.forward_origin.message_id,
        discussion_root_id: message.message_id
      }
    } : {}),
    sender: {
      user_id: message.from?.id || null,
      username: message.from?.username || null,
      display_name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.chat.title || null
    },
    text: messageText(message),
    date: message.date,
    status: options.pending ? "pending" : "received",
    ...(mediaReference ? { media_reference: mediaReference } : {}),
    ...(media ? { media } : {})
  }, { pending: Boolean(options.pending) });
  return media;
}

for (const update of updates) {
  if (wasProcessed(state, update.update_id)) continue;

  const channelPost = update.channel_post || update.edited_channel_post;
  if (channelPost) {
    const chat = channelPost.chat;
    state.channels[chat.id] = {
      id: chat.id,
      title: chat.title || String(chat.id),
      username: chat.username || null,
      last_seen_at: new Date().toISOString()
    };
    const key = postKey(chat.id, channelPost.message_id);
    const media = await recordIncoming(
      channelPost,
      update.update_id,
      "channel",
      update.edited_channel_post ? "edited_channel_post" : "channel_post"
    );
    rememberMessage(state, key, {
      type: update.edited_channel_post ? "edited_channel_post" : "channel_post",
      text: messageText(channelPost),
      message_id: channelPost.message_id,
      date: channelPost.date,
      from: chat.title || chat.username || String(chat.id),
      ...(media ? { media } : {})
    });
    appendInbox({
      update_id: update.update_id,
      type: update.edited_channel_post ? "edited_channel_post" : "channel_post",
      channel_id: chat.id,
      channel_title: chat.title || null,
      channel_username: chat.username || null,
      post_id: channelPost.message_id,
      text: messageText(channelPost),
      ...(media ? { media } : {}),
      date: channelPost.date,
      received_at: new Date().toISOString(),
      status: "pending"
    });
  }

  const message = update.message;
  if (message && !message.from?.is_bot) {
    if (message.is_automatic_forward && message.forward_origin?.type === "channel") {
      const origin = message.forward_origin;
      const key = postKey(origin.chat.id, origin.message_id);
      const post = state.posts[key] ||= { messages: [] };
      post.discussion_chat_id = message.chat.id;
      post.discussion_root_id = message.message_id;
      post.discussion_title = message.chat.title || null;
      await recordIncoming(message, update.update_id, "channel", "discussion_post_link", { pending: true });
    } else if (message.chat.type === "private") {
      // Private message bodies and sender metadata must never be committed to
      // the public AIFriend repository. The private branch is the source of truth.
      await recordIncoming(message, update.update_id, "user", "private_message", { pending: true });
      state.private_chats = {};
      state.inbox = (state.inbox || []).filter(item => !["private_message", "discussion_message", "discussion_post_link"].includes(item.type));
    } else if (message.chat.type === "group" || message.chat.type === "supergroup") {
      await recordIncoming(message, update.update_id, "user", "discussion_message", { pending: true });
      state.discussions[message.chat.id] ||= { title: message.chat.title || null };
      state.discussions[message.chat.id].last_seen_at = new Date().toISOString();
    }
  }

  markProcessed(state, update.update_id);
  state.offset = Math.max(state.offset, update.update_id + 1);
  changed = true;
}

if (changed) {
  // Also purge legacy private data from the current public snapshot.
  state.private_chats = {};
  state.inbox = (state.inbox || []).filter(item => !["private_message", "discussion_message", "discussion_post_link"].includes(item.type));
  await saveState(state);
}
console.log(JSON.stringify({
  received_updates: updates.length,
  pruned_pending: prunedPending,
  next_offset: state.offset,
  known_channels: Object.keys(state.channels).length,
  queued_events: (state.inbox || []).filter(item => item.status === "pending").length
}));
