---
emoji: 🔭
state: active
version: 0.9.1
---

# Constellation Sync

The sync engine that keeps a user's local Aurora Notebook vault in sync with the
hosted Constellation backend, and (optionally) mirrors selected notes out to a
connected CRM for teams that use Aurora Notebook as a shared knowledge base.

## Architecture

Local-first: Aurora Notebook writes to disk immediately, then Constellation Sync
diffs the changed blocks and pushes them as small idempotent patches — never a full
file overwrite, to avoid clobbering concurrent edits from another device. The design
mirrors block-level diffing rather than whole-document diffing, because notes are
edited far more often than they're restructured.

Key properties:

- **Idempotent writes.** Every patch carries a content hash; replaying the same patch
  twice is a no-op.
- **Conflict resolution.** Last-write-wins per block, not per file — two devices can
  edit different sections of the same note without conflict.
- **CRM mirror.** Optional, opt-in per note via a `#shared` tag. Mirrored notes get a
  webhook push whenever they change.

See [[Session History]] (analytics MCP integration entry) and [[Weekly Log]] for the
timeline of when the current diffing approach replaced the original full-file sync
(which caused the multi-device clobbering bug reported in early beta).

## Related

- [[Aurora Notebook]] — the app this engine syncs
- [[Architecture Decisions]] ADR-2 — why stdio MCP was chosen for internal tool wiring
