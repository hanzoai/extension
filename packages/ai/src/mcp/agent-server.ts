/**
 * MCP Server wrapper for Agents and Networks
 * Allows any agent or network to be exposed as an MCP server
 */

import { Server as MCPServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Agent } from '../core/agent';
import { Network } from '../core/network';
import { Tool } from '../core/tool';
import { z } from 'zod';

export interface AgentServerConfig {
  agent?: Agent;
  network?: Network;
  name?: string;
  version?: string;
  metadata?: Record<string, any>;
}

export class AgentMCPServer {
  private server: MCPServer;
  private agent?: Agent;
  private network?: Network;
  
  constructor(config: AgentServerConfig) {
    if (!config.agent && !config.network) {
      throw new Error('Either agent or network must be provided');
    }
    
    this.agent = config.agent;
    this.network = config.network;
    
    const name = config.name || this.agent?.name || this.network?.name || 'hanzo-agent';
    const version = config.version || '1.0.0';
    
    this.server = new MCPServer({
      name,
      version,
      metadata: config.metadata
    });
    
    this.setupTools();
    this.setupResources();
    this.setupPrompts();
  }
  
  private setupTools(): void {
    if (this.agent) {
      this.setupAgentTools();
    } else if (this.network) {
      this.setupNetworkTools();
    }
  }
  
