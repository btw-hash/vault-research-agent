/**
 * Worker agent — agentic loop with two modes.
 *
 * Modes (set by Router):
 *   - 'quick': Haiku, max 2 steps, only search_notes/list_projects
 *   - 'deep':  Sonnet, max 5 steps, full vault toolset including read_note
 *   - 'impossible': short-circuit path with no LLM call, returns "no data"
 */

import type { LLMClient, Message, Model, ToolDef } from '../llm/types.js';
import type { VaultMCPClient } from '../mcp/vault-client.js';
import type { Track } from './router.js';

const WORKER_SYSTEM_QUICK = `ROLE: worker
MODE: quick

You are a quick research worker. One search, one answer.
Use vault_search_notes with focused keywords. Produce findings in 1 step if possible.

Format:
FINDINGS:
- [path:line] snippet
SUMMARY: 1 sentence.

Principles:
- Max ONE search. If first search returns nothing relevant — stop, say "no data".
- Never read full files in quick mode.`;

const WORKER_SYSTEM_DEEP = `ROLE: worker
MODE: deep

You are an in-depth research worker. Given an analytical or comparative subquestion,
locate candidates via search, then read 1-3 full files for full context.

Format:
FINDINGS:
- [path:line] detailed snippet or summary
- [...]
SUMMARY: 2-3 sentences with comparison/analysis.

Principles:
- Start with vault_search_notes (broad keywords), then vault_read_note on top candidates.
- Read at most 3 full files — more = context bloat.
- Stop once you have enough to answer comprehensively.`;

export interface WorkerResult {
  subquestion: string;
  track: Track;
  findings: string;
  steps: number;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export async function runWorker(
  llm: LLMClient,
  mcp: VaultMCPClient,
  subquestion: string,
  track: Track
): Promise<WorkerResult> {
  // Short-circuit: impossible subquestion — no LLM call.
  if (track === 'impossible') {
    return {
      subquestion,
      track,
      findings: 'No relevant findings (classified as impossible — outside vault scope).',
      steps: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    };
  }

  const isQuick = track === 'quick';
  const model: Model = isQuick ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
  const maxSteps = isQuick ? 2 : 5;
  const system = isQuick ? WORKER_SYSTEM_QUICK : WORKER_SYSTEM_DEEP;

  // Quick mode — trim the toolset: search + list only, no read_note
  const allTools = mcp.toAnthropicTools();
  const tools: ToolDef[] = (
    isQuick ? allTools.filter((t) => t.name !== 'vault_read_note') : allTools
  ).map((t, i, arr) => {
    if (i === arr.length - 1) return { ...t, cache_control: { type: 'ephemeral' } };
    return t;
  });

  const messages: Message[] = [{ role: 'user', content: subquestion }];
  let steps = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;

  for (let i = 0; i < maxSteps; i++) {
    steps++;
    const res = await llm.complete({
      model,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      tools,
      max_tokens: isQuick ? 512 : 1024,
    });

    totalInput += res.usage.input_tokens;
    totalOutput += res.usage.output_tokens;
    totalCacheRead += res.usage.cache_read_input_tokens ?? 0;
    totalCacheCreate += res.usage.cache_creation_input_tokens ?? 0;

    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason === 'end_turn') {
      const finalText = res.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('\n');
      return {
        subquestion,
        track,
        findings: finalText,
        steps,
        usage: {
          input: totalInput,
          output: totalOutput,
          cacheRead: totalCacheRead,
          cacheCreate: totalCacheCreate,
        },
      };
    }

    const toolUses = res.content.filter((c) => c.type === 'tool_use');
    if (toolUses.length === 0) break;

    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        if (tu.type !== 'tool_use') throw new Error('unreachable');
        try {
          const result = await mcp.callTool(tu.name, tu.input);
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: result.slice(0, 4000),
          };
        } catch (err) {
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  const last = messages[messages.length - 1];
  const fallback =
    typeof last.content === 'string'
      ? last.content
      : last.content
          .filter((c) => c.type === 'text')
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join('\n');

  return {
    subquestion,
    track,
    findings: fallback || 'No findings (max steps exhausted).',
    steps,
    usage: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheCreate: totalCacheCreate,
    },
  };
}
