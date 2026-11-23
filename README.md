# AIFriend

Telegram ↔ ChatGPT bridge. **No OpenAI API and no model runs inside GitHub Actions.**

## Architecture

1. GitHub Actions polls Telegram Bot API every five minutes and stores incoming channel posts and discussion messages in `data/state.json`.
2. ChatGPT scheduled tasks read the inbox and shared memory from this repository, reason over the messages using the ChatGPT model available in the conversation, and prepare replies.
3. ChatGPT sends replies through a narrowly scoped GitHub Actions command bridge (to be enabled in the next implementation step). The bridge calls Telegram Bot API only; it never generates text.

## Required Telegram setup

- Create a bot with @BotFather and store its token as Actions secret `TELEGRAM_BOT_TOKEN`.
- Add the bot to each target channel as an administrator with permission to post messages.
- Link a discussion group to each channel and add the bot there as an administrator.
- Disable bot privacy mode in @BotFather if the bot must receive ordinary group messages, not only commands and replies.

## Required GitHub settings

- Enable Actions.
- Allow GitHub Actions to create and push commits: Settings → Actions → General → Workflow permissions → Read and write permissions.
- Add repository secret `TELEGRAM_BOT_TOKEN`.

## Important limitations

- Telegram channel comments live in the linked discussion group, not directly in the channel post.
- Scheduled GitHub Actions are best-effort and can be delayed. They are not a real-time event stream.
- The collector stores incoming events; it does not autonomously generate or send AI replies.
- Do not put bot tokens or other credentials in repository files or Issues.

## Data

- `data/state.json`: collector-owned Telegram offset, channels, post histories, and append-only inbox (last 10,000 events).
- `data/processed.json`: ChatGPT-owned ledger of processed Telegram update IDs.
- `data/memory.json`: ChatGPT-owned shared long-term memory.

## ChatGPT command bridge

ChatGPT can send a reply by creating an Issue with:
- title beginning with `[aifriend]`;
- author `vanya890`;
- body containing one JSON object, for example:

```json
{
  "action": "send_message",
  "chat_id": -1001234567890,
  "text": "Текст комментария",
  "reply_to_message_id": 123
}
```

The `reply_to_message_id` field is optional. Use the message ID of the automatic channel forward in the linked discussion group to create a top-level comment, or the user's message ID to reply to that user. The `chat_id` must be the linked discussion group's numeric ID.

The workflow `.github/workflows/chatgpt-command.yml` validates the command and sends it through Telegram Bot API. It does not call an LLM. ChatGPT itself reads `data/state.json`, interprets pending inbox entries, and decides what to write.

## ChatGPT scheduled-task loop

For each scheduled run, the ChatGPT task should:
1. Read `data/state.json` from the repository.
2. Process pending `inbox` events in chronological order, using the full matching post/thread history and shared `memory`.
3. Avoid replying to the bot's own messages, duplicates, spam, and messages that do not merit a response.
4. For each reply, create an Issue using the command format above.
5. Record processed update IDs in `data/processed.json` and maintain concise shared memory in `data/memory.json`.
6. Do not modify `data/state.json`: it is collector-owned and can be updated concurrently. Never overwrite collector state or its Telegram offset.

The scheduled task is the reasoning layer. GitHub Actions only collects Telegram updates and delivers ChatGPT-authored messages.
