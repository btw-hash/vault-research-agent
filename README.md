# Vault Research Agent

A CLI multi-agent orchestrator that answers questions by researching an Obsidian
vault through [MCP](https://modelcontextprotocol.io/). You ask a question; a planner
breaks it into subquestions, parallel workers search the vault, a synthesizer produces
a structured, cited answer, and a judge scores it — re-synthesizing once if the score
is too low.

Ships with a bundled fictional demo vault (`demo-vault/`, a fictional company "Nimbus
Labs") and a mock LLM client, so it runs **zero-config from a clean clone** — no API
key required.

## Pipeline

```
                                   ┌──────────┐
   question ─────────────────────▶│ Planner  │  (Haiku, forced tool use)
                                   └────┬─────┘
                                        │ 2-5 subquestions
                                        ▼
                              ┌───────────────────┐
                              │  Router (per sub)  │  (Haiku, forced tool use)
                              └─────────┬──────────┘
                                        │ track: quick | deep | impossible
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
               ┌───────────┐      ┌───────────┐      ┌────────────┐
               │  Worker   │      │  Worker   │  ...  │  Worker    │  (parallel,
               │  (quick)  │      │  (deep)   │       │(impossible)│   MCP tool use)
               └─────┬─────┘      └─────┬─────┘      └─────┬──────┘
                     │                  │                  │
                     └──────────────────┼──────────────────┘
                                        ▼
                                ┌───────────────┐
                                │  Synthesizer   │  (Sonnet, forced tool use,
                                └───────┬────────┘   extended thinking on deep Qs)
                                        │ structured Answer {answer, sources[], confidence}
                                        ▼
                                   ┌─────────┐
                                   │  Judge  │  (Sonnet, forced tool use)
                                   └────┬────┘
                     overall < threshold?  │  yes → re-synthesize with feedback
                                    no │   (evaluator-optimizer loop, max N revisions)
                                        ▼
                                ┌───────────────┐
                                │   Narrator     │  (Haiku, streamed)
                                └───────┬────────┘
                                        ▼
                               prose answer + sources
                               printed live in the CLI
```

Workers talk to the vault through the **vendored MCP server**
(`vendor/mcp-obsidian/`) over stdio — `read_note`, `search_notes`,
`append_to_daily`, `list_projects`.

## Quickstart

### Mock mode (zero-config)

```bash
npm install
npm run build      # builds the vendored MCP server, then the CLI
npm start -- "What's the tech stack for Aurora Notebook?"
```

No `ANTHROPIC_API_KEY` needed — the mock LLM client (`src/llm/anthropic-mock.ts`)
simulates realistic responses per agent role (including prompt-cache hits and
extended-thinking blocks), so you can see the full pipeline, streaming, and cost
telemetry without spending anything.

### Real mode

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run build
npm start -- "How is the Constellation Sync architecture designed?"
```

Useful env vars:

| Var                | Effect                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `LLM_MODE=mock`      | force mock mode even if `ANTHROPIC_API_KEY` is set                   |
| `VERBOSE=1`          | print orchestrator progress logs (planning/routing/worker steps)     |
| `JUDGE_THRESHOLD=0.8`| overall score below which a revision is triggered (default `0.7`)    |
| `MAX_REVISIONS=2`    | cap on evaluator-optimizer revision passes (default `1`)             |
| `NO_STREAM=1`        | disable narrator streaming, print the final answer at once           |
| `VAULT_ROOT=<path>`  | point the vendored MCP server at a different vault (default: `demo-vault/`) |
| `MCP_SERVER_PATH=<path>` | run a different MCP server binary instead of the vendored one    |

### Eval harness

```bash
npm run build
LLM_MODE=mock npm run eval          # or ANTHROPIC_API_KEY=... npm run eval for real mode
```

Runs the full orchestrator over `evals/testset.json` (15 questions against
`demo-vault/`), scores each answer with the LLM-as-judge (groundedness, relevance,
completeness), checks whether expected source files showed up, and prints an
aggregate report:

```
avg overall score:     0.78
  groundedness:        0.80
  relevance:            0.85
  completeness:        0.70
expected source rate:  86.7%
total cost:            $0.0197
```

A detailed per-case JSON report is saved to `evals/report-<timestamp>.json`
(gitignored). The runner exits non-zero if the average overall score drops below a
regression threshold (`0.65`), so it can gate CI.

## Architecture patterns

- **Orchestrator-workers** — the planner dynamically fans out into N subquestions;
  workers run in parallel and their findings fan back in to a single synthesizer.
- **Routing** — a lightweight classifier (`quick` / `deep` / `impossible`) picks the
  model, tool access, and step budget per subquestion, so trivial lookups don't pay
  for a 5-step Sonnet agent loop.
- **Forced tool use** — every agent (planner, router, synthesizer, judge) is required
  to call a specific tool (`tool_choice: { type: 'tool', name: '...' }`), so output is
  always structured JSON, never free text to parse.
- **Prompt caching** — system prompts and tool definitions carry
  `cache_control: { type: 'ephemeral' }`. The mock client simulates cache
  creation/read tokens too, so the cost telemetry (see below) is meaningful even
  without a real API key.
- **Model routing** — Haiku for planning, routing, narration, and quick workers;
  Sonnet for deep workers, synthesis, and judging.
- **Evaluator-optimizer loop** — if the judge's overall score is below
  `JUDGE_THRESHOLD`, the orchestrator re-synthesizes once (up to `MAX_REVISIONS`
  times) with the previous answer and judge feedback appended, and turns on extended
  thinking for the retry.
- **Cost telemetry** — every agent call reports input/output/cache tokens; the
  orchestrator sums them and estimates cost against a blended Haiku/Sonnet rate,
  printed at the end of every CLI run and in the eval aggregate report.

## Project layout

```
src/
  cli.ts                 CLI entrypoint, streams the answer
  orchestrator.ts         fan-out/fan-in coordination + evaluator-optimizer loop
  agents/
    planner.ts             question → subquestions
    router.ts               subquestion → quick | deep | impossible
    worker.ts                per-subquestion research loop (MCP tool use)
    synthesizer.ts          findings → structured Answer
    narrator.ts              structured Answer → streamed prose
  evals/
    judge.ts                LLM-as-judge scoring
    run.ts                   eval harness runner
  llm/
    client.ts                real/mock client selection
    anthropic-real.ts        thin Anthropic SDK wrapper
    anthropic-mock.ts       zero-config mock client
    types.ts                  shared request/response types
  mcp/
    vault-client.ts         stdio MCP client to the vendored server
vendor/
  mcp-obsidian/             vendored stdio MCP server exposing a vault as tools
demo-vault/                 bundled fictional demo vault (default VAULT_ROOT)
evals/
  testset.json              15 test questions against demo-vault
specs/
  vault-research-agent.md  requirements/tasks/services/patterns
```

## License

MIT, see [LICENSE](./LICENSE).
