---
emoji: 🛰️
state: active
version: 1.2.0
audience: infra engineers
---

# Beacon CLI

A command-line tool for inspecting and managing cloud deployments across the services
Nimbus Labs runs (Fleet Dashboard's backend, Aurora Notebook's API, Constellation
Sync's workers). Built for the team's own infra engineers, not sold externally.

## Stack

- **Language:** Go, `cobra` for the command tree
- **Transport:** gRPC to a small control-plane service that wraps the cloud provider API
- **Auth:** shares the same OAuth backend as Aurora Notebook and Fleet Dashboard

## What it does

- `beacon status` — health check across all deployed services
- `beacon logs <service>` — tail logs without opening the cloud console
- `beacon rollback <service> <version>` — one-command rollback

## Status

Stable, used daily by the infra track. Last major change: replaced polling with a
gRPC streaming subscription for `beacon logs`, cutting log-tail latency from ~2s to
under 200ms.

## Related

- [[Fleet Dashboard]] — the GUI equivalent of `beacon status`
- [[Aurora Notebook]] — different audience, same auth backend
