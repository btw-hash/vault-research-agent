/**
 * MCP client for the obsidian-vault-mcp server.
 *
 * Spawns the given server script (node <path>) as a child process,
 * communicates over stdio via JSON-RPC. Provides:
 *   - listTools() — list of tools
 *   - callTool(name, args) — invoke one
 *
 * Also exposes toAnthropicTools() — converts MCP tools into the Anthropic SDK
 * format with a vault_* prefix (so they don't collide with other tools).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDef } from '../llm/types.js';

export interface VaultTool {
  name: string; // original name: read_note, search_notes...
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
      // VAULT_ROOT is left unset here so the server falls back to its own
      // default (the bundled demo-vault) unless the caller overrides it.
      env: Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
      ),
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
   * Convert to Anthropic format with a vault_ prefix.
   * The prefix lets a worker distinguish these tools from others.
   */
  toAnthropicTools(): ToolDef[] {
    return this.tools.map((t) => ({
      name: `vault_${t.name}`,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /**
   * Call a tool. Name may or may not carry the vault_ prefix.
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
