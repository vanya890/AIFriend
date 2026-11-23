# AIFriend

Telegram ↔ ChatGPT bridge. **No OpenAI API and no model runs inside GitHub Actions.**

## Architecture

1. GitHub Actions polls Telegram Bot API every five minutes.
2. Public channel posts and post history are stored in `data/state.json`. Private messages and linked discussion-group message bodies are stored only in the private runtime branch.
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

Private messages, linked discussion-group message bodies, sender metadata, file IDs, and bot replies are not written to the public `data/state.json` or public command Issues. The current public snapshot and legacy Issue #1 were redacted, but earlier Git commits may still contain previously committed test messages; editing the current snapshot does not rewrite public Git history.

## Images

- Images are downloaded into a temporary directory and uploaded as GitHub Actions artifacts named `telegram-media-<run_id>` with one-day retention.
- Supported images: Telegram photos and image documents in JPEG, PNG, GIF, or WebP, up to 8 MiB.
- The private context retains `file_id`, allowing an authorized workflow to call Telegram `getFile` again if the artifact expires. Never construct or expose the tokenized Telegram file URL.
- Do not claim an image was analyzed unless the actual image was loaded into the model's visual context.

## ChatGPT command bridge

The full Telegram command payload is stored privately in `AgentSharedMemory/temporary/aifriend/commands/<command_id>.json` on branch `aifriend-runtime`. The public Issue in this repository contains only a reference:

```json
{
  "action": "execute_private_command",
  "command_id": "tg-123456"
}
```

The Issue title starts with `[aifriend]` and must be created by `vanya890`. Never place chat IDs, message text, private context, or file IDs in the public Issue. After Telegram confirms delivery, the bridge records the assistant message in the private chat context, removes the queued command, and writes a private sent marker.
See [CHATGPT_TASK.md](CHATGPT_TASK.md) for the complete scheduled-task protocol.
