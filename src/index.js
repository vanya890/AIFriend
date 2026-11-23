import { getUpdates, sendThreadReply } from "./telegram.js";
import { loadState, saveState, wasProcessed, markProcessed, addThreadMessage, buildMemoryContext } from "./memory.js";
import { generateReply } from "./agent.js";

const state = await loadState();
const updates = await getUpdates(state.offset);
let changed = false;

function channelKey(chatId, postId) {
  return `${chatId}:${postId}`;
}

function getText(message) {
  return message.text || message.caption || (message.photo ? "[photo]" : message.video ? "[video]" : message.document ? "[document]" : "[non-text message]");
}

async function answerInDiscussion({ chatId, rootMessageId, threadKey, event }) {
  const context = buildMemoryContext(state, threadKey);
  const reply = await generateReply({ event, context });
  if (reply === "SKIP") return null;
  const sent = await sendThreadReply(chatId, rootMessageId, reply);
  addThreadMessage(state, threadKey, {
    role: "assistant",
    text: reply,
    telegram_message_id: sent.message_id,
    created_at: new Date().toISOString()
  });
  return sent;
}

for (const update of updates) {
  if (wasProcessed(state, update.update_id)) continue;

  const post = update.channel_post || update.edited_channel_post;
  if (post) {
    const id = channelKey(post.chat.id, post.message_id);
    state.channels[post.chat.id] ||= {
      id: post.chat.id,
      title: post.chat.title || String(post.chat.id),
      username: post.chat.username || null,
      last_seen_at: new Date().toISOString()
    };
    state.channels[post.chat.id].last_seen_at = new Date().toISOString();
    state.threads[id] ||= { messages: [], updated_at: null, discussion_chat_id: null, root_message_id: null };
    addThreadMessage(state, id, {
      role: "channel_post",
      text: getText(post),
      channel_id: post.chat.id,
      channel_post_id: post.message_id,
      created_at: new Date(post.date * 1000).toISOString()
    });
  }

  const message = update.message;
  if (message?.is_automatic_forward && message.forward_origin?.type === "channel") {
    const origin = message.forward_origin;
    const threadKey = channelKey(origin.chat.id, origin.message_id);
    const thread = state.threads[threadKey] ||= { messages: [], updated_at: null, discussion_chat_id: null, root_message_id: null };
    thread.discussion_chat_id = message.chat.id;
    thread.root_message_id = message.message_id;
    if (!thread.initial_reply_sent) {
      const channel = state.channels[origin.chat.id] || { id: origin.chat.id, title: origin.chat.title || "Telegram channel" };
      const postText = thread.messages.find(item => item.role === "channel_post")?.text || getText(message);
      await answerInDiscussion({
        chatId: message.chat.id,
        rootMessageId: message.message_id,
        threadKey,
        event: { type: "new_channel_post", channel, post: postText, post_id: origin.message_id }
      });
      thread.initial_reply_sent = true;
    }
  } else if (message && !message.from?.is_bot && message.reply_to_message) {
    const repliedToBot = message.reply_to_message.from?.is_bot;
    if (repliedToBot) {
      const thread = Object.entries(state.threads).find(([, value]) =>
        value.discussion_chat_id === message.chat.id &&
        (value.root_message_id === message.reply_to_message.message_id ||
         value.messages.some(item => item.telegram_message_id === message.reply_to_message.message_id))
      );
      if (thread) {
        const [threadKey, data] = thread;
        addThreadMessage(state, threadKey, {
          role: "user",
          text: getText(message),
          user_id: message.from.id,
          username: message.from.username || null,
          telegram_message_id: message.message_id,
          created_at: new Date(message.date * 1000).toISOString()
        });
        await answerInDiscussion({
          chatId: message.chat.id,
          rootMessageId: data.root_message_id,
          threadKey,
          event: { type: "reply_to_agent", text: getText(message), username: message.from.username || null }
        });
      }
    }
  }

  markProcessed(state, update.update_id);
  state.offset = Math.max(state.offset, update.update_id + 1);
  changed = true;
}

if (changed) await saveState(state);
console.log(JSON.stringify({
  received_updates: updates.length,
  next_offset: state.offset,
  known_channels: Object.keys(state.channels).length,
  known_threads: Object.keys(state.threads).length
}));
