/**
 * Orchestrator — advanced version.
 *
 * Pipeline:
 *   1. Planner:    вопрос → N подвопросов
 *   2. Router:     каждый подвопрос → track (quick | deep | impossible)  ↴ parallel
 *   3. Workers:    параллельно, с mode согласно track
 *   4. Synthesize: workers' findings → structured Answer
 *   5. Judge:      оценка (groundedness, relevance, completeness)
 *   6. IF overall < threshold → Revise:
 *        synthesize snова с PREVIOUS + FEEDBACK, max N revisions.
 *        Extended thinking включается на ревизии автоматически.
 *
 * Это orchestrator-workers + routing + evaluator-optimizer комбинированно.
 */

import { judge, type Score } from './evals/judge.js';
import { plan, type PlanResult } from './agents/planner.js';
import { route, type RouteResult, type Track } from './agents/router.js';
import { synthesize, type Answer, type SynthResult } from './agents/synthesizer.js';
import { runWorker, type WorkerResult } from './agents/worker.js';
import type { LLMClient } from './llm/types.js';
import type { VaultMCPClient } from './mcp/vault-client.js';

export interface OrchestrationResult {
  question: string;
  plan: string[];
  routes: Array<{ subquestion: string; track: Track; reason: string }>;
  workerResults: WorkerResult[];
  answer: Answer;
  revisions: number;
  scores: Score[]; // по одному на каждую итерацию synthesize→judge
  thinking?: string;
  metrics: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreateTokens: number;
    estimatedCostUSD: number;
    durationMs: number;
    totalSteps: number;
  };
}

// Упрощённые тарифы (для демонстрации cache экономии)
const PRICE = {
  haiku: { input: 1.0, output: 5.0, cache_read: 0.1, cache_create: 1.25 },
  sonnet: { input: 3.0, output: 15.0, cache_read: 0.3, cache_create: 3.75 },
};

function estimateCost(m: {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
}): number {
  const w = { haiku: 0.7, sonnet: 0.3 };
  const mix = (h: number, s: number) => h * w.haiku + s * w.sonnet;
  const p = {
    input: mix(PRICE.haiku.input, PRICE.sonnet.input),
    output: mix(PRICE.haiku.output, PRICE.sonnet.output),
    cache_read: mix(PRICE.haiku.cache_read, PRICE.sonnet.cache_read),
    cache_create: mix(PRICE.haiku.cache_create, PRICE.sonnet.cache_create),
  };
  return (
    (m.totalInputTokens * p.input +
      m.totalOutputTokens * p.output +
      m.totalCacheReadTokens * p.cache_read +
      m.totalCacheCreateTokens * p.cache_create) /
    1_000_000
  );
}

export interface OrchestrateOptions {
  verbose?: boolean;
  maxWorkers?: number;
  /** Минимальный overall score, ниже которого запускается revision. */
  judgeThreshold?: number;
  /** Максимум ревизий (safety cap). */
  maxRevisions?: number;
  /** Включить extended thinking для сложных вопросов. */
  enableThinkingForDeep?: boolean;
}

