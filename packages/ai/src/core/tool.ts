/**
 * Tool implementation for agents
 */

import { z } from 'zod';
import { AgentContext } from './agent';

export interface ToolConfig<TParams = any, TResult = any> {
  name: string;
  description: string;
  parameters: z.ZodSchema<TParams>;
  handler: (params: TParams, context: AgentContext) => Promise<TResult> | TResult;
  examples?: Array<{
    input: TParams;
    output: TResult;
    description?: string;
  }>;
  metadata?: Record<string, any>;
}

export class Tool<TParams = any, TResult = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodSchema<TParams>;
  readonly handler: (params: TParams, context: AgentContext) => Promise<TResult> | TResult;
  readonly examples?: ToolConfig<TParams, TResult>['examples'];
  readonly metadata: Record<string, any>;
  
  constructor(config: ToolConfig<TParams, TResult>) {
    this.name = config.name;
    this.description = config.description;
    this.parameters = config.parameters;
    this.handler = config.handler;
    this.examples = config.examples;
    this.metadata = config.metadata || {};
  }
  
  async execute(params: any, context: AgentContext): Promise<TResult> {
    // Validate parameters
    const result = this.parameters.safeParse(params);
    if (!result.success) {
      throw new Error(`Invalid parameters for tool '${this.name}': ${result.error.message}`);
    }
    
    // Execute handler
    return Promise.resolve(this.handler(result.data, context));
  }
  
  getSchema(): any {
    return {
      name: this.name,
      description: this.description,
      parameters: this.zodToJsonSchema(this.parameters)
    };
  }
  
  private zodToJsonSchema(schema: z.ZodSchema): any {
    // This is a simplified version - in production you'd use a proper converter
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: any = {};
      const required: string[] = [];
      
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodSchema);
        
        // Check if field is required
        if (!(value as any).isOptional()) {
          required.push(key);
        }
      }
      
      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      };
    } else if (schema instanceof z.ZodString) {
      return { type: 'string' };
    } else if (schema instanceof z.ZodNumber) {
      return { type: 'number' };
    } else if (schema instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    } else if (schema instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodToJsonSchema((schema as any)._def.type)
      };
    }
    
    // Fallback
    return { type: 'any' };
  }
}

export function createTool<TParams = any, TResult = any>(
  config: ToolConfig<TParams, TResult>
): Tool<TParams, TResult> {
  return new Tool(config);
}

// Common tool patterns
export const commonTools = {
  done: (onDone?: (result: any, context: AgentContext) => void) => 
    createTool({
      name: 'done',
      description: 'Call this tool when you are finished with the task.',
      parameters: z.object({
        answer: z.string().describe("Final answer or result"),
        summary: z.string().optional().describe("Brief summary of what was accomplished")
      }),
      handler: async (params, context) => {
        context.network?.state.set('complete', true);
        context.network?.state.set('answer', params.answer);
        if (params.summary) {
          context.network?.state.set('summary', params.summary);
        }
        
        if (onDone) {
          onDone(params, context);
        }
        
        return { success: true };
      }
    }),
    
  handoff: () =>
    createTool({
      name: 'handoff',
      description: 'Hand off the conversation to another agent.',
      parameters: z.object({
        agent: z.string().describe("Name of the agent to hand off to"),
        context: z.string().describe("Context to provide to the next agent"),
        priority: z.boolean().optional().describe("Whether this is a priority handoff")
      }),
      handler: async (params, context) => {
        if (!context.network) {
          throw new Error('Handoff requires a network context');
        }
        
        context.network.state.set('nextAgent', params.agent);
        context.network.state.set('handoffContext', params.context);
        
        return {
          success: true,
          agent: params.agent
        };
      }
    }),
    
  askUser: () =>
    createTool({
      name: 'ask_user',
      description: 'Ask the user for additional information or clarification.',
      parameters: z.object({
        question: z.string().describe("The question to ask the user"),
        context: z.string().optional().describe("Additional context for the question"),
        options: z.array(z.string()).optional().describe("Multiple choice options if applicable")
      }),
      handler: async (params, context) => {
        context.network?.state.set('waitingForUser', true);
        context.network?.state.set('userQuestion', params);
        
        return {
          success: true,
          waiting: true
        };
      }
    }),
    
  remember: () =>
    createTool({
      name: 'remember',
      description: 'Store information in long-term memory.',
      parameters: z.object({
        key: z.string().describe("Memory key"),
        value: z.any().describe("Value to remember"),
        category: z.string().optional().describe("Category for organization"),
        ttl: z.number().optional().describe("Time to live in seconds")
      }),
      handler: async (params, context) => {
        const memory = context.network?.state.get('memory') || {};
        memory[params.key] = {
          value: params.value,
          category: params.category,
          timestamp: Date.now(),
          ttl: params.ttl
        };
        
        context.network?.state.set('memory', memory);
        
        return { success: true };
      }
    }),
    
  recall: () =>
    createTool({
      name: 'recall',
      description: 'Retrieve information from long-term memory.',
      parameters: z.object({
        key: z.string().optional().describe("Specific memory key"),
        category: z.string().optional().describe("Category to search"),
        query: z.string().optional().describe("Search query")
      }),
      handler: async (params, context) => {
        const memory = context.network?.state.get('memory') || {};
        
        if (params.key) {
          return memory[params.key]?.value || null;
        }
        
        // Search by category or query
        const results: any[] = [];
        for (const [key, item] of Object.entries(memory)) {
          const memItem = item as any;
          
          // Check TTL
          if (memItem.ttl && Date.now() - memItem.timestamp > memItem.ttl * 1000) {
            continue;
          }
          
          if (params.category && memItem.category === params.category) {
            results.push({ key, ...memItem });
          } else if (params.query) {
            const searchStr = JSON.stringify(memItem.value).toLowerCase();
            if (searchStr.includes(params.query.toLowerCase())) {
              results.push({ key, ...memItem });
            }
          }
        }
        
        return results;
      }
    })
};