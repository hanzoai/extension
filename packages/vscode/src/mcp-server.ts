#!/usr/bin/env node

// The stdio MCP server the extension spawns (src/mcp/server.ts), bundled to
// dist/mcp-server.js. It serves MCPTools, the registry the @hanzo chat
// participant also uses, each tool under its own JSON Schema. scripts/build.js
// swaps `vscode` for a stand-in that reads the workspace from HANZO_WORKSPACE
// and the `hanzo` settings from HANZO_CONFIG, both set by the extension.

import * as fs from 'fs';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { MCPTools } from './mcp/tools';

// stdout carries JSON-RPC, so whatever the tools log goes to stderr.
console.log = console.info = console.debug = console.error;

// State the tools keep lives as long as this process.
const state = new Map<string, unknown>();
const context = {
    globalState: {
        get: (key: string, fallback?: unknown) => (state.has(key) ? state.get(key) : fallback),
        update: async (key: string, value: unknown) => { state.set(key, value); },
        keys: () => [...state.keys()],
    },
    extensionPath: path.dirname(__dirname),
    subscriptions: [],
};

async function main() {
    const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const tools = new MCPTools(context as any);
    await tools.initialize();

    const server = new Server({ name: 'hanzo-ide', version }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.getAllTools().map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        const tool = tools.getTool(params.name);
        if (!tool) {
            throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${params.name}`);
        }
        try {
            const result = await tool.handler(params.arguments ?? {});
            return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
        } catch (error) {
            return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
    });

    await server.connect(new StdioServerTransport());
}

// A tool's stray rejection is logged, as the extension host would, rather
// than taking every other tool down with the process.
process.on('uncaughtException', (error) => console.error('[hanzo-mcp] uncaught exception:', error));
process.on('unhandledRejection', (reason) => console.error('[hanzo-mcp] unhandled rejection:', reason));

main().catch((error) => {
    console.error('[hanzo-mcp] failed to start:', error);
    process.exit(1);
});
