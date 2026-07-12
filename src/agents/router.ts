/**
 * Router agent.
 *
 * Classifier: subquestion → 'quick' | 'deep' | 'impossible'.
 * Haiku — the task is simple, speed and cost are critical.
 *
 * Rules:
 *   - quick: factual lookup ("when was X?", "what's the status of Y?") — 1 search is enough
 *   - deep: analysis/comparison ("how does A differ from B", "how is X architected") —
 *     needs to read whole files, possibly with extended thinking
 *   - impossible: it's already clear the vault has nothing on this (anti-hallucination)
 */

import type { LLMClient, ToolDef } from '../llm/types.js';

const ROUTER_SYSTEM = `ROLE: router

You classify research subquestions into execution tracks.
Labels:
  - "quick": factual lookup answerable with 1-2 searches (dates, names, statuses, short facts)
  - "deep": analysis, comparison, architecture explanation (needs to read 2+ full files)
  - "impossible": question is outside the vault's likely content

The vault contains: personal project notes (projects/), daily logs (daily/), session history (logs/),
reference docs (reference/). Topics: software projects, AI/ML tools, Obsidian+Notion sync,
agent architectures. NO quantum physics, NO recipes, NO finance advice.

You MUST call emit_route. No free text.`;

const EMIT_ROUTE_TOOL: ToolDef = {
  name: 'emit_route',
  description: 'Emit the classification. Always call this.',
  input_schema: {
    type: 'object',
    properties: {
      track: {
        type: 'string',
        enum: ['quick', 'deep', 'impossible'],
        description: 'Execution track for this subquestion',
      },
      reason: {
        type: 'string',
        description: 'One short sentence justifying the choice',
      },
    },
    required: ['track', 'reason'],
  },
};

export type Track = 'quick' | 'deep' | 'impossible';

export interface RouteResult {
  track: Track;
  reason: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export async function route(llm: LLMClient, subquestion: string): Promise<RouteResult> {
  const res = await llm.complete({
    model: 'claude-haiku-4-5-20251001',
    system: [{ type: 'text', text: ROUTER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: subquestion }],
    tools: [EMIT_ROUTE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_route' },
    max_tokens: 256,
  });

  const tu = res.content.find((c) => c.type === 'tool_use');
  if (!tu || tu.type !== 'tool_use') throw new Error('Router did not call emit_route');
  const input = tu.input as { track: Track; reason: string };
  return {
    track: input.track,
    reason: input.reason,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreate: res.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
