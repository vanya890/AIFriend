# AIFriend

Telegram ↔ ChatGPT bridge. **No OpenAI API and no model runs inside GitHub Actions.**

## Architecture

1. GitHub Actions polls Telegram Bot API every five minutes.
2. Public channel/group inbox metadata is stored in `data/state.json`.
3. All Telegram chats also get a private rolling context window in `vanya890/AgentSharedMemory`, branch `aifriend-runtime`, under `temporary/aifriend/chats/<chat_id>.json`.
4. Each chat window retains the latest 50 messages, including incoming user/channel messages and confirmed bot replies. A separate bounded `pending` queue prevents unprocessed private messages from being evicted by the rolling window.
5. ChatGPT scheduled tasks read the inbox and private context, reason using the ChatGPT model available in the conversation, and prepare replies.
6. ChatGPT sends replies through a narrowly scoped GitHub Actions command bridge. The bridge calls Telegram Bot API and records the confirmed bot reply in the private context. It never generates text.

## Required Telegram setup

- Create a bot with @BotFather and store its token as Actions secret `TELEGRAM_BOT_TOKEN`.
- Add the bot to each target channel as an administrator with permission to post messages.
- Link a discussion group to each channel and add the bot there as an administrator.
- Disable bot privacy mode in @BotFather if the bot must receive ordinary group messages, not only commands and replies.
- A user must open the bot and send `/start` before the bot can send them private replies.

## Required GitHub settings

- Enable Actions.
- Allow GitHub Actions to create and push commits in AIFriend.
- Create a fine-grained personal access token for `vanya890/AgentSharedMemory` only, with **Contents: Read and write** permission.
- Add that token to AIFriend repository secrets as `AGENT_SHARED_MEMORY_TOKEN`.
- Add `TELEGRAM_BOT_TOKEN` as an Actions secret.

The shared-memory token is used only by checkout/push operations against the private runtime branch. Never place it in source files, Issues, workflow inputs, or logs.

## Context storage

- Private runtime repository: `vanya890/AgentSharedMemory`.
- Runtime branch: `aifriend-runtime`.
- Directory: `temporary/aifriend/chats/`.
- One JSON file per Telegram chat ID.
- `messages`: last 50 distinct Telegram messages/revisions.
- `pending`: bounded queue of incoming events awaiting ChatGPT processing.
- Entries include sender/role, message IDs, timestamps, text/caption, reply references, media metadata, and Telegram `file_id` / `file_unique_id` when an image is present.
- Bot replies are added only after Telegram confirms `sendMessage`.
- Telegram download URLs are never stored because they contain the bot token.
- The private runtime branch is operational state and must not be merged into `main`.

Private message bodies and sender metadata are no longer written to the public `data/state.json`. The current public snapshot was cleaned, but earlier Git commits may still contain previously committed test messages; deleting the current file does not rewrite public Git history.

## Images

- Images are downloaded into a temporary directory and uploaded as GitHub Actions artifacts named `telegram-media-<run_id>` with one-day retention.
- Supported images: Telegram photos and image documents in JPEG, PNG, GIF, or WebP, up to 8 MiB.
- The private context retains `file_id`, allowing an authorized workflow to call Telegram `getFile` again if the artifact expires. Never construct or expose the tokenized Telegram file URL.
- Do not claim an image was analyzed unless the actual image was loaded into the model's visual context.

## ChatGPT command bridge

ChatGPT sends a reply by creating an Issue in this repository:
- title beginning with `[aifriend]`;
- author `vanya890`;
- body containing one JSON object:

```json
{
  "action": "send_message",
  "chat_id": 123456789,
  "text": "Текст ответа",
  "reply_to_message_id": 123
}
```

The `reply_to_message_id` field is optional. For a private reply, use the numeric `chat_id` from the private context event and omit `reply_to_message_id` unless replying to a specific message. The bridge appends the assistant message to the private context only after Telegram confirms delivery.

See [CHATGPT_TASK.md](CHATGPT_TASK.md) for the complete scheduled-task protocol.
