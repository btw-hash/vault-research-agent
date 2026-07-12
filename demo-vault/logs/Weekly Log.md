# Weekly Log

Weekly summaries per project. See `daily/` for day-by-day detail.

## Week of 2026-06-08

- [[Fleet Dashboard]]: tuned the status-lamp debounce window after a false "down" alert
  during a brief network blip; raw last-probe state is now shown separately from the
  confirmed-alert state so the UI never looks stale.
- [[Waypoint Bot]]: started batching same-minute reminder pushes after users reported
  the notification tray was collapsing back-to-back nudges into one.
- [[Aurora Notebook]]: investigating semantic search recall on short notes (<50 words).

## Week of 2026-06-01

- Connected the analytics MCP server to [[Fleet Dashboard]] (see [[Session History]]
  for the full entry). This is the first internal MCP integration outside of the
  agent-tooling repos.
- [[Beacon CLI]]: no changes this week, stable.
- [[Nimbus Agents Kit (OSS)]]: drafted the eval-runner scaffold, still unreleased.

## Week of 2026-05-18

- [[Constellation Sync]]: shipped block-level diffing, closing the multi-device
  clobbering bug. Monitoring for regressions before removing the old full-file sync
  path entirely.
