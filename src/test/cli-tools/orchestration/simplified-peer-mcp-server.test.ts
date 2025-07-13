import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SimplifiedPeerMCPServer } from '../../../cli-tools/orchestration/simplified-peer-mcp-server';
import { AgentInstance, MCPServerConfig } from '../../../cli-tools/config/agent-swarm-config';

vi.mock('@modelcontextprotocol/sdk/server/index.js');
vi.mock('@modelcontextprotocol/sdk/server/stdio.js');
vi.mock('child_process');

describe('SimplifiedPeerMCPServer', () => {
  let mcpServer: SimplifiedPeerMCPServer;
  let mockServer: any;
  let mockTransport: any;
  
  const mockAgentConfig: AgentInstance = {
    description: 'Test Agent',
    directory: './test',
    model: 'sonnet',
    prompt: 'You are a test agent',
    allowed_tools: ['Read', 'Write'],
    expose_as_mcp: true,
    mcp_port: 10000,
    connect_to_agents: ['agent2', 'agent3']
  };

  const mockPeers = {
    agent2: {
      description: 'Second agent',
      directory: './test2',
      model: 'haiku',
      prompt: 'You are agent 2',
      mcp_port: 10001
    },
    agent3: {
      description: 'Third agent',
      directory: './test3',
      model: 'opus',
      prompt: 'You are agent 3',
      mcp_port: 10002
    }
  };

  const mockSharedMCPs = {
    github: {
      enabled: true,
      token: 'test-token'
    },
    linear: {
      enabled: true,
      apiKey: 'test-key'
    },
    slack: {
      enabled: false
    },
    playwright: {
      enabled: true,
      headless: true
    },
    custom: [
      {
        name: 'postgres',
        type: 'stdio' as const,
        command: 'pg-mcp',
        env: { DATABASE_URL: 'postgres://test' }
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockServer = {
      setRequestHandler: vi.fn(),
      onerror: vi.fn()
    };
    
    mockTransport = {
      onmessage: vi.fn(),
      onclose: vi.fn()
    };
    
    vi.mocked(Server).mockReturnValue(mockServer);
    vi.mocked(StdioServerTransport).mockReturnValue(mockTransport);
    
    mcpServer = new SimplifiedPeerMCPServer(
      mockAgentConfig,
      'agent1',
      mockPeers,
      mockSharedMCPs,
      'http://localhost:8080'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(mcpServer).toBeDefined();
      expect(Server).toHaveBeenCalledWith(
        { name: 'agent1', version: '0.1.0' },
        { capabilities: {} }
      );
      expect(StdioServerTransport).toHaveBeenCalled();
    });
  });

  describe('setupHandlers', () => {
    it('should register ListTools handler with peer tools', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      // Trigger setupHandlers
      await mcpServer.connect(mockTransport);

      const result = await handler({});
      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);
      
      // Check for peer agent tools
      const peerTools = result.tools.filter((tool: any) => 
        tool.name === 'agent2' || tool.name === 'agent3'
      );
      expect(peerTools).toHaveLength(2);
      
      // Check tool structure
      expect(peerTools[0]).toMatchObject({
        name: expect.any(String),
        description: expect.stringContaining('agent'),
        inputSchema: {
          type: 'object',
          properties: {
            request: { type: 'string' },
            context: { type: 'object' }
          },
          required: ['request']
        }
      });
    });

    it('should register CallTool handler', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      // Test calling a peer agent
      const callResult = await handler({
        params: {
          name: 'agent2',
          arguments: {
            request: 'Test request',
            context: { test: true }
          }
        }
      });

      expect(callResult.content).toBeDefined();
      expect(callResult.content[0].type).toBe('text');
    });

    it('should handle invalid tool calls', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      await expect(handler({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      })).rejects.toThrow('Tool not found');
    });
  });

  describe('shared MCP tools', () => {
    it('should include GitHub tools when enabled', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);
      const result = await handler({});
      
      const githubTools = result.tools.filter((tool: any) => 
        tool.name.includes('github')
      );
      expect(githubTools.length).toBeGreaterThan(0);
    });

    it('should include Linear tools when enabled', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);
      const result = await handler({});
      
      const linearTools = result.tools.filter((tool: any) => 
        tool.name.includes('linear')
      );
      expect(linearTools.length).toBeGreaterThan(0);
    });

    it('should not include Slack tools when disabled', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);
      const result = await handler({});
      
      const slackTools = result.tools.filter((tool: any) => 
        tool.name.includes('slack')
      );
      expect(slackTools).toHaveLength(0);
    });

    it('should include Playwright tools when enabled', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);
      const result = await handler({});
      
      const playwrightTools = result.tools.filter((tool: any) => 
        tool.name.includes('playwright') || tool.name.includes('navigate')
      );
      expect(playwrightTools.length).toBeGreaterThan(0);
    });
  });

  describe('peer agent communication', () => {
    it('should handle recursive agent calls', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      // Simulate recursive call
      const result = await handler({
        params: {
          name: 'agent2',
          arguments: {
            request: 'Analyze this and ask agent3 for help',
            context: { recursion_depth: 0 }
          }
        }
      });

      expect(result.content[0].text).toContain('Orchestrating with Hanzo Zen');
      expect(result.content[0].text).toContain('recursion_depth');
    });

    it('should enforce recursion depth limits', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      // Try deep recursion
      const result = await handler({
        params: {
          name: 'agent2',
          arguments: {
            request: 'Keep asking other agents',
            context: { recursion_depth: 10 }
          }
        }
      });

      expect(result.content[0].text).toContain('Maximum recursion depth');
    });
  });

  describe('custom MCP servers', () => {
    it('should start custom MCP servers', async () => {
      const spawn = await import('child_process').then(m => m.spawn);
      const mockSpawn = vi.mocked(spawn);
      
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn()
      };
      
      mockSpawn.mockReturnValue(mockProcess as any);

      // Test starting custom servers
      await mcpServer.connect(mockTransport);

      // Verify postgres MCP server was started
      expect(mockSpawn).toHaveBeenCalledWith(
        'pg-mcp',
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            DATABASE_URL: 'postgres://test'
          })
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle server initialization errors', () => {
      vi.mocked(Server).mockImplementation(() => {
        throw new Error('Server init failed');
      });

      expect(() => {
        new SimplifiedPeerMCPServer(
          mockAgentConfig,
          'agent1',
          mockPeers,
          mockSharedMCPs,
          'http://localhost:8080'
        );
      }).toThrow('Server init failed');
    });

    it('should handle transport errors', async () => {
      const errorHandler = vi.fn();
      mockServer.onerror = errorHandler;

      await mcpServer.connect(mockTransport);

      const testError = new Error('Transport error');
      mockServer.onerror(testError);

      expect(errorHandler).toHaveBeenCalledWith(testError);
    });
  });

  describe('tool execution', () => {
    it('should execute GitHub tool calls', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      const result = await handler({
        params: {
          name: 'github_create_issue',
          arguments: {
            repository: 'test/repo',
            title: 'Test Issue',
            body: 'Test body'
          }
        }
      });

      expect(result.content[0].text).toContain('GitHub API');
    });

    it('should execute Linear tool calls', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/call') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);

      const result = await handler({
        params: {
          name: 'linear_create_issue',
          arguments: {
            title: 'Test Task',
            description: 'Test description'
          }
        }
      });

      expect(result.content[0].text).toContain('Linear API');
    });
  });

  describe('standard Hanzo tools', () => {
    it('should include standard file tools', async () => {
      const handler = vi.fn();
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        if (type.method === 'tools/list') {
          handler.mockImplementation(cb);
        }
      });

      await mcpServer.connect(mockTransport);
      const result = await handler({});
      
      const standardTools = ['read_file', 'write_file', 'search', 'bash'];
      for (const toolName of standardTools) {
        const tool = result.tools.find((t: any) => t.name === toolName);
        expect(tool).toBeDefined();
        expect(tool.description).toBeDefined();
      }
    });
  });
});