/**
 * Eval runner.
 *
 * Гоняет весь orchestrator на test cases, собирает judge-оценки,
 * выдаёт aggregate отчёт и сохраняет detailed JSON для регрессий.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLLMClient } from '../llm/client.js';
import { VaultMCPClient } from '../mcp/vault-client.js';
import { orchestrate } from '../orchestrator.js';
import { judge, type Score } from './judge.js';

interface TestCase {
  id: string;
  question: string;
  expectedSourceFiles: string[];
  rubric: string;
}

interface CaseResult {
  caseId: string;
  question: string;
  score: Score;
  hadExpectedSource: boolean;
  confidence: number;
  durationMs: number;
  costUSD: number;
}

async function main() {
  const llm = createLLMClient();
  const mcp = new VaultMCPClient('c:/AI/mcp-obsidian/dist/index.js');
  await mcp.connect();

  const testsetPath = path.resolve(process.cwd(), 'evals/testset.json');
  const testset = JSON.parse(await fs.readFile(testsetPath, 'utf-8'));
  const cases: TestCase[] = testset.cases;

  // Для экономии: можно ограничить через env EVAL_LIMIT
  const limit = process.env.EVAL_LIMIT ? Number(process.env.EVAL_LIMIT) : cases.length;
  const selected = cases.slice(0, limit);

  console.error(`[eval] running ${selected.length} cases (of ${cases.length})`);

  const results: CaseResult[] = [];
  for (const tc of selected) {
    console.error(`\n[eval] ${tc.id}: ${tc.question.slice(0, 60)}`);
    try {
      const orch = await orchestrate(llm, mcp, tc.question, { verbose: false });

      const hadExpectedSource =
        tc.expectedSourceFiles.length === 0 ||
        tc.expectedSourceFiles.some((exp) => orch.answer.sources.some((s) => s.file.includes(exp)));

      const score = await judge(llm, {
        question: tc.question,
        rubric: tc.rubric,
        expectedSourceFiles: tc.expectedSourceFiles,
        answer: orch.answer,
      });

      results.push({
        caseId: tc.id,
        question: tc.question,
        score,
        hadExpectedSource,
        confidence: orch.answer.confidence,
        durationMs: orch.metrics.durationMs,
        costUSD: orch.metrics.estimatedCostUSD,
      });

      console.error(
        `  → overall=${score.overall.toFixed(2)} ` +
          `g=${score.groundedness.toFixed(2)} r=${score.relevance.toFixed(2)} c=${score.completeness.toFixed(2)} ` +
          `expected_src=${hadExpectedSource ? '✓' : '✗'} cost=$${orch.metrics.estimatedCostUSD.toFixed(4)}`
      );
    } catch (err) {
      console.error(`  ERROR:`, err instanceof Error ? err.message : err);
      results.push({
        caseId: tc.id,
        question: tc.question,
        score: {
          groundedness: 0,
          relevance: 0,
          completeness: 0,
          overall: 0,
          notes: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        },
        hadExpectedSource: false,
        confidence: 0,
        durationMs: 0,
        costUSD: 0,
      });
    }
  }

  await mcp.close();

  // Aggregate
  const n = results.length;
  const avg = (f: (r: CaseResult) => number) => results.reduce((a, r) => a + f(r), 0) / n;
  const aggregate = {
    cases: n,
    avgOverall: avg((r) => r.score.overall),
    avgGroundedness: avg((r) => r.score.groundedness),
    avgRelevance: avg((r) => r.score.relevance),
    avgCompleteness: avg((r) => r.score.completeness),
    expectedSourceRate: results.filter((r) => r.hadExpectedSource).length / n,
    avgDurationMs: avg((r) => r.durationMs),
    totalCostUSD: results.reduce((a, r) => a + r.costUSD, 0),
  };

  console.error('\n=== AGGREGATE ===');
  console.error(`cases:                 ${aggregate.cases}`);
  console.error(`avg overall score:     ${aggregate.avgOverall.toFixed(3)}`);
  console.error(`  groundedness:        ${aggregate.avgGroundedness.toFixed(3)}`);
  console.error(`  relevance:           ${aggregate.avgRelevance.toFixed(3)}`);
  console.error(`  completeness:        ${aggregate.avgCompleteness.toFixed(3)}`);
  console.error(`expected source rate:  ${(aggregate.expectedSourceRate * 100).toFixed(1)}%`);
  console.error(`avg duration:          ${aggregate.avgDurationMs.toFixed(0)}ms`);
  console.error(`total cost:            $${aggregate.totalCostUSD.toFixed(4)}`);

  // Save detailed report
  const reportPath = path.resolve(
    process.cwd(),
    `evals/report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  await fs.writeFile(reportPath, JSON.stringify({ aggregate, results }, null, 2));
  console.error(`\nreport: ${reportPath}`);

  // Regression threshold (пример)
  const THRESHOLD = 0.65;
  if (aggregate.avgOverall < THRESHOLD) {
    console.error(`\n[FAIL] avg overall ${aggregate.avgOverall.toFixed(3)} < ${THRESHOLD}`);
    process.exit(1);
  }
  console.error(`\n[PASS] avg overall >= ${THRESHOLD}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
