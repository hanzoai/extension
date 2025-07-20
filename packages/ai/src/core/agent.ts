/**
 * Agent implementation with MCP support
 */

import { z } from 'zod';
import { Tool } from './tool';
import { MCPServer } from '../mcp/types';
import { ModelInterface } from '../types';
import { Telemetry, SpanKind } from '../telemetry';
import { nanoid } from 'nanoid';

export interface AgentConfig {
  name: string;
  description?: string;
  system?: string;
  tools?: Tool[];
  mcpServers?: MCPServer[];
  model?: ModelInterface;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, any>;
}

export interface AgentContext {
  agent: Agent;
  network?: any; // Will be Network type
  state?: any;
  telemetry: Telemetry;
}

export interface AgentRunOptions {
  messages: any[];
  model?: ModelInterface;
  context?: Partial<AgentContext>;
  stream?: boolean;
}

export class Agent {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly system?: string;
  readonly tools: Map<string, Tool>;
  readonly mcpServers: MCPServer[];
  readonly model?: ModelInterface;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly metadata: Record<string, any>;
  
  private mcpTools: Map<string, any> = new Map();
  private initialized = false;
  
  constructor(config: AgentConfig) {
    this.id = nanoid();
    this.name = config.name;
    this.description = config.description;
    this.system = config.system;
    this.tools = new Map();
    this.mcpServers = config.mcpServers || [];
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.metadata = config.metadata || {};
    
    // Register tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Initialize MCP servers
    for (const server of this.mcpServers) {
      await this.connectMCPServer(server);
    }
    
    this.initialized = true;
  }
  
  private async connectMCPServer(server: MCPServer): Promise<void> {
    // Import MCP client dynamically
    const { MCPClient } = await import('../mcp/client');
    const client = new MCPClient();
    
    await client.connect({
      name: server.name,
      transport: server.transport
    });
    
    // Get available tools from MCP server
    const tools = await client.listTools();
    
    // Register MCP tools
    for (const tool of tools) {
      this.mcpTools.set(`${server.name}:${tool.name}`, {
        server,
        client,
        tool
      });
    }
  }
  
