# Vault Research Agent — Spec

## Цель
CLI-инструмент: вопрос на входе → ответ с цитатами из Obsidian vault на выходе.
Используется как референс для Claude Certified Architect Foundations.

## Requirements

- **REQ-1** Принять текстовый вопрос, вернуть JSON `{answer, sources[], confidence}`
- **REQ-2** Planner раскладывает вопрос на 2-5 независимых подвопросов
- **REQ-3** Workers параллельно, каждый делает до 5 вызовов vault MCP
- **REQ-4** Synthesizer выдаёт финальный JSON через forced tool use
- **REQ-5** Eval-suite: 15 вопросов с эталонными source-файлами, LLM-as-judge
- **REQ-6** Поддержка mock-режима (без Anthropic API key) для обучения

## Tasks

- **TASK-1** Scaffold + Anthropic client wrapper (real/mock switch) + MCP client
- **TASK-2** Planner agent (Haiku) — decompose question
- **TASK-3** Worker agent (Haiku + vault tools) — per-subquestion research
- **TASK-4** Synthesizer agent (Sonnet + forced JSON tool)
- **TASK-5** Orchestrator — fan-out/fan-in with max_iterations
- **TASK-6** Prompt caching for system + tools definitions
- **TASK-7** Evals: test set + runner + LLM-as-judge rubric
- **TASK-8** CLI entrypoint + README

## Services (modules)

- **SVC-1** `src/llm/anthropic-client.ts` — real/mock Anthropic wrapper
- **SVC-2** `src/mcp/vault-client.ts` — stdio client to obsidian-vault-mcp
- **SVC-3** `src/agents/planner.ts`, `worker.ts`, `synthesizer.ts`
- **SVC-4** `src/orchestrator.ts` — coordination
- **SVC-5** `src/cli.ts` — entrypoint
- **SVC-6** `src/evals/run.ts` + `evals/testset.json` — eval harness

## Patterns used (exam-relevant)

- **Orchestrator-workers** — dynamic fan-out based on planner output
- **Forced tool use** — synthesizer's JSON schema enforcement
- **Prompt caching** — cache_control on system + tools
- **Model routing** — Haiku for simple, Sonnet for synthesis
- **LLM-as-judge** — evaluator scores against rubric
- **MCP client** — stdio connection, tool discovery, call delegation
