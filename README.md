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

- `data/state.json`: shared state, channels, posts, inbox, and long-term memory.
