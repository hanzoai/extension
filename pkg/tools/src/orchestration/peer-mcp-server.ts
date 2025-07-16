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
import fetch from 'node-fetch';

interface PeerConfig {
  instance: AgentInstance;
  port: number;
  peers: string[];
  networkConfig: any;
}

export class PeerMCPServer {
  private server: Server;
  private agentName: string;
  private config: PeerConfig;
  private conversationHistory: Map<string, string[]> = new Map();
  private callStack: string[] = [];

  constructor(agentName: string, config: PeerConfig) {
    this.agentName = agentName;
    this.config = config;
    
    this.server = new Server(
      {
        name: `peer-${agentName}`,
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
    // List all peer agents as available tools
    this.server.setRequestHandler(ListToolsRequest, async () => {
      const tools: Tool[] = [];
      
      // Add tools for each peer agent
      for (const peerName of this.config.peers) {
        if (peerName !== this.agentName) {
          // Chat tool
          tools.push({
            name: `chat_with_${peerName}`,
            description: `Have a conversation with the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  description: 'Your message to the agent',
                },
                conversation_id: {
                  type: 'string',
                  description: 'Conversation ID for context',
                },
                context: {
                  type: 'object',
                  description: 'Additional context',
                },
              },
              required: ['message'],
            },
          });

          // Ask tool
          tools.push({
            name: `ask_${peerName}`,
            description: `Ask a specific question to the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description: 'The question to ask',
                },
                context: {
                  type: 'object',
                  description: 'Question context',
                },
                urgency: {
                  type: 'string',
                  enum: ['low', 'normal', 'high'],
                  description: 'Question urgency',
                },
              },
              required: ['question'],
            },
          });

          // Delegate tool
          tools.push({
            name: `delegate_to_${peerName}`,
            description: `Delegate a task to the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                task: {
                  type: 'string',
                  description: 'The task to delegate',
                },
                requirements: {
                  type: 'object',
                  description: 'Task requirements',
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'normal', 'high'],
                  description: 'Task priority',
                },
                deadline: {
                  type: 'string',
                  description: 'Task deadline',
                },
              },
              required: ['task'],
            },
          });

          // Status tool
          tools.push({
            name: `get_${peerName}_status`,
            description: `Get status of the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                include_workload: {
                  type: 'boolean',
                  description: 'Include current workload',
                },
                include_capabilities: {
                  type: 'boolean',
                  description: 'Include agent capabilities',
                },
              },
            },
          });

          // Expertise tool
          tools.push({
            name: `request_${peerName}_expertise`,
            description: `Request expertise from the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: 'The topic requiring expertise',
                },
                depth: {
                  type: 'string',
                  enum: ['overview', 'detailed', 'expert'],
                  description: 'Depth of expertise needed',
                },
                specific_questions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Specific questions to address',
                },
              },
              required: ['topic'],
            },
          });

          // Collaborate tool
          tools.push({
            name: `collaborate_with_${peerName}`,
            description: `Start a collaborative session with the ${peerName} agent`,
            inputSchema: {
              type: 'object',
              properties: {
                objective: {
                  type: 'string',
                  description: 'Collaboration objective',
                },
                duration: {
                  type: 'string',
                  description: 'Expected duration',
                },
                deliverables: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Expected deliverables',
                },
              },
              required: ['objective'],
            },
          });
        }
      }

      // Add self-reflection tool
      tools.push({
        name: 'reflect',
        description: 'Reflect on current task and progress',
        inputSchema: {
          type: 'object',
          properties: {
            aspect: {
              type: 'string',
              description: 'What aspect to reflect on',
            },
          },
        },
      });

      // Add network status tool
      tools.push({
        name: 'get_network_status',
        description: 'Get status of the entire agent network',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      });

      return { tools } as ListToolsResult;
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequest, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Track call stack to prevent infinite recursion
        if (this.callStack.includes(name)) {
          return this.createErrorResult('Recursive call detected. Breaking recursion.');
        }

        this.callStack.push(name);
        let result: string;

        // Route to appropriate handler
        if (name.startsWith('chat_with_')) {
          const peerName = name.replace('chat_with_', '');
          result = await this.handleChat(peerName, args);
        } else if (name.startsWith('ask_')) {
          const peerName = name.replace('ask_', '');
          result = await this.handleAsk(peerName, args);
        } else if (name.startsWith('delegate_to_')) {
          const peerName = name.replace('delegate_to_', '');
          result = await this.handleDelegate(peerName, args);
        } else if (name.startsWith('get_') && name.endsWith('_status')) {
          const peerName = name.replace('get_', '').replace('_status', '');
          result = await this.handleGetStatus(peerName, args);
        } else if (name.startsWith('request_') && name.endsWith('_expertise')) {
          const peerName = name.replace('request_', '').replace('_expertise', '');
          result = await this.handleRequestExpertise(peerName, args);
        } else if (name.startsWith('collaborate_with_')) {
          const peerName = name.replace('collaborate_with_', '');
          result = await this.handleCollaborate(peerName, args);
        } else if (name === 'reflect') {
          result = await this.handleReflect(args);
        } else if (name === 'get_network_status') {
          result = await this.handleGetNetworkStatus();
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }

        this.callStack.pop();
        return this.createSuccessResult(result);
      } catch (error) {
        this.callStack.pop();
        return this.createErrorResult(error);
      }
    });
  }

  private async handleChat(peerName: string, args: any): Promise<string> {
    const { message, conversation_id, context } = args;
    const convId = conversation_id || `${this.agentName}-${peerName}`;
    
    // Store conversation history
    if (!this.conversationHistory.has(convId)) {
      this.conversationHistory.set(convId, []);
    }
    const history = this.conversationHistory.get(convId)!;
    history.push(`${this.agentName}: ${message}`);
    
    // Forward to peer agent
    const response = await this.callPeerAgent(peerName, 'chat', {
      from: this.agentName,
      message,
      conversation_id: convId,
      context,
      history: history.slice(-10) // Last 10 messages
    });
    
    history.push(`${peerName}: ${response}`);
    return response;
  }

  private async handleAsk(peerName: string, args: any): Promise<string> {
    const { question, context, urgency } = args;
    
    return await this.callPeerAgent(peerName, 'answer', {
      from: this.agentName,
      question,
      context,
      urgency: urgency || 'normal'
    });
  }

  private async handleDelegate(peerName: string, args: any): Promise<string> {
    const { task, requirements, priority, deadline } = args;
    
    return await this.callPeerAgent(peerName, 'execute', {
      from: this.agentName,
      task,
      requirements,
      priority: priority || 'normal',
      deadline
    });
  }

  private async handleGetStatus(peerName: string, args: any): Promise<string> {
    const { include_workload, include_capabilities } = args;
    
    return await this.callPeerAgent(peerName, 'status', {
      include_workload,
      include_capabilities
    });
  }

  private async handleRequestExpertise(peerName: string, args: any): Promise<string> {
    const { topic, depth, specific_questions } = args;
    
    return await this.callPeerAgent(peerName, 'expertise', {
      from: this.agentName,
      topic,
      depth: depth || 'detailed',
      specific_questions
    });
  }

  private async handleCollaborate(peerName: string, args: any): Promise<string> {
    const { objective, duration, deliverables } = args;
    
    // Start collaborative session
    const sessionId = `collab-${Date.now()}`;
    
    return await this.callPeerAgent(peerName, 'collaborate', {
      from: this.agentName,
      session_id: sessionId,
      objective,
      duration,
      deliverables
    });
  }

  private async handleReflect(args: any): Promise<string> {
    const { aspect } = args;
    
    // Self-reflection using local context
    const reflection = {
      agent: this.agentName,
      aspect: aspect || 'general',
      current_conversations: this.conversationHistory.size,
      call_stack_depth: this.callStack.length,
      capabilities: this.config.instance.allowed_tools || [],
      connections: this.config.peers.filter(p => p !== this.agentName)
    };
    
    return JSON.stringify(reflection, null, 2);
  }

  private async handleGetNetworkStatus(): Promise<string> {
    // Get status of entire network
    const networkStatus = {
      total_agents: this.config.peers.length,
      current_agent: this.agentName,
      connected_peers: this.config.peers.filter(p => p !== this.agentName),
      network_config: {
        recursive_calls: this.config.networkConfig.enableRecursiveCalls,
        max_recursion: this.config.networkConfig.maxRecursionDepth,
        cost_optimization: this.config.networkConfig.costOptimization
      }
    };
    
    return JSON.stringify(networkStatus, null, 2);
  }

  private async callPeerAgent(peerName: string, operation: string, params: any): Promise<string> {
    // Check if we should use local or remote LLM
    const useLocal = this.shouldUseLocalLLM(operation);
    
    if (useLocal && this.config.networkConfig.costOptimization) {
      // Use local Hanzo Zen for simple operations
      return await this.callLocalLLM(peerName, operation, params);
    } else {
      // Use peer's configured LLM
      return await this.callPeerMCP(peerName, operation, params);
    }
  }

  private shouldUseLocalLLM(operation: string): boolean {
    // Use local LLM for simple operations to save costs
    const localOperations = ['status', 'reflect', 'get_network_status'];
    return localOperations.includes(operation);
  }

  private async callLocalLLM(peerName: string, operation: string, params: any): Promise<string> {
    const endpoint = this.config.networkConfig.mainLoopLLM.endpoint || 'http://localhost:8080/v1/completions';
    
    const prompt = `
    Acting as ${peerName} agent, respond to this ${operation} request:
    ${JSON.stringify(params, null, 2)}
    
    Provide a concise, helpful response.
    `;
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'hanzo-zen',
          prompt,
          max_tokens: 500,
          temperature: 0.7
        })
      });
      
      const result = await response.json();
      return result.choices[0].text;
    } catch (error) {
      return `Local LLM error: ${error.message}`;
    }
  }

  private async callPeerMCP(peerName: string, operation: string, params: any): Promise<string> {
    // In production, this would make an actual MCP call to the peer
    // For now, simulate the peer response
    return `[${peerName}] Received ${operation} request: ${JSON.stringify(params)}`;
  }

  private createSuccessResult(text: string): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text,
        } as TextContent,
      ],
    };
  }

  private createErrorResult(error: any): CallToolResult {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        } as TextContent,
      ],
      isError: true,
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Peer MCP server for ${this.agentName} started on port ${this.config.port}`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

// CLI entry point
if (require.main === module) {
  const agentName = process.argv[2];
  const configJson = process.argv[3];

  if (!agentName || !configJson) {
    console.error('Usage: peer-mcp-server <agent-name> <config-json>');
    process.exit(1);
  }

  const config = JSON.parse(configJson) as PeerConfig;
  const server = new PeerMCPServer(agentName, config);

  server.start().catch((error) => {
    console.error('Failed to start peer MCP server:', error);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}