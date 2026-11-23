import { getUpdates } from "./telegram.js";
import { loadState, saveState, wasProcessed, markProcessed, rememberMessage, createPrivateMessageEntry } from "./memory.js";

const state = await loadState();
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
    rememberMessage(state, key, {
      type: update.edited_channel_post ? "edited_channel_post" : "channel_post",
      text: messageText(channelPost),
      message_id: channelPost.message_id,
      date: channelPost.date,
      from: chat.title || chat.username || String(chat.id)
    });
    appendInbox({
      update_id: update.update_id,
      type: update.edited_channel_post ? "edited_channel_post" : "channel_post",
      channel_id: chat.id,
      channel_title: chat.title || null,
      channel_username: chat.username || null,
      post_id: channelPost.message_id,
      text: messageText(channelPost),
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
      appendInbox({
        update_id: update.update_id,
        type: "discussion_post_link",
        channel_id: origin.chat.id,
        post_id: origin.message_id,
        discussion_chat_id: message.chat.id,
        discussion_root_id: message.message_id,
        text: messageText(message),
        date: message.date,
        received_at: new Date().toISOString(),
        status: "pending"
      });
    } else if (message.chat.type === "private") {
      const chatId = String(message.chat.id);
      state.private_chats ||= {};
      state.private_chats[chatId] = {
        chat_id: message.chat.id,
        user_id: message.from.id,
        username: message.from.username || null,
        display_name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
        last_seen_at: new Date().toISOString()
      };
      appendInbox(createPrivateMessageEntry(message, update.update_id));
    } else if (message.chat.type === "group" || message.chat.type === "supergroup") {
      const replyId = message.reply_to_message?.message_id || null;
      const entry = {
        update_id: update.update_id,
        type: "discussion_message",
        discussion_chat_id: message.chat.id,
        message_id: message.message_id,
        reply_to_message_id: replyId,
        user_id: message.from.id,
        username: message.from.username || null,
        display_name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
        text: messageText(message),
        date: message.date,
        received_at: new Date().toISOString(),
        status: "pending"
      };
      appendInbox(entry);
      state.discussions[message.chat.id] ||= { title: message.chat.title || null };
      state.discussions[message.chat.id].last_seen_at = new Date().toISOString();
    }
  }

  markProcessed(state, update.update_id);
  state.offset = Math.max(state.offset, update.update_id + 1);
  changed = true;
}

if (changed) {
  await saveState(state);
}
console.log(JSON.stringify({
  received_updates: updates.length,
  next_offset: state.offset,
  known_channels: Object.keys(state.channels).length,
  queued_events: (state.inbox || []).filter(item => item.status === "pending").length
}));
