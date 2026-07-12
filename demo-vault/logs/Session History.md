# Session History

Chronological log of integration and infra work across Nimbus Labs projects.

## 2026-06-02 — Analytics MCP integration for Fleet Dashboard

Connected a read-only analytics MCP server to Fleet Dashboard so the dashboard reads
service health (latency, error rate, uptime) through one tool-call interface instead
of hitting five different service APIs directly. Added a 30s in-memory cache layer in
front of the MCP calls to keep the dashboard's server-sent-events loop cheap. See
[[Architecture Decisions]] ADR-3 for the reasoning.

## 2026-05-18 — Constellation Sync: block-level diffing replaces full-file sync

Replaced Constellation Sync's original full-file-overwrite sync with block-level
diffing and idempotent patches. This fixed the multi-device clobbering bug reported by
early beta users (editing the same note on phone and laptop at once silently dropped
one device's changes). Full writeup in [[Constellation Sync]].

## 2026-04-30 — Beacon CLI: gRPC streaming for log tail

`beacon logs` used to poll the control-plane service every 2 seconds. Switched to a
gRPC streaming subscription, cutting tail latency to under 200ms. No user-facing CLI
flag changes.

## 2026-03-01 — Aurora Notebook public beta launch

Opened public beta signups. Embedding generation was initially synchronous on every
keystroke, which was too slow and expensive — moved to on-save batching within the
first week of launch feedback.
