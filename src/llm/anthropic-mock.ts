/**
 * Mock LLM client — simulates Anthropic API behavior for offline/zero-config use.
 *
 * Detects the "role" of a request from a sigil in the system prompt and returns a
 * realistic response of the right shape. Also simulates:
 *   - prompt caching (cache_creation/cache_read tokens)
 *   - extended thinking (thinking block when enabled)
 *   - streaming (completeStream with text_delta events)
 *   - a stateful judge (first call — low score, second — high score, to
 *     demonstrate the evaluator-optimizer loop)
 */

import type {
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  LLMClient,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
} from './types.js';

function systemText(req: CompletionRequest): string {
  if (!req.system) return '';
  if (typeof req.system === 'string') return req.system;
  return req.system.map((b) => b.text).join('\n');
}

function lastUserMessage(req: CompletionRequest): string {
  const last = req.messages[req.messages.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return last.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function hasToolResultsInLastTurn(req: CompletionRequest): boolean {
  const last = req.messages[req.messages.length - 1];
  if (!last || typeof last.content === 'string') return false;
  return last.content.some((b) => b.type === 'tool_result');
}

function countTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function reqInputTokens(req: CompletionRequest): number {
  const systemLen = countTokens(systemText(req));
  const toolsLen = countTokens(JSON.stringify(req.tools ?? []));
  const msgsLen = req.messages.reduce(
    (a, m) =>
      a + countTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)),
    0
  );
  return systemLen + toolsLen + msgsLen;
}

// ---------- Cache simulation ----------

const cacheMemory = new Map<string, number>();

function cacheSignature(req: CompletionRequest): string | null {
  const sys = typeof req.system === 'string' ? [] : (req.system ?? []);
  const hasCache =
    sys.some((b: any) => b.cache_control) || (req.tools ?? []).some((t: any) => t.cache_control);
  if (!hasCache) return null;
  return JSON.stringify({ system: req.system, tools: req.tools });
}

function simulateCache(req: CompletionRequest) {
  const sig = cacheSignature(req);
  if (!sig) return { cached: 0, created: 0 };

  const sysArr = typeof req.system === 'string' ? [] : (req.system ?? []);
  const cacheableSystem = sysArr
    .filter((b: any) => b.cache_control)
    .reduce((a: number, b: any) => a + countTokens(b.text), 0);
  const cacheableTools = (req.tools ?? [])
    .filter((t: any) => t.cache_control)
    .reduce((a, t) => a + countTokens(JSON.stringify(t)), 0);
  const cached = cacheableSystem + cacheableTools;

  if (cacheMemory.has(sig)) return { cached, created: 0 };
  cacheMemory.set(sig, cached);
  return { cached: 0, created: cached };
}

// ---------- Role detection ----------

type Role = 'planner' | 'router' | 'worker' | 'synthesizer' | 'judge' | 'narrator' | 'other';

function detectRole(req: CompletionRequest): Role {
  const s = systemText(req).toLowerCase();
  if (s.includes('role: planner')) return 'planner';
  if (s.includes('role: router')) return 'router';
  if (s.includes('role: worker')) return 'worker';
  if (s.includes('role: synthesizer')) return 'synthesizer';
  if (s.includes('role: judge')) return 'judge';
  if (s.includes('role: narrator')) return 'narrator';
  return 'other';
}

function isRevisionSynthesis(req: CompletionRequest): boolean {
  // If the user message contains "PREVIOUS ATTEMPT" — this is the synthesizer's second pass
  const last = lastUserMessage(req);
  return last.includes('PREVIOUS ATTEMPT') || last.includes('JUDGE FEEDBACK');
}

// ---------- Role-specific fake responses ----------

function plannerResponse(req: CompletionRequest): ContentBlock[] {
  const q = lastUserMessage(req);
  const tool = req.tools?.find((t) => t.name === 'emit_subquestions');
  if (!tool) return [{ type: 'text', text: 'planner fallback' }];

  return [
    {
      type: 'tool_use',
      id: 'tu_plan_1',
      name: 'emit_subquestions',
      input: {
        subquestions: [
          `What vault keywords are relevant to: "${q.slice(0, 60)}"?`,
          `Which vault projects mention the topic of this question?`,
          `Are there any daily/ or logs/ entries about this?`,
        ],
      },
    } as ToolUseBlock,
  ];
}

