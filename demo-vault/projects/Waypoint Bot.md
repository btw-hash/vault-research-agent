---
emoji: 📡
state: active
version: 0.6.0
---

# Waypoint Bot

A Telegram bot the team uses for personal reminders and end-of-session logging. When
someone finishes a work block, they message Waypoint Bot with a short summary; the bot
appends it to that day's note in `daily/` and pings the person again the next morning
with an open-items recap.

## Why it exists

Session notes only help if they actually get written. Waypoint Bot lowers the friction
to near zero: no need to open the vault, just send a Telegram message. It's the
"loud channel" for personal nudges — see [[Style Guide]] for how it fits into the
team's end-of-session workflow.

## Status

Stable and used daily. One open item: reminder pushes are occasionally deduplicated by
the notification tray when sent back-to-back without a unique tag, so a fix batches
same-minute reminders into a single message instead of sending them individually.

## Related

- [[Team Bots]] — full list of chat bots and what each is for
- [[Style Guide]] — the logging workflow this bot supports
