/**
 * Настоящий клиент — тонкая обёртка над Anthropic SDK.
 * Активируется когда ANTHROPIC_API_KEY установлен и LLM_MODE != 'mock'.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  CompletionRequest,
  CompletionResponse,
  ContentBlock,
  LLMClient,
  StreamEvent,
} from './types.js';

function buildParams(req: CompletionRequest): any {
  const params: any = {
    model: req.model,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    tool_choice: req.tool_choice,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
  };
  if (req.thinking) params.thinking = req.thinking;
  return params;
}

export class RealAnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await this.client.messages.create(buildParams(req));

    return {
      content: res.content as ContentBlock[],
      stop_reason: res.stop_reason as CompletionResponse['stop_reason'],
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_creation_input_tokens: (res.usage as any).cache_creation_input_tokens,
        cache_read_input_tokens: (res.usage as any).cache_read_input_tokens,
      },
    };
  }

  async completeStream(
    req: CompletionRequest,
    onEvent: (e: StreamEvent) => void
  ): Promise<CompletionResponse> {
    const stream = this.client.messages.stream(buildParams(req));

    stream.on('text', (delta: string) => {
      onEvent({ type: 'text_delta', delta });
    });

    stream.on('contentBlock', (block: any) => {
      if (block.type === 'tool_use') {
        onEvent({ type: 'tool_use_start', name: block.name });
      }
      if (block.type === 'thinking' && block.thinking) {
        onEvent({ type: 'thinking_delta', delta: block.thinking });
      }
    });

    const finalMsg = await stream.finalMessage();

    const response: CompletionResponse = {
      content: finalMsg.content as ContentBlock[],
      stop_reason: finalMsg.stop_reason as CompletionResponse['stop_reason'],
      usage: {
        input_tokens: finalMsg.usage.input_tokens,
        output_tokens: finalMsg.usage.output_tokens,
        cache_creation_input_tokens: (finalMsg.usage as any).cache_creation_input_tokens,
        cache_read_input_tokens: (finalMsg.usage as any).cache_read_input_tokens,
      },
    };

    onEvent({ type: 'done', response });
    return response;
  }
}
