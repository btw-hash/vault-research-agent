---
emoji: 🦊
state: active
version: 2.1.0
---

# Fleet Dashboard

Internal ops dashboard the team uses to see the health of every deployed service at a
glance — a grid of status lamps (green/amber/red) per service, plus deploy history and
basic metrics (latency, error rate, uptime).

## Why it exists

Before Fleet Dashboard, checking "is everything up?" meant running `beacon status` in
a terminal or tailing five different log streams. The dashboard exists to make that a
5-second glance instead of a 5-minute check, especially useful for non-infra team
members who want to know if a demo is safe to run.

## Stack

- Next.js, server-sent events for live status updates
- Reads service health via the analytics MCP server (see [[Architecture Decisions]]
  ADR-3) rather than hitting each service's API directly — one integration point
  instead of N
- Status lamps use a debounced "confirmed down" state (2 consecutive failed probes)
  to avoid flapping on network blips, but the raw last-probe result is shown
  separately so the dashboard never looks "stale-green" right after an outage starts

## Fun detail

The favicon is based on the company mascot, a fox named Ember — the same fox shows up
as a loading spinner across all Nimbus Labs internal tools.

## Related

- [[Beacon CLI]] — CLI equivalent for infra engineers who prefer a terminal
- [[Architecture Decisions]] — ADR-3 (analytics MCP server design)
