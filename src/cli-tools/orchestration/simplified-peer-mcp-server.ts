import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  Tool,
  TextContent
} from '@modelcontextprotocol/sdk/types.js';
import { AgentInstance } from '../config/agent-swarm-config';
import { CLIToolManager } from '../cli-tool-manager';
import fetch from 'node-fetch';

interface SimplifiedPeerConfig {
  agentName: string;
  instance: AgentInstance;
  port: number;
  peers: string[];
  sharedMCPs: MCPConfig[];
}

interface MCPConfig {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class SimplifiedPeerMCPServer {
  private server: Server;
  private config: SimplifiedPeerConfig;
  private toolManager: CLIToolManager;
  private callDepth: number = 0;
  private maxDepth: number = 10;

  constructor(config: SimplifiedPeerConfig) {
    this.config = config;
    this.toolManager = new CLIToolManager();
    
    this.server = new Server(
      {
        name: `agent-${config.agentName}`,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequest, async () => {
      const tools: Tool[] = [];
      
      // One tool per peer agent
      for (const peerName of this.config.peers) {
        if (peerName !== this.config.agentName) {
          tools.push({
            name: peerName,
            description: `Call the ${peerName} agent with any request. They can recursively query other agents.`,
            inputSchema: {
              type: 'object',
              properties: {
                request: {
                  type: 'string',
                  description: 'Your request to this agent',
                },
                context: {
                  type: 'object',
                  description: 'Optional context for the request',
                },
              },
              required: ['request'],
            },
          });
        }
      }

      // Add shared MCP tools (GitHub, Linear, Slack, etc.)
      for (const mcp of this.config.sharedMCPs) {
        tools.push({
          name: mcp.name,
          description: `Access ${mcp.name} MCP server`,
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                description: `Action to perform with ${mcp.name}`,
              },
              params: {
                type: 'object',
                description: 'Parameters for the action',
              },
            },
            required: ['action'],
          },
        });
      }

      // Add Hanzo MCP tools
      tools.push(
        {
          name: 'read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to read' },
            },
            required: ['path'],
          },
        },
        {
          name: 'write_file',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path to write' },
              content: { type: 'string', description: 'Content to write' },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search',
          description: 'Search for patterns in files',
          inputSchema: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Search pattern' },
              path: { type: 'string', description: 'Path to search in' },
            },
            required: ['pattern'],
          },
        },
        {
          name: 'bash',
          description: 'Execute a bash command',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute' },
            },
            required: ['command'],
          },
        }
      );

      return { tools } as ListToolsResult;
    });

    this.server.setRequestHandler(CallToolRequest, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        // Check if it's a peer agent call
        if (this.config.peers.includes(name) && name !== this.config.agentName) {
          result = await this.callPeerAgent(name, args.request, args.context);
        }
        // Check if it's a shared MCP tool
        else if (this.config.sharedMCPs.some(mcp => mcp.name === name)) {
          result = await this.callSharedMCP(name, args.action, args.params);
        }
        // Handle Hanzo MCP tools
        else {
          result = await this.handleHanzoTool(name, args);
        }

        return {
          content: [
            {
              type: 'text',
              text: result,
            } as TextContent,
          ],
        } as CallToolResult;
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            } as TextContent,
          ],
          isError: true,
        } as CallToolResult;
      }
    });
  }

  private async callPeerAgent(peerName: string, request: string, context?: any): Promise<string> {
    // Check recursion depth
    if (this.callDepth >= this.maxDepth) {
      return `[Max recursion depth reached]`;
    }

    this.callDepth++;
    
    try {
      // Build the prompt for the peer agent
      const prompt = `
Request from ${this.config.agentName}: ${request}
${context ? `\nContext: ${JSON.stringify(context, null, 2)}` : ''}

You are ${peerName}. Process this request according to your expertise.
You have access to all other agents and can call them recursively if needed.
Available agents: ${this.config.peers.filter(p => p !== peerName).join(', ')}
      `;

      // In production, this would make an actual MCP call to the peer
      // For now, simulate the response
      const response = await this.simulatePeerResponse(peerName, prompt);
      
      this.callDepth--;
      return response;
    } catch (error) {
      this.callDepth--;
      throw error;
    }
  }

  private async callSharedMCP(mcpName: string, action: string, params?: any): Promise<string> {
    const mcp = this.config.sharedMCPs.find(m => m.name === mcpName);
    if (!mcp) {
      throw new Error(`MCP ${mcpName} not found`);
    }

    // Handle different MCP servers
    switch (mcpName) {
      case 'github':
        return await this.handleGitHubMCP(action, params);
      case 'linear':
        return await this.handleLinearMCP(action, params);
      case 'slack':
        return await this.handleSlackMCP(action, params);
      case 'playwright':
        return await this.handlePlaywrightMCP(action, params);
      default:
        return `[${mcpName}] ${action} with params: ${JSON.stringify(params)}`;
    }
  }

  private async handleGitHubMCP(action: string, params: any): Promise<string> {
    // GitHub MCP actions
    switch (action) {
      case 'create_issue':
        return `Created GitHub issue: ${params.title}`;
      case 'create_pr':
        return `Created pull request: ${params.title}`;
      case 'list_issues':
        return `Found ${params.count || 10} issues`;
      case 'review_pr':
        return `Reviewed PR #${params.pr_number}`;
      default:
        return `GitHub action: ${action}`;
    }
  }

  private async handleLinearMCP(action: string, params: any): Promise<string> {
    // Linear MCP actions
    switch (action) {
      case 'create_issue':
        return `Created Linear issue: ${params.title}`;
      case 'update_issue':
        return `Updated Linear issue: ${params.id}`;
      case 'list_issues':
        return `Found Linear issues for ${params.project}`;
      default:
        return `Linear action: ${action}`;
    }
  }

  private async handleSlackMCP(action: string, params: any): Promise<string> {
    // Slack MCP actions
    switch (action) {
      case 'send_message':
        return `Sent Slack message to ${params.channel}`;
      case 'create_channel':
        return `Created Slack channel: ${params.name}`;
      case 'list_channels':
        return `Listed Slack channels`;
      default:
        return `Slack action: ${action}`;
    }
  }

  private async handlePlaywrightMCP(action: string, params: any): Promise<string> {
    // Playwright MCP actions
    switch (action) {
      case 'navigate':
        return `Navigated to ${params.url}`;
      case 'click':
        return `Clicked element: ${params.selector}`;
      case 'screenshot':
        return `Captured screenshot: ${params.name}`;
      case 'fill':
        return `Filled ${params.selector} with value`;
      default:
        return `Playwright action: ${action}`;
    }
  }

  private async handleHanzoTool(tool: string, args: any): Promise<string> {
    switch (tool) {
      case 'read_file':
        return `[File content of ${args.path}]`;
      case 'write_file':
        return `Wrote to ${args.path}`;
      case 'search':
        return `Found matches for "${args.pattern}" in ${args.path || '.'}`;
      case 'bash':
        return `Executed: ${args.command}`;
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async simulatePeerResponse(peerName: string, prompt: string): Promise<string> {
    // In production, this would call the actual peer agent
    // For now, return a simulated response
    return `[${peerName}] Processed request: ${prompt.substring(0, 100)}...`;
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Agent ${this.config.agentName} MCP server started on port ${this.config.port}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

// CLI entry point
if (require.main === module) {
  const config = JSON.parse(process.argv[2]) as SimplifiedPeerConfig;
  const server = new SimplifiedPeerMCPServer(config);

  server.start().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}