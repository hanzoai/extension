import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createMCPServer } from '../src/index.js';
import { Tool } from '../src/types/index.js';

// Ensure tools are registered before tests
beforeAll(async () => {
  await import('../src/tools/index.js');
});

describe('MCP Server', () => {
  describe('createMCPServer', () => {
    it('should create server with default configuration', async () => {
      const server = await createMCPServer();
      
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
      expect(server.tools).toBeDefined();
      expect(Array.isArray(server.tools)).toBe(true);
      expect(server.tools.length).toBeGreaterThan(0);
    });

    it('should create server with custom configuration', async () => {
      const customTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          }
        },
        handler: async (args) => ({
          content: [{
            type: 'text',
            text: `Test: ${args.input}`
          }]
        })
      };

      const server = await createMCPServer({
        name: 'test-mcp',
        version: '2.0.0',
        customTools: [customTool]
      });

      expect(server).toBeDefined();
      expect(server.tools.some(t => t.name === 'test_tool')).toBe(true);
    });

    it('should have addTool method', async () => {
      const server = await createMCPServer();
      const initialCount = server.tools.length;

      const newTool: Tool = {
        name: 'dynamic_tool',
        description: 'Dynamically added tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'Dynamic' }] })
      };

      server.addTool(newTool);
      expect(server.tools.length).toBe(initialCount + 1);
      expect(server.tools.some(t => t.name === 'dynamic_tool')).toBe(true);
    });

    it('should have removeTool method', async () => {
      const server = await createMCPServer();
      
      // Add a tool first
      const testTool: Tool = {
        name: 'removable_tool',
        description: 'Tool to be removed',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ content: [{ type: 'text', text: 'Remove me' }] })
      };
      
      server.addTool(testTool);
      const countAfterAdd = server.tools.length;
      
      server.removeTool('removable_tool');
      expect(server.tools.length).toBe(countAfterAdd - 1);
      expect(server.tools.some(t => t.name === 'removable_tool')).toBe(false);
    });

    it('should have start method', async () => {
      const server = await createMCPServer();
      
      // Mock console.error to check if start message is logged
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Note: We can't actually test the full start without mocking StdioServerTransport
      expect(typeof server.start).toBe('function');
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Tool Categories', () => {
    it('should include file operation tools', async () => {
      const server = await createMCPServer();
      const fileTools = ['read_file', 'write_file', 'edit_file', 'multi_edit', 'create_file', 'delete_file', 'move_file', 'list_files', 'directory_tree'];
      
      fileTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should include search tools', async () => {
      const server = await createMCPServer();
      const searchTools = ['grep', 'find_files', 'search', 'ast_search', 'find_symbol', 'analyze_dependencies'];
      
      searchTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should include shell tools', async () => {
      const server = await createMCPServer();
      const shellTools = ['bash', 'run_command', 'run_background', 'kill_process', 'list_processes'];
      
      shellTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should include AI tools', async () => {
      const server = await createMCPServer();
      const aiTools = ['think', 'critic', 'consensus', 'agent'];
      
      aiTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should include todo tools', async () => {
      const server = await createMCPServer();
      const todoTools = ['todo_add', 'todo_list', 'todo_update', 'todo_delete', 'todo_stats'];
      
      todoTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });

    it('should include mode/preset tools', async () => {
      const server = await createMCPServer();
      const modeTools = ['mode_switch', 'mode_list', 'preset_select', 'preset_list', 'mode_create', 'shortcut'];
      
      modeTools.forEach(toolName => {
        expect(server.tools.some(t => t.name === toolName)).toBe(true);
      });
    });
  });

  describe('Exports', () => {
    it('should export getSystemPrompt', async () => {
      const { getSystemPrompt } = await import('../src/index.js');
      expect(typeof getSystemPrompt).toBe('function');
    });

    it('should export all tool categories', async () => {
      const exports = await import('../src/index.js');
      
      expect(exports.fileTools).toBeDefined();
      expect(exports.searchTools).toBeDefined();
      expect(exports.shellTools).toBeDefined();
      expect(exports.editTools).toBeDefined();
      expect(exports.vectorTools).toBeDefined();
      expect(exports.aiTools).toBeDefined();
      expect(exports.astTools).toBeDefined();
      expect(exports.todoTools).toBeDefined();
      expect(exports.modePresetTools).toBeDefined();
      expect(exports.modeUtils).toBeDefined();
    });
  });
});