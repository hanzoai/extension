/**
 * @hanzo/mcp - Model Context Protocol Server
 * 
 * A comprehensive MCP implementation with 20+ built-in tools for:
 * - File operations (read, write, edit, search)
 * - Shell execution (bash, background processes)
 * - Code intelligence (grep, AST-aware search)
 * - Project management (git, directory trees)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Export types
export * from './types/index.js';

// Export tools
export * from './tools/index.js';

// Export prompts
export { getSystemPrompt } from './prompts/system.js';

// Import Tool type for use in the function signature
import { Tool } from './types/index.js';

// Main server factory
export async function createMCPServer(config?: {
  name?: string;
  version?: string;
  projectPath?: string;
  customTools?: Tool[];
}) {
  const { 
    name = 'hanzo-mcp',
    version = '1.0.0',
    projectPath = process.cwd(),
    customTools = []
  } = config || {};
  
  // Import tools and mode utils
  const { allTools, toolMap, modeUtils } = await import('./tools/index.js');
  
  // Combine built-in and custom tools
  const combinedTools = [...allTools, ...customTools];
  const combinedToolMap = new Map(combinedTools.map(t => [t.name, t]));
  
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
  
  // Handle tool listing with mode filtering
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Get available tools based on current mode
    const availableToolNames = modeUtils.getAvailableTools();
    const filteredTools = combinedTools.filter(tool => 
      availableToolNames.includes(tool.name) || 
      // Always include mode/palette management tools
      ['mode_switch', 'mode_list', 'palette_select', 'palette_list'].includes(tool.name)
    );
    
    return {
      tools: filteredTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }))
    };
  });
  
  // Handle tool execution with mode checking
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = combinedToolMap.get(request.params.name);
    
    if (!tool) {
      return {
        content: [{
          type: 'text',
          text: `Unknown tool: ${request.params.name}`
        }],
        isError: true
      };
    }
    
    // Check if tool is available in current mode
    const modeManagementTools = ['mode_switch', 'mode_list', 'palette_select', 'palette_list', 'mode_create', 'shortcut'];
    if (!modeManagementTools.includes(tool.name) && !modeUtils.isToolAvailable(tool.name)) {
      const currentMode = modeUtils.getCurrentMode();
      return {
        content: [{
          type: 'text',
          text: `Tool '${tool.name}' is not available in ${currentMode.name} mode. Switch modes with 'mode_switch' or use 'mode_list' to see available modes.`
        }],
        isError: true
      };
    }
    
    try {
      const result = await tool.handler(request.params.arguments || {});
      return result;
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error executing ${tool.name}: ${error.message}`
        }],
        isError: true
      };
    }
  });
  
  return {
    server,
    tools: combinedTools,
    
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error(`${name} MCP server started with ${combinedTools.length} tools`);
    },
    
    addTool(tool: Tool) {
      combinedTools.push(tool);
      combinedToolMap.set(tool.name, tool);
    },
    
    removeTool(name: string) {
      const index = combinedTools.findIndex(t => t.name === name);
      if (index >= 0) {
        combinedTools.splice(index, 1);
        combinedToolMap.delete(name);
      }
    }
  };
}