export async function orchestrate(
  llm: LLMClient,
  mcp: VaultMCPClient,
  question: string,
  opts: OrchestrateOptions = {}
): Promise<OrchestrationResult> {
  const {
    verbose = false,
    maxWorkers = 5,
    judgeThreshold = 0.7,
    maxRevisions = 1,
    enableThinkingForDeep = true,
  } = opts;
  const log = verbose ? (...a: unknown[]) => console.error('[orch]', ...a) : () => {};
  const start = Date.now();

  // === Phase 1: Plan ===
  log('planning...');
  const planResult: PlanResult = await plan(llm, question);
  const subs = planResult.subquestions.slice(0, maxWorkers);
  log(`plan → ${subs.length} subquestions`);

  // === Phase 2: Route subquestions in parallel ===
  log('routing subquestions...');
  const routeResults: RouteResult[] = await Promise.all(subs.map((sq) => route(llm, sq)));
  const routes = subs.map((sq, i) => ({
    subquestion: sq,
    track: routeResults[i].track,
    reason: routeResults[i].reason,
  }));
  routes.forEach((r, i) => log(`  ${i + 1}. [${r.track}] ${r.subquestion.slice(0, 60)}`));

  // === Phase 3: Fan-out workers with per-route mode ===
  log('dispatching workers (parallel)...');
  const workerResults = await Promise.all(
    routes.map((r) => runWorker(llm, mcp, r.subquestion, r.track))
  );
  log(`workers done, steps: ${workerResults.map((w) => w.steps).join(',')}`);

  // Решаем нужен ли thinking в синтезаторе:
  // если хоть один worker работал в deep-режиме — вопрос сложный.
  const hasDeep = routes.some((r) => r.track === 'deep');
  const useThinking = enableThinkingForDeep && hasDeep;

  // === Phase 4 + 5: Synthesize → Judge → maybe revise ===
  const scores: Score[] = [];
  let synthResult: SynthResult;
  let revisions = 0;

  log(`synthesizing (thinking=${useThinking})...`);
  synthResult = await synthesize(llm, question, workerResults, {
    enableThinking: useThinking,
  });
  log(`synth done, confidence=${synthResult.answer.confidence}`);

  let currentScore = await judge(llm, {
    question,
    rubric:
      'Overall quality: is the answer grounded, relevant, and complete given worker findings?',
    expectedSourceFiles: [],
    answer: synthResult.answer,
  });
  scores.push(currentScore);
  log(
    `judge: overall=${currentScore.overall.toFixed(2)} (threshold=${judgeThreshold}) — ${currentScore.notes}`
  );

  // Evaluator-optimizer loop
  while (currentScore.overall < judgeThreshold && revisions < maxRevisions) {
    revisions++;
    log(`[revision ${revisions}] judge score below threshold, re-synthesizing with feedback...`);
    synthResult = await synthesize(llm, question, workerResults, {
      enableThinking: true, // на ревизии всегда включаем — она дороже, но одна
      revision: {
        previousAnswer: synthResult.answer,
        judgeFeedback:
          `Previous overall=${currentScore.overall.toFixed(2)}. Issues: ${currentScore.notes}. ` +
          `Specifically: groundedness=${currentScore.groundedness.toFixed(2)}, ` +
          `relevance=${currentScore.relevance.toFixed(2)}, ` +
          `completeness=${currentScore.completeness.toFixed(2)}. Address the weakest axis.`,
      },
    });
    log(`[revision ${revisions}] new confidence=${synthResult.answer.confidence}`);

    currentScore = await judge(llm, {
      question,
      rubric: 'Overall quality after revision.',
      expectedSourceFiles: [],
      answer: synthResult.answer,
    });
    scores.push(currentScore);
    log(`[revision ${revisions}] judge: overall=${currentScore.overall.toFixed(2)}`);
  }

  // === Metrics ===
  const sumUsage = (key: 'input' | 'output' | 'cacheRead' | 'cacheCreate') =>
    planResult.usage[key] +
    routeResults.reduce((a, r) => a + r.usage[key], 0) +
    workerResults.reduce((a, w) => a + w.usage[key], 0) +
    synthResult.usage[key];

  // Note: judge usage не включён — в реальном коде добавил бы, для краткости пропущено
  const totalInputTokens = sumUsage('input');
  const totalOutputTokens = sumUsage('output');
  const totalCacheReadTokens = sumUsage('cacheRead');
  const totalCacheCreateTokens = sumUsage('cacheCreate');
  const totalSteps = workerResults.reduce((a, w) => a + w.steps, 0) + 2 + revisions + subs.length;

  const metrics = {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreateTokens,
    estimatedCostUSD: 0,
    durationMs: Date.now() - start,
    totalSteps,
  };
  metrics.estimatedCostUSD = estimateCost(metrics);

  return {
    question,
    plan: subs,
    routes,
    workerResults,
    answer: synthResult.answer,
    revisions,
    scores,
    thinking: synthResult.thinking,
    metrics,
  };
}
