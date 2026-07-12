/**
 * Synthesizer agent — structured JSON answer via forced tool use.
 *
 * Extensions:
 *   - revision mode: a second pass with JUDGE FEEDBACK for the evaluator-optimizer loop
 *   - extended thinking: switched on when the question is complex
 *
 * Sonnet for synthesis quality. Thinking is optional — you pay tokens for the model to think.
 */

import type { LLMClient, ToolDef } from '../llm/types.js';
import type { WorkerResult } from './worker.js';

const SYNTHESIZER_SYSTEM = `ROLE: synthesizer

You receive a user's question and findings from multiple research workers.
Produce a single structured answer:
  - Prose answer (2-5 sentences)
  - Concrete source citations (file + line + quoted snippet)
  - Confidence 0.0-1.0 based on evidence quality

Principles:
- Ground EVERY claim in a source. Never invent files or lines.
- Dedupe citations. Prefer recent (daily/, Session History) over old reference docs.
- If workers found nothing, set confidence <0.3 and say so.
- If given PREVIOUS ATTEMPT + JUDGE FEEDBACK, produce a revised answer addressing specific issues.

You MUST call the emit_answer tool.`;

const EMIT_ANSWER_TOOL: ToolDef = {
  name: 'emit_answer',
  description: 'Emit the final structured answer. Always call this.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'Prose answer, 2-5 sentences' },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            line: { type: 'number' },
            snippet: { type: 'string' },
          },
          required: ['file', 'snippet'],
        },
      },
      confidence: { type: 'number', description: '0.0-1.0' },
    },
    required: ['answer', 'sources', 'confidence'],
  },
};

export interface Answer {
  answer: string;
  sources: Array<{ file: string; line?: number; snippet: string }>;
  confidence: number;
}

export interface SynthResult {
  answer: Answer;
  thinking?: string;
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export interface SynthOptions {
  /** Enable extended thinking (costs more, helps on complex questions). */
  enableThinking?: boolean;
  /** Token budget for thinking. */
  thinkingBudget?: number;
  /** Previous attempt and judge notes — turns on revision mode. */
  revision?: {
    previousAnswer: Answer;
    judgeFeedback: string;
  };
}

export async function synthesize(
  llm: LLMClient,
  question: string,
  workerResults: WorkerResult[],
  opts: SynthOptions = {}
): Promise<SynthResult> {
  const findingsBlob = workerResults
    .map(
      (r, i) =>
        `--- Worker ${i + 1} [${r.track}] (subquestion: "${r.subquestion}") ---\n${r.findings}`
    )
    .join('\n\n');

  const revisionBlob = opts.revision
    ? `\n\nPREVIOUS ATTEMPT:\n${JSON.stringify(opts.revision.previousAnswer, null, 2)}\n\n` +
      `JUDGE FEEDBACK:\n${opts.revision.judgeFeedback}\n\n` +
      `Produce a revised answer that addresses these issues.`
    : '';

  const userMessage = `Original question:\n${question}\n\nWorker findings:\n${findingsBlob}${revisionBlob}`;

  const res = await llm.complete({
    model: 'claude-sonnet-4-6',
    system: [
      {
        type: 'text',
        text: SYNTHESIZER_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
    tools: [EMIT_ANSWER_TOOL],
    tool_choice: { type: 'tool', name: 'emit_answer' },
    max_tokens: 2048,
    thinking: opts.enableThinking
      ? { type: 'enabled', budget_tokens: opts.thinkingBudget ?? 3000 }
      : undefined,
  });

  const toolUse = res.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Synthesizer did not call emit_answer');
  }

  const thinkingBlock = res.content.find((c) => c.type === 'thinking');
  const thinkingText =
    thinkingBlock && thinkingBlock.type === 'thinking' ? thinkingBlock.thinking : undefined;

  return {
    answer: toolUse.input as unknown as Answer,
    thinking: thinkingText,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheCreate: res.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
