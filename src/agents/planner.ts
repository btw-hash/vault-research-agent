/**
 * Planner agent.
 * Takes a question, returns 2-5 subquestions via forced tool use.
 * Uses Haiku — decomposition is a simple task, speed matters more than depth.
 */

import type { LLMClient, ToolDef } from '../llm/types.js';

const PLANNER_SYSTEM = `ROLE: planner

You decompose a user's research question into 2-5 independent subquestions.
The subquestions will be investigated in parallel by workers that search an Obsidian vault
(a personal knowledge base with projects/, daily/, logs/, reference/ folders).

Principles:
- Each subquestion must be self-contained and answerable from vault search alone.
- Avoid redundancy — subquestions should target different angles.
- Prefer concrete keywords/entities over abstract phrasing.
- 2 is enough for simple questions; 5 max for broad topics.

You MUST call the emit_subquestions tool. Do not produce free text.`;

const EMIT_SUBQUESTIONS_TOOL: ToolDef = {
  name: 'emit_subquestions',
  description: 'Emit the decomposed subquestions. Always call this tool.',
  input_schema: {
    type: 'object',
    properties: {
      subquestions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 5,
        description: 'Independent research subquestions',
      },
    },
    required: ['subquestions'],
  },
};

export interface PlanResult {
  subquestions: string[];
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export async function plan(llm: LLMClient, question: string): Promise<PlanResult> {
  const res = await llm.complete({
    model: 'claude-haiku-4-5-20251001',
    system: [
      {
        type: 'text',
        text: PLANNER_SYSTEM,
        cache_control: { type: 'ephemeral' }, // cached — system prompt never changes
      },
    ],
    messages: [{ role: 'user', content: question }],
    tools: [EMIT_SUBQUESTIONS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_subquestions' }, // FORCED
    max_tokens: 1024,
  });

  const toolUse = res.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Planner did not call emit_subquestions');
  }

  const input = toolUse.input as { subquestions: string[] };
  if (!Array.isArray(input.subquestions) || input.subquestions.length < 2) {
    throw new Error('Planner returned invalid subquestions');
  }

  return {
    subquestions: input.subquestions,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreate: res.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
