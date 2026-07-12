/**
 * Shared types for the LLM layer.
 * Shaped to match the Anthropic SDK so the mock client is a drop-in replacement.
 */

export type Model = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-7';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** If set, the block is tagged with cache_control when sent */
  cache_control?: { type: 'ephemeral' };
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface CompletionRequest {
  model: Model;
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Message[];
  tools?: ToolDef[];
  tool_choice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
  max_tokens: number;
  temperature?: number;
  /** Extended thinking — the model "thinks" in separate thinking blocks. */
  thinking?: { type: 'enabled'; budget_tokens: number };
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; name: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'done'; response: CompletionResponse };

export interface CompletionResponse {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface LLMClient {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  completeStream?(
    req: CompletionRequest,
    onEvent: (event: StreamEvent) => void
  ): Promise<CompletionResponse>;
}
