import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  Tool,
  TextContent,
  ImageContent,
  EmbeddedResource
} from '@modelcontextprotocol/sdk/types.js';
import { AgentInstance } from '../config/agent-swarm-config';
import { CLIToolManager } from '../cli-tool-manager';

export interface AgentMCPServerConfig {
  agentName: string;
  agent: AgentInstance;
  toolManager: CLIToolManager;
  port?: number;
}

export class AgentMCPServer {
  private server: Server;
  private config: AgentMCPServerConfig;

  constructor(config: AgentMCPServerConfig) {
    this.config = config;
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
    // List available tools for this agent
    this.server.setRequestHandler(ListToolsRequest, async () => {
      const tools: Tool[] = [
        {
          name: `chat_with_${this.config.agentName}`,
          description: `Chat directly with the ${this.config.agentName} agent (${this.config.agent.description})`,
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Your message to the agent',
              },
              conversation_id: {
                type: 'string',
                description: 'Optional conversation ID for context continuity',
              },
            },
            required: ['message'],
          },
        },
        {
          name: `ask_${this.config.agentName}`,
          description: `Ask a specific question to the ${this.config.agentName} agent`,
          inputSchema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask',
              },
              context: {
                type: 'object',
                description: 'Optional context for the question',
              },
            },
            required: ['question'],
          },
        },
        {
          name: `delegate_to_${this.config.agentName}`,
          description: `Delegate a specific task to the ${this.config.agentName} agent`,
          inputSchema: {
            type: 'object',
            properties: {
              task: {
                type: 'string',
                description: 'The task to delegate',
              },
              requirements: {
                type: 'object',
                description: 'Task requirements and constraints',
              },
              deadline: {
                type: 'string',
                description: 'Optional deadline for the task',
              },
            },
            required: ['task'],
          },
        },
        {
          name: `get_${this.config.agentName}_status`,
          description: `Get the current status and capabilities of the ${this.config.agentName} agent`,
          inputSchema: {
            type: 'object',
            properties: {
              include_workload: {
                type: 'boolean',
                description: 'Include current workload information',
              },
            },
          },
        },
        {
          name: `request_${this.config.agentName}_expertise`,
          description: `Request specific expertise from the ${this.config.agentName} agent`,
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'The topic or area of expertise needed',
              },
              depth: {
                type: 'string',
                enum: ['overview', 'detailed', 'expert'],
                description: 'Level of detail needed',
              },
            },
            required: ['topic'],
          },
        },
      ];

      return { tools } as ListToolsResult;
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequest, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: string;

        // Route to appropriate handler based on tool name pattern
        if (name.startsWith(`chat_with_`)) {
          result = await this.handleChat(args.message, args.conversation_id);
        } else if (name.startsWith(`ask_`)) {
          result = await this.handleQuestion(args.question, args.context);
        } else if (name.startsWith(`delegate_to_`)) {
          result = await this.handleDelegation(args.task, args.requirements, args.deadline);
        } else if (name.startsWith(`get_`) && name.endsWith('_status')) {
          result = await this.getStatus(args.include_workload);
        } else if (name.startsWith(`request_`) && name.endsWith('_expertise')) {
          result = await this.handleExpertiseRequest(args.topic, args.depth || 'detailed');
        } else {
          throw new Error(`Unknown tool: ${name}`);
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

  private conversationHistory: Map<string, string[]> = new Map();

  private async handleChat(message: string, conversationId?: string): Promise<string> {
    const tool = this.getToolForModel(this.config.agent.model);
    const convId = conversationId || 'default';
    
    // Get conversation history
    if (!this.conversationHistory.has(convId)) {
      this.conversationHistory.set(convId, []);
    }
    const history = this.conversationHistory.get(convId)!;
    
    // Build conversational prompt
    let prompt = `${this.config.agent.prompt}\n\n`;
    prompt += `You are having a conversation with another agent. Respond naturally and helpfully.\n\n`;
    
    if (history.length > 0) {
      prompt += `## Previous Messages\n`;
      history.slice(-10).forEach(msg => prompt += `${msg}\n`);
      prompt += `\n`;
    }
    
    prompt += `## Current Message\n${message}\n\n`;
    prompt += `Respond as ${this.config.agentName}:`;

    const result = await this.config.toolManager.runTool(tool, prompt, {
      model: this.config.agent.model,
      cwd: this.config.agent.directory,
    });

    // Store in history
    history.push(`Other Agent: ${message}`);
    history.push(`${this.config.agentName}: ${result}`);
    
    return result;
  }

  private async handleQuestion(question: string, context?: any): Promise<string> {
    const tool = this.getToolForModel(this.config.agent.model);
    
    let prompt = `${this.config.agent.prompt}\n\n`;
    prompt += `You've been asked a specific question by another agent.\n\n`;
    
    if (context) {
      prompt += `## Context\n${JSON.stringify(context, null, 2)}\n\n`;
    }
    
    prompt += `## Question\n${question}\n\n`;
    prompt += `Provide a clear, direct answer focusing on your area of expertise.`;

    const result = await this.config.toolManager.runTool(tool, prompt, {
      model: this.config.agent.model,
      cwd: this.config.agent.directory,
    });

    return result;
  }

  private async handleDelegation(task: string, requirements?: any, deadline?: string): Promise<string> {
    const tool = this.getToolForModel(this.config.agent.model);
    
    let prompt = `${this.config.agent.prompt}\n\n`;
    prompt += `You've been delegated a specific task by another agent.\n\n`;
    
    prompt += `## Delegated Task\n${task}\n\n`;
    
    if (requirements) {
      prompt += `## Requirements\n${JSON.stringify(requirements, null, 2)}\n\n`;
    }
    
    if (deadline) {
      prompt += `## Deadline\n${deadline}\n\n`;
    }
    
    prompt += `Complete this task according to your expertise and the requirements provided.`;

    const result = await this.config.toolManager.runTool(tool, prompt, {
      model: this.config.agent.model,
      cwd: this.config.agent.directory,
    });

    return result;
  }

  private async getStatus(includeWorkload?: boolean): Promise<string> {
    const status = {
      agent: this.config.agentName,
      description: this.config.agent.description,
      model: this.config.agent.model,
      directory: this.config.agent.directory,
      status: 'active',
      capabilities: {
        tools: this.config.agent.allowed_tools || [],
        connections: this.config.agent.connections || [],
        mcps: this.config.agent.mcps?.map(mcp => mcp.name) || [],
        canChat: true,
        canDelegate: true,
        canProvideExpertise: true,
      },
    };

    if (includeWorkload) {
      // Could track actual workload here
      (status as any).workload = {
        activeConversations: this.conversationHistory.size,
        tasksInProgress: 0,
        availability: 'available',
      };
    }

    return JSON.stringify(status, null, 2);
  }

  private async handleExpertiseRequest(topic: string, depth: string): Promise<string> {
    const tool = this.getToolForModel(this.config.agent.model);
    
    let prompt = `${this.config.agent.prompt}\n\n`;
    prompt += `Another agent has requested your expertise on a specific topic.\n\n`;
    prompt += `## Topic\n${topic}\n\n`;
    prompt += `## Requested Depth\n${depth}\n\n`;
    
    switch (depth) {
      case 'overview':
        prompt += `Provide a brief overview suitable for someone unfamiliar with the topic.`;
        break;
      case 'detailed':
        prompt += `Provide a comprehensive explanation with relevant details and examples.`;
        break;
      case 'expert':
        prompt += `Provide an in-depth expert analysis including edge cases, best practices, and advanced considerations.`;
        break;
    }

    const result = await this.config.toolManager.runTool(tool, prompt, {
      model: this.config.agent.model,
      cwd: this.config.agent.directory,
    });

    return result;
  }

  private getToolForModel(model: string): string {
    const modelMap: Record<string, string> = {
      'opus': 'claude',
      'sonnet': 'claude',
      'haiku': 'claude',
      'gpt-4': 'codex',
      'gpt-3.5': 'codex',
      'gemini-pro': 'gemini',
      'gemini-ultra': 'gemini',
    };

    return modelMap[model.toLowerCase()] || 'claude';
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(`Agent MCP server for ${this.config.agentName} started`);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

// CLI entry point for running as a standalone process
if (require.main === module) {
  const agentName = process.argv[2];
  const agentConfigJson = process.argv[3];

  if (!agentName || !agentConfigJson) {
    console.error('Usage: agent-mcp-server <agent-name> <agent-config-json>');
    process.exit(1);
  }

  const agent = JSON.parse(agentConfigJson) as AgentInstance;
  const toolManager = new CLIToolManager();

  const server = new AgentMCPServer({
    agentName,
    agent,
    toolManager,
  });

  server.start().catch((error) => {
    console.error('Failed to start agent MCP server:', error);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
}