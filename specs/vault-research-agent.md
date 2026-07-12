# Vault Research Agent — Spec

## Goal

A CLI tool: a text question in → an answer with citations from an Obsidian vault out.
Built as a credibility/portfolio piece demonstrating a multi-agent orchestrator with
MCP tool use, forced tool use, prompt caching, model routing, and an LLM-as-judge eval
harness. Ships with a bundled fictional demo vault so it runs zero-config from a clean
clone in mock mode.

## Requirements

- **REQ-1** Accept a text question, return JSON `{answer, sources[], confidence}`
- **REQ-2** Planner decomposes the question into 2-5 independent subquestions
- **REQ-3** Workers run in parallel, each makes up to 5 vault MCP calls
- **REQ-4** Synthesizer emits the final JSON via forced tool use
- **REQ-5** Eval suite: 15 questions with expected source files, LLM-as-judge scoring
- **REQ-6** Mock-mode support (no Anthropic API key needed) for zero-config demos
- **REQ-7** The MCP vault server is vendored into the repo and builds via `npm run build`
- **REQ-8** Default vault root is the bundled `demo-vault/`, overridable via `VAULT_ROOT`

## Tasks

- **TASK-1** Scaffold + Anthropic client wrapper (real/mock switch) + MCP client
- **TASK-2** Planner agent (Haiku) — decompose question
- **TASK-3** Worker agent (Haiku + vault tools) — per-subquestion research
- **TASK-4** Synthesizer agent (Sonnet + forced JSON tool)
- **TASK-5** Orchestrator — fan-out/fan-in with max_iterations
- **TASK-6** Prompt caching for system + tools definitions
- **TASK-7** Evals: test set + runner + LLM-as-judge rubric
- **TASK-8** CLI entrypoint + README
- **TASK-9** Vendor the MCP server (`vendor/mcp-obsidian/`) + bundled `demo-vault/`

## Services (modules)

- **SVC-1** `src/llm/client.ts`, `anthropic-real.ts`, `anthropic-mock.ts` — real/mock Anthropic wrapper
- **SVC-2** `src/mcp/vault-client.ts` — stdio client to the vendored obsidian-vault-mcp server
- **SVC-3** `src/agents/planner.ts`, `router.ts`, `worker.ts`, `synthesizer.ts`, `narrator.ts`
- **SVC-4** `src/orchestrator.ts` — coordination
- **SVC-5** `src/cli.ts` — entrypoint
- **SVC-6** `src/evals/run.ts` + `evals/judge.ts` + `evals/testset.json` — eval harness
- **SVC-7** `vendor/mcp-obsidian/` — vendored stdio MCP server, default `VAULT_ROOT` points at `demo-vault/`

## Patterns used

- **Orchestrator-workers** — dynamic fan-out based on planner output, with a router that
  picks a track (quick/deep/impossible) per subquestion
- **Forced tool use** — every agent (planner, router, synthesizer, judge) emits
  structured output via a required tool call, never free text
- **Prompt caching** — `cache_control: { type: 'ephemeral' }` on system prompts and tool
  definitions; the mock client simulates cache hits/misses so the cost telemetry is
  meaningful even offline
- **Model routing** — Haiku for planning/routing/quick workers, Sonnet for deep workers,
  synthesis, and judging
- **Evaluator-optimizer loop** — if the judge's overall score is below threshold, the
  orchestrator re-synthesizes once with the judge's feedback (extended thinking enabled)
- **LLM-as-judge** — a separate evaluator scores groundedness/relevance/completeness
  against a per-case rubric
- **MCP client** — stdio connection, tool discovery, call delegation, with a vault_*
  prefix to disambiguate tool names
- **Streaming narration** — the synthesizer's structured JSON is turned into
  human-readable prose by a narrator agent, streamed token-by-token to the CLI
