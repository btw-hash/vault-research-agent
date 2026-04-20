/**
 * Mock LLM-клиент — имитация поведения Anthropic API для обучения/оффлайн.
 *
 * Определяет «роль» запроса по sigil в system prompt и возвращает реалистичный
 * ответ нужной формы. Также имитирует:
 *   - prompt caching (cache_creation/cache_read tokens)
 *   - extended thinking (thinking блок если включено)
 *   - streaming (completeStream с text_delta событиями)
 *   - stateful judge (первый вызов — низкий score, второй — высокий, чтобы
 *     продемонстрировать evaluator-optimizer loop)
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

// ---------- Имитация кэша ----------

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

// ---------- Определение роли ----------

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
  // Если в user-сообщении есть "PREVIOUS ATTEMPT" — это второй проход синтезатора
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
          `Какие ключевые слова из vault релевантны: "${q.slice(0, 60)}"?`,
          `В каких проектах vault упоминается тема вопроса?`,
          `Есть ли в daily/ или logs/ записи про это?`,
        ],
      },
    } as ToolUseBlock,
  ];
}

function routerResponse(req: CompletionRequest): ContentBlock[] {
  const q = lastUserMessage(req).toLowerCase();
  const tool = req.tools?.find((t) => t.name === 'emit_route');
  if (!tool) return [{ type: 'text', text: 'router fallback' }];

  // Простая эвристика:
  //   - "квантовой", "kubernetes" (test q15) → impossible
  //   - "чем отличается", "как устроено", "архитектура" → deep
  //   - иначе → quick
  let track: 'quick' | 'deep' | 'impossible' = 'quick';
  let reason = 'Factual lookup, search sufficient.';
  if (q.includes('квантов') || q.includes('телепорт')) {
    track = 'impossible';
    reason = 'Topic outside vault scope.';
  } else if (
    q.includes('чем отличается') ||
    q.includes('как устроен') ||
    q.includes('архитектур') ||
    q.includes('сравни')
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

  // Получили tool_result — возвращаем summary
  const prefix = isDeepMode ? '[DEEP]' : '[QUICK]';
  return [
    {
      type: 'text',
      text:
        `${prefix} FINDINGS:\n` +
        `- [logs/Session History.md:249] MCP-сервер antigravity-link добавлен\n` +
        `- [logs/Weekly Log.md:117] Настроен Notion MCP\n` +
        `SUMMARY: Найдено несколько упоминаний темы в vault.`,
    } as TextBlock,
  ];
}

function synthesizerResponse(req: CompletionRequest): ContentBlock[] {
  const tool = req.tools?.find((t) => t.name === 'emit_answer');
  if (!tool) return [{ type: 'text', text: 'synth fallback' }];

  const isRevision = isRevisionSynthesis(req);
  const hasThinking = req.thinking?.type === 'enabled';

  const blocks: ContentBlock[] = [];

  // Extended thinking — возвращаем thinking-блок если включено
  if (hasThinking) {
    blocks.push({
      type: 'thinking',
      thinking:
        '[mock thinking] Analyzing worker findings. Sources from logs/Session History.md ' +
        'and logs/Weekly Log.md converge on Notion MCP setup timeline. ' +
        'Cross-reference confirms the event. Confidence 0.85+ warranted.',
    } as ThinkingBlock);
  }

  blocks.push({
    type: 'tool_use',
    id: 'tu_synth_1',
    name: 'emit_answer',
    input: {
      answer: isRevision
        ? '[MOCK REVISED] Уточнённый ответ после фидбека judge: детально разобраны 3 источника, ' +
          'каждое утверждение подкреплено цитатой. Расширенная confidence после повторной сверки.'
        : '[MOCK] На основе исследования vault: топик упомянут в Session History, Weekly Log ' +
          'и project-заметках. Конкретные источники ниже.',
      sources: [
        {
          file: 'logs/Session History.md',
          line: 249,
          snippet: 'MCP-сервер antigravity-link добавлен...',
        },
        {
          file: 'logs/Weekly Log.md',
          line: 117,
          snippet: 'Настроен Notion MCP...',
        },
        {
          file: 'Home.md',
          line: 27,
          snippet: 'Tools & Integrations — Claude Code, MCP...',
        },
      ],
      confidence: isRevision ? 0.92 : 0.75,
    },
  } as ToolUseBlock);

  return blocks;
}

// Stateful judge — для демонстрации evaluator-optimizer loop
let judgeCallCount = 0;
function judgeResponse(req: CompletionRequest): ContentBlock[] {
  const tool = req.tools?.find((t) => t.name === 'emit_score');
  if (!tool) return [{ type: 'text', text: 'judge fallback' }];

  judgeCallCount++;
  // Если синтез был первой попытки (confidence=0.75 в ответе) — низкий score
  // Если ревизия (confidence=0.92) — высокий score
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
  // Narrator — просто переоформляет JSON-ответ в прозу, без tools
  const userContent = lastUserMessage(req);
  // Достаём из json "answer" если есть
  let prose =
    '[MOCK narrator] На основе исследования vault: ваш вопрос связан с несколькими упоминаниями ' +
    'в логах и проектных заметках. Самые релевантные источники указаны ниже. ' +
    'Если нужно детальнее — уточните конкретный аспект.';
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

    // Эмитим события по мере «генерации»
    for (const block of response.content) {
      if (block.type === 'text') {
        // Стримим чанками по 20 символов
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
