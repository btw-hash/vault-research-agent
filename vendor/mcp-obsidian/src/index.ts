#!/usr/bin/env node
/**
 * Obsidian Vault MCP Server
 *
 * Exposes a folder of markdown files (an Obsidian vault) as an MCP endpoint.
 * Transport — stdio (spawned by the client as a child process).
 *
 * Vendored into vault-research-agent from the standalone mcp-obsidian project
 * so the repo runs out of the box from a clean clone. See ../../../README.md.
 *
 * Primitives:
 *   - tools: read_note, search_notes, append_to_daily, list_projects
 *   - resources: list of markdown files in the vault
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- Config ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default vault root: the bundled demo-vault at the repo root (dist -> mcp-obsidian -> vendor -> repo root).
const DEFAULT_VAULT_ROOT = path.resolve(__dirname, '..', '..', '..', 'demo-vault');
const VAULT_ROOT = process.env.VAULT_ROOT ?? DEFAULT_VAULT_ROOT;

// ---------- Utilities ----------

/**
 * Path traversal guard.
 * Any path coming from the model is normalized and checked to stay inside VAULT_ROOT.
 * Without this, the model (or an attacker via prompt injection) could read C:\Windows\...
 */
function safePath(relative: string): string {
  const abs = path.resolve(VAULT_ROOT, relative);
  const rootAbs = path.resolve(VAULT_ROOT);
  if (!abs.startsWith(rootAbs)) {
    throw new Error(`Path escapes vault root: ${relative}`);
  }
  return abs;
}

async function walkMarkdown(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkMarkdown(full, acc);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- Server ----------

const server = new Server(
  { name: 'obsidian-vault-mcp', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } }
);

// === Handler 1: list tools ===
// The client calls this on startup to learn what the server can do.
// Descriptions are the main thing the model reads — write them like instructions to a colleague.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_note',
      description:
        'Read a markdown note from the Obsidian vault by its relative path. ' +
        'Use for fetching specific project docs, daily notes, or reference files. ' +
        "Example path: 'projects/Aurora Notebook.md' or 'daily/2026-06-08.md'.",
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: "Relative path from vault root, e.g. 'projects/Beacon CLI.md'",
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_notes',
      description:
        'Full-text search across all markdown files in the vault. ' +
        'Returns up to 20 matches with file path and matching line. ' +
        'Use for finding notes when exact path is unknown.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Substring to search for (case-insensitive)',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 20)',
            default: 20,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'append_to_daily',
      description:
        "Append a line of text to today's daily note (daily/YYYY-MM-DD.md). " +
        'Creates the file if missing. Use for logging session events, decisions, or notes. ' +
        'Text is appended on a new line with a timestamp prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to append. One line or multi-line markdown.',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'list_projects',
      description:
        'List all project notes in vault/projects/ with their filenames. ' +
        'Use to discover available projects before reading specific ones.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

// === Handler 2: call tool ===
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'read_note': {
        const relPath = String(args?.path ?? '');
        if (!relPath) throw new Error('path is required');
        const abs = safePath(relPath);
        const content = await fs.readFile(abs, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      }

      case 'search_notes': {
        const query = String(args?.query ?? '').toLowerCase();
        const limit = Number(args?.limit ?? 20);
        if (!query) throw new Error('query is required');

        const files = await walkMarkdown(VAULT_ROOT);
        const matches: string[] = [];

        for (const file of files) {
          if (matches.length >= limit) break;
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              const rel = path.relative(VAULT_ROOT, file).replace(/\\/g, '/');
              matches.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              if (matches.length >= limit) break;
            }
          }
        }

        const text =
          matches.length > 0
            ? matches.join('\n')
            : `No matches for "${query}" in ${files.length} files.`;
        return { content: [{ type: 'text', text }] };
      }

      case 'append_to_daily': {
        const text = String(args?.text ?? '');
        if (!text) throw new Error('text is required');

        const dailyDir = safePath('daily');
        await fs.mkdir(dailyDir, { recursive: true });
        const file = path.join(dailyDir, `${today()}.md`);

        const timestamp = new Date().toTimeString().slice(0, 5); // HH:MM
        const line = `\n- ${timestamp} ${text}\n`;

        await fs.appendFile(file, line, 'utf-8');
        return {
          content: [{ type: 'text', text: `Appended to ${path.basename(file)}` }],
        };
      }

      case 'list_projects': {
        const projectsDir = safePath('projects');
        const entries = await fs.readdir(projectsDir);
        const projects = entries.filter((e) => e.endsWith('.md'));
        return {
          content: [{ type: 'text', text: projects.map((p) => `- ${p}`).join('\n') }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    // IMPORTANT: errors are written as text content with isError=true, not thrown.
    // The model reads the message and can adapt (retry, fix args).
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// === Handler 3: list resources ===
// Resources are read-only context. The client shows them to the user, who attaches them to context.
// Difference from tools: tools are called by the model, resources are chosen by the user.
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const files = await walkMarkdown(VAULT_ROOT);
  return {
    resources: files.slice(0, 100).map((f) => {
      const rel = path.relative(VAULT_ROOT, f).replace(/\\/g, '/');
      return {
        uri: `vault://${rel}`,
        name: rel,
        mimeType: 'text/markdown',
      };
    }),
  };
});

// === Handler 4: read resource ===
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  const rel = uri.replace(/^vault:\/\//, '');
  const abs = safePath(rel);
  const content = await fs.readFile(abs, 'utf-8');
  return {
    contents: [{ uri, mimeType: 'text/markdown', text: content }],
  };
});

// ---------- Startup ----------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // IMPORTANT: never write to stdout — that's the JSON-RPC channel. Logs go to stderr only.
  console.error('obsidian-vault-mcp started, vault:', VAULT_ROOT);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
