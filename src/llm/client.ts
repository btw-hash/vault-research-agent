import { MockAnthropicClient } from './anthropic-mock.js';
import { RealAnthropicClient } from './anthropic-real.js';
import type { LLMClient } from './types.js';

/**
 * Выбор клиента:
 *   - LLM_MODE=mock → всегда mock
 *   - LLM_MODE=real или задан ANTHROPIC_API_KEY → real
 *   - иначе mock (fallback для обучения)
 */
export function createLLMClient(): LLMClient {
  const mode = process.env.LLM_MODE;
  const key = process.env.ANTHROPIC_API_KEY;

  if (mode === 'mock') {
    console.error('[llm] mode=mock (forced)');
    return new MockAnthropicClient();
  }
  if (mode === 'real' || key) {
    if (!key) throw new Error('ANTHROPIC_API_KEY required for real mode');
    console.error('[llm] mode=real');
    return new RealAnthropicClient(key);
  }
  console.error('[llm] mode=mock (no API key)');
  return new MockAnthropicClient();
}
