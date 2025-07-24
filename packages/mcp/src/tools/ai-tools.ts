/**
 * AI-powered tools for enhanced reasoning and delegation
 */

import { Tool, ToolResult } from '../types';
import { 
  createAgent, 
  createNetwork,
  generateText,
  openai,
  anthropic,
  google
} from '@hanzo/ai';
import pLimit from 'p-limit';

export const thinkTool: Tool = {
  name: 'think',
  description: 'Think through a problem step by step',
  inputSchema: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description: 'What to think about'
      },
      context: {
        type: 'string',
        description: 'Additional context'
      }
    },
    required: ['thought']
  },
  handler: async (args) => {
    // This tool just logs the thinking process
    // It's meant to be used by the AI to organize thoughts
    const output = [
      '🤔 Thinking...',
      '',
      `Topic: ${args.thought}`,
      args.context ? `Context: ${args.context}` : '',
      '',
      'This is a space for structured reasoning. The AI can use this tool to:',
      '- Break down complex problems',
      '- Consider multiple approaches',
      '- Plan before acting',
      '- Document reasoning for transparency'
    ].filter(Boolean).join('\n');
    
    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  }
};

export const criticTool: Tool = {
  name: 'critic',
  description: 'Critically analyze code or decisions',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'What to critique'
      },
      code: {
        type: 'string',
        description: 'Code to analyze'
      },
      decision: {
        type: 'string',
        description: 'Decision to analyze'
      }
    },
    required: ['subject']
  },
  handler: async (args) => {
    const critiques = [
      `🔍 Critical Analysis: ${args.subject}`,
      '',
      '### Things to Consider:',
      '',
      '**Potential Issues:**',
      '- Have all edge cases been considered?',
      '- Are there security implications?',
      '- Is error handling comprehensive?',
      '- Are there performance concerns?',
      '',
      '**Code Quality:**',
      '- Is the code readable and maintainable?',
      '- Are there any code smells?',
      '- Is it following established patterns?',
      '- Are tests adequate?',
      '',
      '**Architecture:**',
      '- Does this fit well with the existing system?',
      '- Are we creating technical debt?',
      '- Is this the simplest solution?',
      '- Are abstractions appropriate?',
      '',
      '**Recommendations:**',
      '- Consider alternative approaches',
      '- Add comprehensive error handling',
      '- Include tests for edge cases',
      '- Document assumptions and decisions'
    ];
    
    return {
      content: [{
        type: 'text',
        text: critiques.join('\n')
      }]
    };
  }
};

export const consensusTool: Tool = {
  name: 'consensus',
  description: 'Get consensus from multiple AI models',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Question to get consensus on'
      },
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Models to query (openai, anthropic, google)',
        default: ['openai', 'anthropic']
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds',
        default: 30000
      }
    },
    required: ['question']
  },
  handler: async (args) => {
    const models = args.models || ['openai', 'anthropic'];
    const responses: Record<string, string> = {};
    const errors: Record<string, string> = {};
    
    // Create a network for consensus
    const network = createNetwork({
      agents: models.map(model => {
        let provider;
        let modelName;
        
        switch (model) {
          case 'openai':
            provider = openai({ apiKey: process.env.OPENAI_API_KEY });
            modelName = 'gpt-4-turbo-preview';
            break;
          case 'anthropic':
            provider = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            modelName = 'claude-3-sonnet-20240229';
            break;
          case 'google':
            provider = google({ apiKey: process.env.GOOGLE_API_KEY });
            modelName = 'gemini-pro';
            break;
          default:
            throw new Error(`Unknown model: ${model}`);
        }
        
        return createAgent({
          name: model,
          model: provider(modelName),
          instructions: 'You are a helpful assistant providing your perspective on the given question.'
        });
      })
    });
    
    // Query models in parallel
    const limit = pLimit(3);
    const promises = models.map(model => 
      limit(async () => {
        try {
          const agent = network.agents.find(a => a.name === model);
          if (!agent) throw new Error(`Agent ${model} not found`);
          
          const result = await generateText({
            model: agent.model,
            prompt: args.question,
            maxTokens: 500
          });
          
          responses[model] = result.text;
        } catch (error: any) {
          errors[model] = error.message;
        }
      })
    );
    
    // Wait with timeout
    await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Consensus timeout')), args.timeout || 30000)
      )
    ]).catch(() => {
      // Continue with partial results
    });
    
    // Format results
    const output = [`🤝 Consensus Query: "${args.question}"`, ''];
    
    // Show responses
    if (Object.keys(responses).length > 0) {
      output.push('### Model Responses:');
      for (const [model, response] of Object.entries(responses)) {
        output.push('', `**${model}:**`, response);
      }
    }
    
    // Show errors
    if (Object.keys(errors).length > 0) {
      output.push('', '### Errors:');
      for (const [model, error] of Object.entries(errors)) {
        output.push(`- ${model}: ${error}`);
      }
    }
    
    // Synthesize consensus
    if (Object.keys(responses).length > 1) {
      output.push('', '### Consensus Summary:');
      output.push('Multiple models were consulted. Review the individual responses above to identify:');
      output.push('- Points of agreement');
      output.push('- Areas of disagreement');
      output.push('- Unique insights from each model');
    }
    
    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  }
};

export const agentTool: Tool = {
  name: 'agent',
  description: 'Delegate a task to a sub-agent',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Task description for the agent'
      },
      model: {
        type: 'string',
        description: 'Model to use (openai, anthropic)',
        default: 'openai'
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tools the agent can use'
      },
      maxIterations: {
        type: 'number',
        description: 'Maximum iterations',
        default: 5
      }
    },
    required: ['task']
  },
  handler: async (args) => {
    try {
      // Select provider and model
      let provider;
      let modelName;
      
      switch (args.model || 'openai') {
        case 'openai':
          provider = openai({ apiKey: process.env.OPENAI_API_KEY });
          modelName = 'gpt-4-turbo-preview';
          break;
        case 'anthropic':
          provider = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
          modelName = 'claude-3-sonnet-20240229';
          break;
        default:
          throw new Error(`Unknown model: ${args.model}`);
      }
      
      // Create a specialized agent
      const agent = createAgent({
        name: 'task-agent',
        model: provider(modelName),
        instructions: `You are a specialized agent with a specific task.
Task: ${args.task}
${args.tools ? `Available tools: ${args.tools.join(', ')}` : ''}
Complete this task and report back with your findings.`,
        tools: args.tools ? [] : undefined // TODO: Load actual tools when MCP integration is complete
      });
      
      // Execute the task
      const result = await generateText({
        model: agent.model,
        prompt: 'Please complete the assigned task.',
        maxTokens: 1000
      });
      
      return {
        content: [{
          type: 'text',
          text: `🤖 Agent Report:\n\nTask: ${args.task}\nModel: ${args.model || 'openai'}\n\n${result.text}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error running agent: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Export all AI tools
export const aiTools = [
  thinkTool,
  criticTool,
  consensusTool,
  agentTool
];