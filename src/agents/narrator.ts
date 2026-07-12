/**
 * Narrator agent.
 *
 * Takes the structured Answer from the synthesizer and streams a human-readable
 * prose version to the CLI. Haiku — the task is simple (reformatting).
 *
 * This is the "last mile": the synthesizer emits JSON (for machines/logs),
 * the narrator gives the user text for their eyes, token by token.
 */

import type { LLMClient, StreamEvent } from '../llm/types.js';
import type { Answer } from './synthesizer.js';

const NARRATOR_SYSTEM = `ROLE: narrator

You receive a structured research answer (JSON with answer + sources + confidence).
Your job: produce a flowing, friendly paragraph for the user.

Style:
- Conversational but precise.
- 2-4 sentences.
- Reference 1-2 most relevant sources inline (e.g. "per the Weekly Log entry...").
- If confidence < 0.3, open with "Nothing conclusive found in the vault, but..." and explain.
- Answer in English unless the user's question was written in another language.

Output PLAIN TEXT only. No markdown headers, no tool calls.`;

export async function narrate(
  llm: LLMClient,
  answer: Answer,
  onChunk: (chunk: string) => void
): Promise<{
  prose: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}> {
  const userPayload = JSON.stringify(answer, null, 2);

  if (!llm.completeStream) {
    // Fallback to non-streaming if the client doesn't support it
    const res = await llm.complete({
      model: 'claude-haiku-4-5-20251001',
      system: [{ type: 'text', text: NARRATOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPayload }],
      max_tokens: 512,
    });
    const text = res.content
      .filter((c) => c.type === 'text')
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('');
    onChunk(text);
    return {
      prose: text,
      usage: {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cacheRead: res.usage.cache_read_input_tokens ?? 0,
        cacheCreate: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  let collected = '';
  const res = await llm.completeStream(
    {
      model: 'claude-haiku-4-5-20251001',
      system: [{ type: 'text', text: NARRATOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPayload }],
      max_tokens: 512,
    },
    (ev: StreamEvent) => {
      if (ev.type === 'text_delta') {
        collected += ev.delta;
        onChunk(ev.delta);
      }
    }
  );

  return {
    prose: collected,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreate: res.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