function routerResponse(req: CompletionRequest): ContentBlock[] {
  const q = lastUserMessage(req).toLowerCase();
  const tool = req.tools?.find((t) => t.name === 'emit_route');
  if (!tool) return [{ type: 'text', text: 'router fallback' }];

  // Simple heuristic:
  //   - "quantum", "kubernetes" (test q15) → impossible
  //   - "differ", "how is ... architected", "architecture" → deep
  //   - otherwise → quick
  let track: 'quick' | 'deep' | 'impossible' = 'quick';
  let reason = 'Factual lookup, search sufficient.';
  if (q.includes('quantum') || q.includes('teleport')) {
    track = 'impossible';
    reason = 'Topic outside vault scope.';
  } else if (
    q.includes('differ') ||
    q.includes('how is') ||
    q.includes('architect') ||
    q.includes('compare')
  ) {
    track = 'deep';
    reason = 'Analytical question requires reading multiple files.';
  }

  return [
    {
      type: 'tool_use',
      id: 'tu_route_1',
      name: 'emit_route',
      input: { track, reason },
    } as ToolUseBlock,
  ];
}

function workerResponse(req: CompletionRequest): ContentBlock[] {
  const hasResults = hasToolResultsInLastTurn(req);
  const q = lastUserMessage(req);
  const isDeepMode = systemText(req).toLowerCase().includes('mode: deep');

  if (!hasResults) {
    const toolName = isDeepMode ? 'vault_search_notes' : 'vault_search_notes';
    return [
      { type: 'text', text: `Searching vault for: ${q.slice(0, 40)}` } as TextBlock,
      {
        type: 'tool_use',
        id: `tu_w_${Math.random().toString(36).slice(2, 8)}`,
        name: toolName,
        input: { query: q.split(/\s+/).slice(0, 2).join(' '), limit: 5 },
      } as ToolUseBlock,
    ];
  }

  // Got a tool_result — return a summary
  const prefix = isDeepMode ? '[DEEP]' : '[QUICK]';
  return [
    {
      type: 'text',
      text:
        `${prefix} FINDINGS:\n` +
        `- [logs/Session History.md:12] Analytics MCP integration added for Fleet Dashboard\n` +
        `- [logs/Weekly Log.md:8] Connected the analytics MCP server\n` +
        `SUMMARY: Found a few mentions of the topic in the vault.`,
    } as TextBlock,
  ];
}

function synthesizerResponse(req: CompletionRequest): ContentBlock[] {
  const tool = req.tools?.find((t) => t.name === 'emit_answer');
  if (!tool) return [{ type: 'text', text: 'synth fallback' }];

  const isRevision = isRevisionSynthesis(req);
  const hasThinking = req.thinking?.type === 'enabled';

  const blocks: ContentBlock[] = [];

  // Extended thinking — return a thinking block when enabled
  if (hasThinking) {
    blocks.push({
      type: 'thinking',
      thinking:
        '[mock thinking] Analyzing worker findings. Sources from logs/Session History.md ' +
        'and logs/Weekly Log.md converge on the analytics MCP setup timeline. ' +
        'Cross-reference confirms the event. Confidence 0.85+ warranted.',
    } as ThinkingBlock);
  }

  blocks.push({
    type: 'tool_use',
    id: 'tu_synth_1',
    name: 'emit_answer',
    input: {
      answer: isRevision
        ? '[MOCK REVISED] Revised answer after judge feedback: 3 sources examined in detail, ' +
          'every claim backed by a citation. Confidence raised after the re-check.'
        : '[MOCK] Based on vault research: the topic is mentioned in Session History, Weekly Log ' +
          'and the project notes. Concrete sources below.',
      sources: [
        {
          file: 'logs/Session History.md',
          line: 12,
          snippet: 'Analytics MCP integration added for Fleet Dashboard...',
        },
        {
          file: 'logs/Weekly Log.md',
          line: 8,
          snippet: 'Connected the analytics MCP server...',
        },
        {
          file: 'Home.md',
          line: 15,
          snippet: 'Tools & Integrations — Claude Code, MCP...',
        },
      ],
      confidence: isRevision ? 0.92 : 0.75,
    },
  } as ToolUseBlock);

  return blocks;
}