  async run(options: AgentRunOptions): Promise<any> {
    await this.initialize();
    
    const model = options.model || this.model;
    if (!model) {
      throw new Error(`No model specified for agent ${this.name}`);
    }
    
    // Build context
    const context: AgentContext = {
      agent: this,
      network: options.context?.network,
      state: options.context?.state,
      telemetry: options.context?.telemetry || new Telemetry()
    };
    
    // Prepare tools for the model
    const availableTools = this.getAllTools();
    
    // Add system message if specified
    const messages = [...options.messages];
    if (this.system) {
      messages.unshift({
        role: 'system',
        content: this.system
      });
    }
    
    // Execute with telemetry
    return context.telemetry.trace(
      `agent.${this.name}`,
      async (span) => {
        // Add agent metadata to span
        span.setAttributes({
          'agent.name': this.name,
          'agent.id': this.id,
          'agent.model': model.name || 'unknown',
          'agent.tools.count': this.getAllTools().size,
          'agent.mcp.servers': this.mcpServers.length,
          'agent.messages.count': messages.length
        });
        
        const startTime = Date.now();
        
        try {
          let result;
          if (options.stream) {
            result = await this.runStream({ ...options, messages, model, context });
          } else {
            result = await this.runComplete({ ...options, messages, model, context });
          }
          
          const duration = Date.now() - startTime;
          
          // Record metrics
          if (context.telemetry && 'recordAgentExecution' in context.telemetry) {
            (context.telemetry as any).recordAgentExecution(
              this.name,
              duration,
              true,
              {
                model: model.name,
                messageCount: messages.length,
                toolsUsed: result.toolCalls?.length || 0
              }
            );
          }
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          
          // Record failed execution
          if (context.telemetry && 'recordAgentExecution' in context.telemetry) {
            (context.telemetry as any).recordAgentExecution(
              this.name,
              duration,
              false,
              {
                model: model.name,
                error: error instanceof Error ? error.message : String(error)
              }
            );
          }
          
          throw error;
        }
      },
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'agent.type': 'llm'
        }
      }
    );
  }
  
  private async runComplete(options: any): Promise<any> {
    const { messages, model, context } = options;
    
    const response = await model.complete({
      messages,
      tools: Array.from(this.getAllTools().values()),
      temperature: this.temperature,
      maxTokens: this.maxTokens
    });
    
    // Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolResults = await this.executeToolCalls(response.toolCalls, context);
      
      // Add tool results to messages
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      });
      
      messages.push({
        role: 'tool',
        toolResults
      });
      
      // Recursively call for the next response
      return this.runComplete({ ...options, messages });
    }
    
    return response;
  }
  
  private async *runStream(options: any): AsyncIterableIterator<any> {
    const { messages, model, context } = options;
    
    const stream = await model.stream({
      messages,
      tools: Array.from(this.getAllTools().values()),
      temperature: this.temperature,
      maxTokens: this.maxTokens
    });
    
    // Handle streaming with tool calls
    return this.handleStreamWithTools(stream, messages, context, options);
  }
  
  private async *handleStreamWithTools(
    stream: AsyncIterableIterator<any>,
    messages: any[],
    context: AgentContext,
    options: any
  ): AsyncIterableIterator<any> {
    let content = '';
    const toolCalls: any[] = [];
    
    for await (const chunk of stream) {
      yield chunk;
      
      if (chunk.type === 'content') {
        content += chunk.content;
      } else if (chunk.type === 'tool_call') {
        toolCalls.push(chunk.toolCall);
      } else if (chunk.type === 'done' && toolCalls.length > 0) {
        // Execute tool calls
        const toolResults = await this.executeToolCalls(toolCalls, context);
        
        // Add to messages
        messages.push({
          role: 'assistant',
          content,
          toolCalls
        });
        
        messages.push({
          role: 'tool',
          toolResults
        });
        
        // Continue with next iteration
        const nextStream = await this.runStream({ ...options, messages });
        for await (const nextChunk of nextStream) {
          yield nextChunk;
        }
      }
    }
  }
  
  private async executeToolCalls(toolCalls: any[], context: AgentContext): Promise<any[]> {
    const results = [];
    
    for (const call of toolCalls) {
      try {
        const result = await this.executeTool(call.name, call.arguments, context);
        results.push({
          id: call.id,
          result
        });
      } catch (error) {
        results.push({
          id: call.id,
          error: String(error)
        });
      }
    }
    
    return results;
  }
  
  private async executeTool(name: string, args: any, context: AgentContext): Promise<any> {
    const startTime = Date.now();
    
    try {
      let result;
      let toolType: 'local' | 'mcp' = 'local';
      
      // Check local tools first
      if (this.tools.has(name)) {
        const tool = this.tools.get(name)!;
        result = await tool.handler(args, context);
      } else {
        // Check MCP tools
        let found = false;
        for (const [key, mcpTool] of this.mcpTools) {
          const [serverName, toolName] = key.split(':');
          if (toolName === name || key === name) {
            toolType = 'mcp';
            result = await mcpTool.client.callTool({
              name: toolName,
              arguments: args
            });
            found = true;
            break;
          }
        }
        
        if (!found) {
          throw new Error(`Tool '${name}' not found`);
        }
      }
      
      const duration = Date.now() - startTime;
      
      // Record tool usage metric
      if (context.telemetry && 'recordToolUsage' in context.telemetry) {
        (context.telemetry as any).recordToolUsage(
          name,
          this.name,
          duration,
          true
        );
      }
      
      // Add telemetry event
      context.telemetry.recordEvent({
        name: 'tool.executed',
        attributes: {
          'tool.name': name,
          'tool.type': toolType,
          'tool.duration': duration,
          'agent.name': this.name
        }
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Record failed tool execution
      if (context.telemetry && 'recordToolUsage' in context.telemetry) {
        (context.telemetry as any).recordToolUsage(
          name,
          this.name,
          duration,
          false
        );
      }
      
      throw error;
    }
  }
  
  private getAllTools(): Map<string, any> {
    const allTools = new Map();
    
    // Add local tools
    for (const [name, tool] of this.tools) {
      allTools.set(name, {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      });
    }
    
    // Add MCP tools
    for (const [key, mcpTool] of this.mcpTools) {
      const [serverName, toolName] = key.split(':');
      allTools.set(toolName, {
        name: toolName,
        description: mcpTool.tool.description,
        parameters: mcpTool.tool.inputSchema
      });
    }
    
    return allTools;
  }
  
  clone(overrides?: Partial<AgentConfig>): Agent {
    return new Agent({
      name: this.name,
      description: this.description,
      system: this.system,
      tools: Array.from(this.tools.values()),
      mcpServers: this.mcpServers,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      metadata: this.metadata,
      ...overrides
    });
  }
}

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}