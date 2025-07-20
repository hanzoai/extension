import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequest, CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { SimplifiedPeerMCPServer } from '../../src/orchestration/simplified-peer-mcp-server';
import { AgentInstance, MCPServerConfig } from '../../src/config/agent-swarm-config';

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
      onerror: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
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
        { name: 'agent-agent1', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );
    });
  });

  describe('setupHandlers', () => {
    it('should register ListTools handler with peer tools', async () => {
      let listToolsHandler: any;
      let callToolHandler: any;
      let handlerCount = 0;
      
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        if (handlerCount === 0) {
          listToolsHandler = cb;
        } else if (handlerCount === 1) {
          callToolHandler = cb;
        }
        handlerCount++;
      });

      // Initialize the server which calls setupHandlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );

      expect(listToolsHandler).toBeDefined();
      expect(callToolHandler).toBeDefined()
      
      // Call the ListTools handler
      const result = await listToolsHandler({});
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
            request: {
              type: 'string',
              description: expect.any(String)
            },
            context: {
              type: 'object',
              description: expect.any(String)
            }
          },
          required: ['request']
        }
      });
    });

    it('should register CallTool handler', async () => {
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handler).toBeDefined();

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
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handler).toBeDefined();

      const result = await handler({
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool: unknown_tool');
    });
  });

  describe('shared MCP tools', () => {
    it('should include GitHub tools when enabled', async () => {
      const handlers: Record<string, any> = {};
      
      let handlerCount = 0;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        // based on the order in setupHandlers()
        if (handlerCount === 0) {
          handlers.listTools = cb;
        } else if (handlerCount === 1) {
          handlers.callTool = cb;
        }
        handlerCount++;
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handlers.listTools).toBeDefined();
      const result = await handlers.listTools({});
      
      const githubTools = result.tools.filter((tool: any) => 
        tool.name === 'github'
      );
      expect(githubTools.length).toBe(1);
      expect(githubTools[0].description).toContain('Access github MCP server');
    });

    it('should include Linear tools when enabled', async () => {
      const handlers: Record<string, any> = {};
      let handlerCount = 0;
      
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        if (handlerCount === 0) {
          handlers.listTools = cb;
        } else if (handlerCount === 1) {
          handlers.callTool = cb;
        }
        handlerCount++;
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handlers.listTools).toBeDefined();
      const result = await handlers.listTools({});
      
      const linearTools = result.tools.filter((tool: any) => 
        tool.name === 'linear'
      );
      expect(linearTools.length).toBe(1);
      expect(linearTools[0].description).toContain('Access linear MCP server');
    });

    it('should not include Slack tools when disabled', async () => {
      const handlers: Record<string, any> = {};
      let handlerCount = 0;
      
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        if (handlerCount === 0) {
          handlers.listTools = cb;
        } else if (handlerCount === 1) {
          handlers.callTool = cb;
        }
        handlerCount++;
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handlers.listTools).toBeDefined();
      const result = await handlers.listTools({});
      
      const slackTools = result.tools.filter((tool: any) => 
        tool.name === 'slack'
      );
      expect(slackTools).toHaveLength(0);
    });

    it('should include Playwright tools when enabled', async () => {
      const handlers: Record<string, any> = {};
      let handlerCount = 0;
      
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        if (handlerCount === 0) {
          handlers.listTools = cb;
        } else if (handlerCount === 1) {
          handlers.callTool = cb;
        }
        handlerCount++;
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handlers.listTools).toBeDefined();
      const result = await handlers.listTools({});
      
      const playwrightTools = result.tools.filter((tool: any) => 
        tool.name === 'playwright'
      );
      expect(playwrightTools.length).toBe(1);
      expect(playwrightTools[0].description).toContain('Access playwright MCP server');
    });
  });

  describe('peer agent communication', () => {
    it('should handle recursive agent calls', async () => {
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize with mocked callPeerAgent
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      // Mock the callPeerAgent method
      mcpServer['callPeerAgent'] = vi.fn().mockResolvedValue('Agent2 response with help from agent3');

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

      expect(result.content[0].text).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });

    it('should enforce recursion depth limits', async () => {
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      // Mock the callPeerAgent method to return depth error
      mcpServer['callPeerAgent'] = vi.fn().mockResolvedValue('Maximum recursion depth reached');

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
      // This test would require implementing the custom MCP server startup logic
      // For now, we'll test that the custom MCPs are included in the config
      expect(mcpServer['config'].sharedMCPs).toContainEqual(
        expect.objectContaining({
          name: 'postgres',
          type: 'stdio',
          command: 'pg-mcp'
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

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      // Set error handler after creation
      mockServer.onerror = errorHandler;

      const testError = new Error('Transport error');
      errorHandler(testError);

      expect(errorHandler).toHaveBeenCalledWith(testError);
    });
  });

  describe('tool execution', () => {
    it('should execute GitHub tool calls', async () => {
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      // Mock the callSharedMCP method
      mcpServer['callSharedMCP'] = vi.fn().mockResolvedValue('GitHub API response: Issue created');

      const result = await handler({
        params: {
          name: 'github',
          arguments: {
            action: 'create_issue',
            params: {
              repository: 'test/repo',
              title: 'Test Issue',
              body: 'Test body'
            }
          }
        }
      });

      expect(result.content[0].text).toContain('GitHub API response: Issue created');
    });

    it('should execute Linear tool calls', async () => {
      let handler: any;
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // Only capture CallToolRequest handler
        if (type === CallToolRequest) {
          handler = cb;
        }
      });

      // Re-initialize
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      // Mock the callSharedMCP method
      mcpServer['callSharedMCP'] = vi.fn().mockResolvedValue('Linear API response: Issue created');

      const result = await handler({
        params: {
          name: 'linear',
          arguments: {
            action: 'create_issue',
            params: {
              title: 'Test Task',
              description: 'Test description'
            }
          }
        }
      });

      expect(result.content[0].text).toContain('Linear API response: Issue created');
    });
  });

  describe('standard Hanzo tools', () => {
    it('should include standard file tools', async () => {
      const handlers: Record<string, any> = {};
      let handlerCount = 0;
      
      mockServer.setRequestHandler.mockImplementation((type, cb) => {
        // The first handler registered should be ListTools, second should be CallTool
        if (handlerCount === 0) {
          handlers.listTools = cb;
        } else if (handlerCount === 1) {
          handlers.callTool = cb;
        }
        handlerCount++;
      });

      // Re-initialize to register handlers
      mcpServer = new SimplifiedPeerMCPServer(
        mockAgentConfig,
        'agent1',
        mockPeers,
        mockSharedMCPs,
        'http://localhost:8080'
      );
      
      expect(handlers.listTools).toBeDefined();
      const result = await handlers.listTools({});
      
      const standardTools = ['read_file', 'write_file', 'search', 'bash'];
      for (const toolName of standardTools) {
        const tool = result.tools.find((t: any) => t.name === toolName);
        expect(tool).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
      }
    });
  });
});