---
emoji: 📦
state: active
version: 0.3.0
license: MIT
---

# Nimbus Agents Kit (OSS)

An open-source pack of agent configs and prompt templates that Nimbus Labs publishes
and reuses across internal projects: role prompts for planner/router/worker/synthesizer/
judge patterns, a couple of MCP server templates, and a small eval harness scaffold.

## What's in it

- Agent role-prompt templates (planner, router, worker, synthesizer, judge) with
  forced-tool-use examples
- A minimal stdio MCP server template (the same shape used internally, see
  [[Architecture Decisions]] ADR-2)
- An eval-runner scaffold with LLM-as-judge scoring

## Why open source

The team found itself copy-pasting the same agent scaffolding between Aurora
Notebook's internal tools and Fleet Dashboard's analytics MCP server. Extracting it
into a standalone OSS pack meant one place to fix bugs and onboard new hires, and it
doubles as a public credibility piece.

## Related

- [[Constellation Sync]] and [[Fleet Dashboard]] — both consume patterns from this kit