  private setupAgentTools(): void {
    if (!this.agent) return;
    
    // Expose agent's run method as a tool
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: `${this.agent.name}_chat`,
          description: `Chat with ${this.agent.name} agent`,
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message to send to the agent'
              },
              context: {
                type: 'object',
                description: 'Optional context',
                properties: {
                  history: {
                    type: 'array',
                    items: { type: 'object' },
                    description: 'Previous messages'
                  }
                }
              }
            },
            required: ['message']
          }
        },
        // Expose all agent tools
        ...Array.from(this.agent.tools.values()).map(tool => ({
          name: `${this.agent!.name}_${tool.name}`,
          description: tool.description,
          inputSchema: this.toolToJsonSchema(tool)
        }))
      ]
    }));
    
    // Handle tool calls
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params as any;
      
      if (name === `${this.agent!.name}_chat`) {
        const result = await this.agent!.run({
          messages: [
            { role: 'user', content: args.message }
          ],
          context: args.context
        });
        
        return {
          content: [
            {
              type: 'text',
              text: result.content || JSON.stringify(result)
            }
          ]
        };
      }
      
      // Check if it's one of the agent's tools
      const toolName = name.replace(`${this.agent!.name}_`, '');
      const tool = this.agent!.tools.get(toolName);
      
      if (tool) {
        const result = await tool.execute(args, {
          agent: this.agent!,
          telemetry: {} as any
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      }
      
      throw new Error(`Tool '${name}' not found`);
    });
  }
  
  private setupNetworkTools(): void {
    if (!this.network) return;
    
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: `${this.network.name}_run`,
          description: `Run a task through the ${this.network.name} network`,
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Task or message for the network'
              },
              stream: {
                type: 'boolean',
                description: 'Whether to stream responses'
              }
            },
            required: ['message']
          }
        },
        {
          name: `${this.network.name}_state_get`,
          description: `Get a value from the network's state`,
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'State key to retrieve'
              }
            },
            required: ['key']
          }
        },
        {
          name: `${this.network.name}_state_set`,
          description: `Set a value in the network's state`,
          inputSchema: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'State key'
              },
              value: {
                description: 'Value to set'
              }
            },
            required: ['key', 'value']
          }
        },
        // Expose individual agents as tools
        ...Array.from(this.network.agents.values()).map(agent => ({
          name: `${this.network!.name}_agent_${agent.name}`,
          description: `Run task through ${agent.name} agent in the network`,
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Message for the agent'
              }
            },
            required: ['message']
          }
        }))
      ]
    }));
    
    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params as any;
      
      if (name === `${this.network!.name}_run`) {
        const result = await this.network!.run({
          messages: [
            { role: 'user', content: args.message }
          ],
          stream: args.stream
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result)
            }
          ]
        };
      }
      
      if (name === `${this.network!.name}_state_get`) {
        const value = this.network!.state.get(args.key);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(value)
            }
          ]
        };
      }
      
      if (name === `${this.network!.name}_state_set`) {
        this.network!.state.set(args.key, args.value);
        return {
          content: [
            {
              type: 'text',
              text: 'State updated'
            }
          ]
        };
      }
      
      // Check for agent-specific tools
      const agentMatch = name.match(new RegExp(`^${this.network!.name}_agent_(.+)$`));
      if (agentMatch) {
        const agentName = agentMatch[1];
        const agent = this.network!.getAgent(agentName);
        
        if (agent) {
          const result = await agent.run({
            messages: [
              { role: 'user', content: args.message }
            ]
          });
          
          return {
            content: [
              {
                type: 'text',
                text: result.content || JSON.stringify(result)
              }
            ]
          };
        }
      }
      
      throw new Error(`Tool '${name}' not found`);
    });
  }
  
  private setupResources(): void {
    this.server.setRequestHandler('resources/list', async () => ({
      resources: [
        {
          uri: `agent://${this.agent?.name || this.network?.name}/state`,
          name: 'State',
          description: 'Current state of the agent/network',
          mimeType: 'application/json'
        },
        {
          uri: `agent://${this.agent?.name || this.network?.name}/metrics`,
          name: 'Metrics',
          description: 'Performance metrics',
          mimeType: 'application/json'
        }
      ]
    }));
    
    this.server.setRequestHandler('resources/read', async (request) => {
      const { uri } = request.params as any;
      
      if (uri.endsWith('/state')) {
        const state = this.network?.state.toJSON() || {
          agent: this.agent?.name,
          metadata: this.agent?.metadata
        };
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(state, null, 2)
            }
          ]
        };
      }
      
      if (uri.endsWith('/metrics')) {
        const metrics = this.network?.getMetrics() || {
          agent: this.agent?.name,
          calls: 0 // Would be tracked in real implementation
        };
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(metrics, null, 2)
            }
          ]
        };
      }
      
      throw new Error(`Resource '${uri}' not found`);
    });
  }
  
  private setupPrompts(): void {
    const prompts = [];
    
    if (this.agent && this.agent.system) {
      prompts.push({
        name: `${this.agent.name}_system`,
        description: `System prompt for ${this.agent.name}`,
        arguments: []
      });
    }
    
    this.server.setRequestHandler('prompts/list', async () => ({
      prompts
    }));
    
    this.server.setRequestHandler('prompts/get', async (request) => {
      const { name } = request.params as any;
      
      if (name === `${this.agent?.name}_system`) {
        return {
          description: `System prompt for ${this.agent.name}`,
          messages: [
            {
              role: 'system',
              content: {
                type: 'text',
                text: this.agent!.system!
              }
            }
          ]
        };
      }
      
      throw new Error(`Prompt '${name}' not found`);
    });
  }
  
  private toolToJsonSchema(tool: Tool): any {
    // Convert Zod schema to JSON Schema
    // This is simplified - would use a proper converter in production
    return {
      type: 'object',
      properties: {},
      required: []
    };
  }
  
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
  
  async startHttp(port: number = 3000): Promise<void> {
    // HTTP transport implementation
    const { createServer } = await import('http');
    const server = createServer(async (req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const request = JSON.parse(body);
            const response = await this.handleHttpRequest(request);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      }
    });
    
    server.listen(port);
    console.log(`Agent MCP server listening on http://localhost:${port}`);
  }
  
  private async handleHttpRequest(request: any): Promise<any> {
    // Route to appropriate handler based on request method
    const [namespace, method] = request.method.split('/');
    
    if (namespace === 'tools') {
      if (method === 'list') {
        return this.server.handleRequest({ ...request, method: 'tools/list' });
      } else if (method === 'call') {
        return this.server.handleRequest({ ...request, method: 'tools/call' });
      }
    }
    
    throw new Error(`Unknown method: ${request.method}`);
  }
}

// Helper to create and start an MCP server for an agent/network
export function exposeAsMCP(
  agentOrNetwork: Agent | Network,
  options?: {
    transport?: 'stdio' | 'http';
    port?: number;
    name?: string;
  }
): AgentMCPServer {
  const server = new AgentMCPServer({
    agent: agentOrNetwork instanceof Agent ? agentOrNetwork : undefined,
    network: agentOrNetwork instanceof Network ? agentOrNetwork : undefined,
    name: options?.name
  });
  
  if (options?.transport === 'http') {
    server.startHttp(options.port);
  } else {
    server.start();
  }
  
  return server;
}