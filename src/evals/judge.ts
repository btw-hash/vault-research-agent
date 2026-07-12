/**
 * LLM-as-judge.
 *
 * Scores an answer along 3 axes via forced tool use. Opus/Sonnet (stronger than the generator).
 *
 * Rubric:
 *   - groundedness: is every claim backed by a source?
 *   - relevance: does the answer address the question, no tangents?
 *   - completeness: does it cover the rubric from the test case?
 */

import type { LLMClient, ToolDef } from '../llm/types.js';
import type { Answer } from '../agents/synthesizer.js';

const JUDGE_SYSTEM = `ROLE: judge

You evaluate a research agent's answer against a test case rubric.
Score three axes 0.0-1.0:
  - groundedness: does every factual claim cite a source? Invented sources = 0.
  - relevance: does the answer address the question (not tangent)?
  - completeness: are all rubric points covered?

Also produce overall = weighted mean (groundedness 0.4, relevance 0.3, completeness 0.3).

Be strict. 0.9+ only if truly excellent. If answer says "no data" on a question that SHOULD
have data, that's completeness=0. If it admits no-data on an impossible question, that's
groundedness=1.0.

You MUST call emit_score. No free text.`;

const EMIT_SCORE_TOOL: ToolDef = {
  name: 'emit_score',
  description: 'Emit the scoring result. Always call this.',
  input_schema: {
    type: 'object',
    properties: {
      groundedness: { type: 'number', description: '0.0-1.0' },
      relevance: { type: 'number', description: '0.0-1.0' },
      completeness: { type: 'number', description: '0.0-1.0' },
      overall: { type: 'number', description: '0.0-1.0 weighted mean' },
      notes: { type: 'string', description: 'One-sentence justification' },
    },
    required: ['groundedness', 'relevance', 'completeness', 'overall', 'notes'],
  },
};

export interface Score {
  groundedness: number;
  relevance: number;
  completeness: number;
  overall: number;
  notes: string;
}

export interface JudgeInput {
  question: string;
  rubric: string;
  expectedSourceFiles: string[];
  answer: Answer;
}

export async function judge(llm: LLMClient, input: JudgeInput): Promise<Score> {
  const userContent = [
    `QUESTION: ${input.question}`,
    `RUBRIC: ${input.rubric}`,
    `EXPECTED SOURCE FILES (partial match OK): ${input.expectedSourceFiles.join(', ') || '(none specified)'}`,
    '',
    `AGENT ANSWER: ${input.answer.answer}`,
    `AGENT CONFIDENCE: ${input.answer.confidence}`,
    `AGENT SOURCES:`,
    ...input.answer.sources.map(
      (s) => `  - ${s.file}${s.line ? `:${s.line}` : ''} "${s.snippet.slice(0, 120)}"`
    ),
  ].join('\n');

  const res = await llm.complete({
    model: 'claude-sonnet-4-6',
    system: [{ type: 'text', text: JUDGE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
    tools: [EMIT_SCORE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_score' },
    max_tokens: 512,
  });

  const tu = res.content.find((c) => c.type === 'tool_use');
  if (!tu || tu.type !== 'tool_use') throw new Error('Judge did not call emit_score');
  return tu.input as unknown as Score;
}
