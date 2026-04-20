/**
 * MCP-клиент к obsidian-vault-mcp.
 *
 * Запускает node c:/AI/mcp-obsidian/dist/index.js как дочерний процесс,
 * общается через stdio по JSON-RPC. Предоставляет:
 *   - listTools() — список tools
 *   - callTool(name, args) — вызвать
 *
 * Также даёт method toAnthropicTools() — конвертирует MCP tools в формат
 * Anthropic SDK с префиксом vault_* (чтобы не конфликтовало с другими tool).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDef } from '../llm/types.js';

export interface VaultTool {
  name: string; // оригинальное имя: read_note, search_notes...
  description: string;
  inputSchema: ToolDef['input_schema'];
}

export class VaultMCPClient {
  private client: Client;
  private transport: StdioClientTransport;
  private tools: VaultTool[] = [];

  constructor(private serverPath: string) {
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: { ...process.env, VAULT_ROOT: process.env.VAULT_ROOT ?? 'c:/AI/vault' },
    });
    this.client = new Client(
      { name: 'vault-research-agent', version: '0.1.0' },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
    const res = await this.client.listTools();
    this.tools = res.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as ToolDef['input_schema'],
    }));
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  getTools(): VaultTool[] {
    return this.tools;
  }

  /**
   * Конвертация в формат Anthropic с префиксом vault_.
   * Префикс нужен чтобы worker мог различать свои tools от других.
   */
  toAnthropicTools(): ToolDef[] {
    return this.tools.map((t) => ({
      name: `vault_${t.name}`,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /**
   * Вызов tool. Имя может быть с префиксом vault_ или без.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const realName = name.startsWith('vault_') ? name.slice('vault_'.length) : name;
    const res = await this.client.callTool({
      name: realName,
      arguments: args,
    });
    const content = (res.content as Array<{ type: string; text?: string }>) ?? [];
    return content.map((c) => c.text ?? '').join('\n');
  }
}
