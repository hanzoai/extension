# @hanzo/ai

The AI Toolkit for TypeScript - AgentKit with Model Context Protocol (MCP) support.

## Features

- 🤖 **Multi-Provider Support**: OpenAI, Anthropic, Google, Mistral, Bedrock, Vertex AI, Cohere, and more
- 🔧 **MCP Integration**: Full Model Context Protocol support for tool calling
- 🌐 **Agent Networks**: Create and orchestrate multiple AI agents
- 📊 **Observability**: Built-in telemetry with OpenTelemetry support
- 🔄 **Streaming**: First-class streaming support for all providers
- 📝 **Type Safety**: Full TypeScript support with comprehensive types
- 🎯 **Unified API**: Consistent interface across all providers

## Installation

```bash
npm install @hanzo/ai
```

## Quick Start

### Basic Text Generation

```typescript
import { generateText, openai } from '@hanzo/ai';

const result = await generateText({
  model: openai({ apiKey: process.env.OPENAI_API_KEY })('gpt-4'),
  prompt: 'What is the meaning of life?',
  maxTokens: 500
});

console.log(result.text);
```

### Creating an Agent

```typescript
import { createAgent, anthropic } from '@hanzo/ai';

const agent = createAgent({
  name: 'Assistant',
  model: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })('claude-3-sonnet'),
  instructions: 'You are a helpful assistant.',
  tools: [
    {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string' }
        }
      },
      handler: async ({ expression }) => {
        return { result: eval(expression) };
      }
    }
  ]
});

const response = await agent.run('What is 2 + 2?');
```

### Agent Networks

```typescript
import { createNetwork, createAgent, openai, anthropic } from '@hanzo/ai';

const network = createNetwork({
  agents: [
    createAgent({
      name: 'researcher',
      model: openai({ apiKey: process.env.OPENAI_API_KEY })('gpt-4'),
      instructions: 'You are a research specialist.'
    }),
    createAgent({
      name: 'writer',
      model: anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })('claude-3-sonnet'),
      instructions: 'You are a creative writer.'
    })
  ]
});

// Agents can collaborate
const result = await network.run('Research and write a short story about AI');
```

### Streaming

```typescript
import { generateStream, google } from '@hanzo/ai';

const stream = await generateStream({
  model: google({ apiKey: process.env.GOOGLE_API_KEY })('gemini-pro'),
  prompt: 'Tell me a story',
  maxTokens: 1000
});

for await (const chunk of stream) {
  process.stdout.write(chunk.text);
}
```

### Object Generation

```typescript
import { generateObject, openai } from '@hanzo/ai';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number(),
  interests: z.array(z.string())
});

const result = await generateObject({
  model: openai({ apiKey: process.env.OPENAI_API_KEY })('gpt-4'),
  prompt: 'Generate a random person profile',
  schema
});

console.log(result.object); // Typed as { name: string, age: number, interests: string[] }
```

## MCP Support

@hanzo/ai includes full Model Context Protocol support:

```typescript
import { createAgent } from '@hanzo/ai';
import { createMCPClient } from '@hanzo/ai/mcp';

// Connect to an MCP server
const mcpClient = await createMCPClient({
  command: 'node',
  args: ['path/to/mcp-server.js']
});

// Use MCP tools with an agent
const agent = createAgent({
  name: 'mcp-agent',
  model: openai({ apiKey: process.env.OPENAI_API_KEY })('gpt-4'),
  tools: await mcpClient.getTools()
});
```

## Providers

Supported providers with their respective models:

- **OpenAI**: GPT-4, GPT-3.5, o1-preview, o1-mini
- **Anthropic**: Claude 3 (Opus, Sonnet, Haiku), Claude 2
- **Google**: Gemini Pro, Gemini Ultra, PaLM
- **Mistral**: Mistral Large, Medium, Small, Mixtral
- **AWS Bedrock**: Access to multiple models
- **Google Vertex AI**: Enterprise Google AI
- **Cohere**: Command, Generate, Embed
- **Hanzo**: Custom Hanzo models

## Telemetry

Built-in telemetry support with OpenTelemetry:

```typescript
import { createHanzoCloudTelemetry } from '@hanzo/ai/telemetry';

// Initialize telemetry
const telemetry = createHanzoCloudTelemetry({
  apiKey: process.env.HANZO_API_KEY,
  serviceName: 'my-ai-app'
});

// All AI operations are automatically traced
```

## Advanced Usage

### Custom Providers

```typescript
import { createProvider } from '@hanzo/ai';

const customProvider = createProvider({
  name: 'custom',
  generateText: async ({ prompt, maxTokens }) => {
    // Your implementation
    return { text: 'Response' };
  }
});
```

### Tool Creation

```typescript
import { createTool } from '@hanzo/ai';

const weatherTool = createTool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string' }
    },
    required: ['location']
  },
  handler: async ({ location }) => {
    // Implementation
    return { temperature: 72, condition: 'sunny' };
  }
});
```

### State Management

```typescript
import { createState } from '@hanzo/ai';

const state = createState({
  messages: [],
  context: {}
});

// Use with agents for conversation memory
const agent = createAgent({
  name: 'stateful-agent',
  model: openai({ apiKey: process.env.OPENAI_API_KEY })('gpt-4'),
  state
});
```

## License

MIT © Hanzo AI