// Stateful judge — demonstrates the evaluator-optimizer loop
let judgeCallCount = 0;
function judgeResponse(req: CompletionRequest): ContentBlock[] {
  const tool = req.tools?.find((t) => t.name === 'emit_score');
  if (!tool) return [{ type: 'text', text: 'judge fallback' }];

  judgeCallCount++;
  // If synthesis was the first attempt (confidence=0.75 in the answer) — low score
  // If it's a revision (confidence=0.92) — high score
  const userMsg = lastUserMessage(req);
  const isRevision = userMsg.includes('MOCK REVISED');

  const scores = isRevision
    ? { groundedness: 0.92, relevance: 0.9, completeness: 0.88, overall: 0.9 }
    : { groundedness: 0.48, relevance: 0.8, completeness: 0.65, overall: 0.62 };

  return [
    {
      type: 'tool_use',
      id: `tu_j_${judgeCallCount}`,
      name: 'emit_score',
      input: {
        ...scores,
        notes: isRevision
          ? '[mock] Revised answer has stronger grounding; all claims cited.'
          : '[mock] Weak grounding — several statements lack explicit source citation.',
      },
    } as ToolUseBlock,
  ];
}

function narratorResponse(req: CompletionRequest): ContentBlock[] {
  // Narrator — just reformats the JSON answer into prose, no tools
  const userContent = lastUserMessage(req);
  // Pull "answer" out of the JSON if present
  let prose =
    '[MOCK narrator] Based on vault research: your question relates to a few mentions ' +
    'across the logs and project notes. The most relevant sources are listed below. ' +
    'Ask about a specific aspect for more detail.';
  try {
    const parsed = JSON.parse(userContent);
    if (parsed.answer) prose = `[MOCK narrator] ${parsed.answer}`;
  } catch {
    // not JSON — use default
  }
  return [{ type: 'text', text: prose } as TextBlock];
}

// ---------- Mock client ----------

function buildResponse(req: CompletionRequest): CompletionResponse {
  const role = detectRole(req);

  let content: ContentBlock[];
  switch (role) {
    case 'planner':
      content = plannerResponse(req);
      break;
    case 'router':
      content = routerResponse(req);
      break;
    case 'worker':
      content = workerResponse(req);
      break;
    case 'synthesizer':
      content = synthesizerResponse(req);
      break;
    case 'judge':
      content = judgeResponse(req);
      break;
    case 'narrator':
      content = narratorResponse(req);
      break;
    default:
      content = [{ type: 'text', text: '[mock] generic response' } as TextBlock];
  }

  const { cached, created } = simulateCache(req);
  const input = reqInputTokens(req) - cached;
  const output = countTokens(JSON.stringify(content));

  const hasToolUse = content.some((c) => c.type === 'tool_use');

  return {
    content,
    stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: Math.max(input, 1),
      output_tokens: output,
      cache_creation_input_tokens: created || undefined,
      cache_read_input_tokens: cached || undefined,
    },
  };
}

export class MockAnthropicClient implements LLMClient {
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    return buildResponse(req);
  }

  async completeStream(
    req: CompletionRequest,
    onEvent: (e: StreamEvent) => void
  ): Promise<CompletionResponse> {
    const response = buildResponse(req);

    // Emit events as the response is "generated"
    for (const block of response.content) {
      if (block.type === 'text') {
        // Stream in 20-character chunks
        const text = block.text;
        for (let i = 0; i < text.length; i += 20) {
          const chunk = text.slice(i, i + 20);
          onEvent({ type: 'text_delta', delta: chunk });
          await new Promise((r) => setTimeout(r, 30));
        }
      } else if (block.type === 'thinking') {
        onEvent({ type: 'thinking_delta', delta: block.thinking });
      } else if (block.type === 'tool_use') {
        onEvent({ type: 'tool_use_start', name: block.name });
      }
    }

    onEvent({ type: 'done', response });
    return response;
  }
}
