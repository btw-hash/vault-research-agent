# Team Bots

Chat bots the team runs day to day.

## Waypoint Bot

Telegram bot for personal reminders and end-of-session logging. Appends session
summaries to the day's note in `daily/` and sends a morning recap of open items. See
[[Waypoint Bot]] for the full project note.

## Signal Relay

A second, smaller Telegram bot used only for deploy notifications from Beacon CLI —
posts a message to the team channel whenever `beacon rollback` or a production deploy
runs. Kept separate from Waypoint Bot so personal reminders and deploy noise don't mix
in the same chat.

## Related

- [[Style Guide]] — how bot-logged sessions fit into the broader logging workflow
