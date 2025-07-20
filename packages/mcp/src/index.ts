/**
 * @hanzo/mcp - MCP Server Library
 * Model Context Protocol server implementation for TypeScript
 */

export * from '@modelcontextprotocol/sdk/types.js';
export { Server } from '@modelcontextprotocol/sdk/server/index.js';
export { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface MCPServerConfig {
  name: string;
  version: string;
  tools?: Tool[];
}

export interface MCPTool {
  name: string;
  description: string;
  handler: (args: any) => Promise<any>;
  inputSchema: any;
}

/**
 * Create a new MCP server with custom tools
 */
export function createMCPServer(config: MCPServerConfig) {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const tools: Map<string, MCPTool> = new Map();

  return {
    server,
    
    /**
     * Add a custom tool to the server
     */
    addTool(tool: MCPTool) {
      tools.set(tool.name, tool);
    },

    /**
     * Remove a tool from the server
     */
    removeTool(name: string) {
      tools.delete(name);
    },

    /**
     * Initialize the server with tool handlers
     */
    initialize() {
      // Set up tool list handler
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        const toolList: Tool[] = Array.from(tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));

        return { tools: toolList };
      });

      // Set up tool execution handler
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const tool = tools.get(request.params.name);
        
        if (!tool) {
          throw new Error(`Unknown tool: ${request.params.name}`);
        }

        try {
          const result = await tool.handler(request.params.arguments);
          
          return {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      });
    },

    /**
     * Get the underlying MCP server instance
     */
    getServer() {
      return server;
    },
  };
}

/**
 * Create a file system tool
 */
export function createFileSystemTool(): MCPTool {
  return {
    name: 'read_file',
    description: 'Read the contents of a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
      },
      required: ['path'],
    },
    handler: async (args: { path: string }) => {
      const fs = await import('fs/promises');
      return await fs.readFile(args.path, 'utf-8');
    },
  };
}

/**
 * Create a command execution tool
 */
export function createCommandTool(): MCPTool {
  return {
    name: 'run_command',
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory',
        },
      },
      required: ['command'],
    },
    handler: async (args: { command: string; cwd?: string }) => {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: args.cwd || process.cwd(),
      });
      
      return stdout || stderr;
    },
  };
}