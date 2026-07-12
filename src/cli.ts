#!/usr/bin/env node
/**
 * CLI entrypoint — streams the answer through the narrator agent.
 *
 * Pipeline: orchestrate → structured Answer → narrate (stream) → print tokens live.
 *
 * Usage:
 *   npm start -- "your question"
 *   VERBOSE=1 npm start -- "question"                # orchestrator logs
 *   LLM_MODE=mock npm start -- "question"             # force mock
 *   JUDGE_THRESHOLD=0.8 npm start -- "question"       # trigger revision more aggressively
 *   NO_STREAM=1 npm start -- "question"               # disable streaming
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate } from './agents/narrator.js';
import { createLLMClient } from './llm/client.js';
import { VaultMCPClient } from './mcp/vault-client.js';
import { orchestrate } from './orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vendored MCP server, built alongside this project (see vendor/mcp-obsidian, npm run build:mcp).
const DEFAULT_MCP_SERVER_PATH = path.resolve(
  __dirname,
  '..',
  'vendor',
  'mcp-obsidian',
  'dist',
  'index.js'
);

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm start -- "your question"');
    process.exit(1);
  }

  const llm = createLLMClient();
  const mcp = new VaultMCPClient(process.env.MCP_SERVER_PATH ?? DEFAULT_MCP_SERVER_PATH);
  await mcp.connect();

  try {
    const result = await orchestrate(llm, mcp, question, {
      verbose: process.env.VERBOSE === '1',
      judgeThreshold: process.env.JUDGE_THRESHOLD ? Number(process.env.JUDGE_THRESHOLD) : 0.7,
      maxRevisions: process.env.MAX_REVISIONS ? Number(process.env.MAX_REVISIONS) : 1,
    });

    // === Streaming narration ===
    console.log('\n=== ANSWER (streaming) ===\n');
    if (process.env.NO_STREAM === '1') {
      console.log(result.answer.answer);
    } else {
      await narrate(llm, result.answer, (chunk) => process.stdout.write(chunk));
      console.log('\n');
    }

    // === Sources ===
    console.log('\n--- Sources ---');
    result.answer.sources.forEach((s) => {
      console.log(`  • ${s.file}${s.line ? `:${s.line}` : ''}\n      "${s.snippet.slice(0, 140)}"`);
    });

    // === Thinking (if any) ===
    if (result.thinking) {
      console.log('\n--- Synthesizer thinking (extended) ---');
      console.log(result.thinking.slice(0, 400) + (result.thinking.length > 400 ? '...' : ''));
    }

    // === Execution trace ===
    console.log('\n--- Routing ---');
    result.routes.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.track}] ${r.subquestion.slice(0, 70)}`);
      console.log(`     reason: ${r.reason}`);
    });

    // === Judge / revisions ===
    console.log(
      `\n--- Judge (${result.scores.length} pass${result.scores.length > 1 ? 'es' : ''}) ---`
    );
    result.scores.forEach((s, i) => {
      const label = i === 0 ? 'initial' : `revision ${i}`;
      console.log(
        `  ${label}: overall=${s.overall.toFixed(2)} ` +
          `g=${s.groundedness.toFixed(2)} r=${s.relevance.toFixed(2)} c=${s.completeness.toFixed(2)}`
      );
      console.log(`    notes: ${s.notes}`);
    });
    console.log(`Revisions: ${result.revisions}, final confidence: ${result.answer.confidence}`);

    // === Metrics ===
    console.log('\n--- Metrics ---');
    console.log(`Duration:        ${result.metrics.durationMs}ms`);
    console.log(`Total steps:     ${result.metrics.totalSteps}`);
    console.log(`Input tokens:    ${result.metrics.totalInputTokens}`);
    console.log(`Output tokens:   ${result.metrics.totalOutputTokens}`);
    console.log(`Cache read:      ${result.metrics.totalCacheReadTokens}`);
    console.log(`Cache create:    ${result.metrics.totalCacheCreateTokens}`);
    console.log(`Estimated cost:  $${result.metrics.estimatedCostUSD.toFixed(5)}`);
  } finally {
    await mcp.close();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
