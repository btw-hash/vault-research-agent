---
emoji: 🌌
state: active
version: 0.4.2
audience: prosumer
---

# Aurora Notebook

Aurora Notebook is Nimbus Labs' flagship product: an AI-assisted note-taking app for
writers and researchers. It combines a local-first markdown editor with a semantic
search layer, so users can ask questions across their whole notebook instead of just
grepping filenames.

## Stack

- **Frontend:** TypeScript, Next.js 15, Tailwind, a custom CodeMirror-based editor
- **Backend:** Node.js API routes, Postgres with the `pgvector` extension for embeddings
- **Embeddings:** generated via the Anthropic API on note save, cached per-note hash
- **Sync:** delegated entirely to [[Constellation Sync]] — Aurora Notebook itself has no
  sync logic, it just calls the sync engine's client SDK

## Target audience

Prosumers: writers, PhD students, and consultants who keep a large personal knowledge
base and want retrieval that understands meaning, not just keywords. Not aimed at
enterprise teams — no multi-user permissions model exists yet.

## Status

Public beta since 2026-03. Current focus is reducing embedding cost (batching saves
instead of embedding on every keystroke) and improving semantic search recall on short
notes (<50 words), which currently underperform.

## Related

- [[Constellation Sync]] — sync engine
- [[Beacon CLI]] — different target audience (infra engineers, not writers), but shares
  the same auth/billing backend
