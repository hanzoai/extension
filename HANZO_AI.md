# Hanzo AI: The Ultimate Toolkit for AI Engineers

[Hanzo AI](https://hanzo.ai) is the ultimate toolkit for AI engineers, providing unified access to 200+ LLMs through one powerful platform. With built-in symbol search, 4000+ MCP servers, and intelligent routing, Hanzo AI supercharges your development workflow with shared context across all AI providers, documents, and codebases.

## Getting Started with Hanzo AI

1. **Login**: Use `@hanzo login` or visit [iam.hanzo.ai](https://iam.hanzo.ai)
2. **Get API Key**: Automatically configured after login via our cloud
3. **Add Credits**: Purchase credits for access to 200+ models
4. **Start Building**: Access all models through one unified API

## Why Hanzo AI is the Ultimate AI Engineering Toolkit

### 🚀 Complete Model Coverage via Hanzo AI
- **200+ Models**: All major AI models through [Hanzo AI](https://hanzo.ai)
- **Latest Models**: O3-Pro, Claude 4, GPT-4o, DeepSeek V3, Llama 3.1 405B
- **One API**: No need to manage multiple provider accounts
- **Smart Routing**: Automatically selects the best model for your task

### 🔧 Engineering-First Features
- **Unified API**: Single endpoint for all AI providers - no more juggling API keys
- **Smart Routing**: Automatic failover and load balancing across providers
- **Shared Context**: Maintain conversation context across model switches
- **4000+ MCP Servers**: Access specialized tools for every use case
- **Universal MCP Proxy**: Install ANY MCP server with `@hanzo mcp --action install`
- **Performance Monitoring**: Track latency, costs, and usage patterns
- **Team Collaboration**: Share API keys, context, and credits with your team

### 💡 Developer Experience
- **Zero Config**: Works out of the box with sensible defaults
- **Local Model Support**: Seamlessly integrate LM Studio and Ollama
- **VS Code Native**: Deep integration with @hanzo chat participant
- **Intelligent Caching**: Reduce costs with smart response caching
- **Error Handling**: Automatic retries and graceful degradation

## Priority Order

The Hanzo agent automatically detects and uses available LLM providers in this order:

1. **Environment Variables** (Highest Priority)
   - Direct API calls to providers when keys are detected locally
   - Maximum performance with minimal latency

2. **Local LLMs** (Medium-High Priority)
   - LM Studio: `LM_STUDIO_BASE_URL`
   - Ollama: `OLLAMA_BASE_URL`

3. **VS Code Settings** (Medium Priority)
   - `hanzo.llm.{provider}.apiKey` settings

4. **Hanzo AI** (Default)
   - Supercharges your AI development with unified access
   - Access to all models with credits
   - Managed API keys in Hanzo Cloud

## Complete Model Catalog (OpenRouter + LiteLLM Compatible)

Hanzo AI provides access to every model available through OpenRouter and LiteLLM, including:

- **OpenAI**: O3-Pro, O3, GPT-4o, GPT-4 Turbo, GPT-4, GPT-3.5 Turbo
- **Anthropic**: Claude 4, Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku
- **Google**: Gemini 2.0 Flash, Gemini Pro, Gemini Pro Vision, Gemini Ultra
- **Meta**: Llama 3.1 405B, Llama 3.1 70B, Llama 3 70B, CodeLlama
- **Mistral**: Large 2, Medium, Small, Mixtral 8x22B, Mixtral 8x7B
- **Cohere**: Command R Plus, Command R, Command
- **DeepSeek**: DeepSeek V3, DeepSeek Coder V2
- **Together AI**: Mixtral MOE, Llama variants, CodeLlama
- **Replicate**: Open source models
- **And 190+ more models...**

### Direct API Support (with local env keys)
```bash
# OpenAI
export OPENAI_API_KEY=sk-...

# Anthropic  
export ANTHROPIC_API_KEY=sk-ant-...

# Google/Gemini
export GOOGLE_API_KEY=...
# or
export GEMINI_API_KEY=...

# Mistral
export MISTRAL_API_KEY=...

# Cohere
export COHERE_API_KEY=...

# Together AI
export TOGETHER_API_KEY=...

# Replicate
export REPLICATE_API_KEY=...
```

### Hanzo AI (Recommended)
```bash
# Get your API key from iam.hanzo.ai
export HANZO_API_KEY=hzo_...

# Optional: Custom endpoint (defaults to https://api.hanzo.ai/ext/v1)
export HANZO_API_URL=https://api.hanzo.ai/ext/v1
```

### Local LLMs
```bash
# LM Studio
export LM_STUDIO_BASE_URL=http://localhost:1234/v1

# Ollama
export OLLAMA_BASE_URL=http://localhost:11434
```

## Usage Examples

### Using Hanzo AI
```bash
# Automatically uses Hanzo AI when HANZO_API_KEY is set
@hanzo agent analyze this codebase

# Access any of 200+ models through Hanzo AI
@hanzo agent --model o3-pro solve complex algorithm
@hanzo agent --model claude-4 analyze architecture
@hanzo agent --model gpt-4o write tests
@hanzo agent --model claude-3.5-sonnet review code
@hanzo agent --model gemini-2.0-flash explain this code
@hanzo agent --model llama-3.1-405b optimize performance
@hanzo agent --model deepseek-v3 debug issue
@hanzo agent --model mixtral-8x22b generate documentation
```

### Direct API Usage (when local keys available)
```bash
# If OPENAI_API_KEY is set, bypasses Hanzo AI for direct access
@hanzo agent --model gpt-4o task

# Force specific provider with prefix
@hanzo agent --model openai/o3-pro task
@hanzo agent --model anthropic/claude-4 task
@hanzo agent --model google/gemini-2.0-flash task
```

### Model Selection
```bash
# Let Hanzo AI choose the best model
@hanzo agent optimize this function

# Specify exact model from 200+ available
@hanzo agent --model o3-pro solve complex problem
@hanzo agent --model claude-4 review architecture  
@hanzo agent --model gpt-4o analyze performance
@hanzo agent --model gemini-2.0-flash quick analysis
@hanzo agent --model llama-3.1-405b deep reasoning
@hanzo agent --model deepseek-v3 code optimization
@hanzo agent --model command-r-plus generate documentation
```

## Why AI Engineers Choose Hanzo AI

### 🎯 **The Complete Toolkit**
- **Every Model**: OpenRouter + LiteLLM = access to every AI model
- **Every Tool**: 4000+ MCP servers for specialized capabilities
- **Every Provider**: OpenAI, Anthropic, Google, Meta, Mistral, and 50+ more

### ⚡ **Built for Performance**
- **Smart Caching**: Reduce redundant API calls
- **Automatic Failover**: Never get blocked by rate limits
- **Load Balancing**: Distribute requests across providers
- **Low Latency**: Optimized routing to nearest endpoints

### 💰 **Cost Optimization**
- **Unified Billing**: One invoice for all AI usage
- **Smart Routing**: Use cheaper models for simple tasks
- **Usage Analytics**: Identify and eliminate waste
- **Team Budgets**: Set limits and track spending

### 🔒 **Enterprise Ready**
- **SOC2 Compliant**: Enterprise-grade security
- **API Key Vault**: Encrypted storage for provider keys
- **Audit Logs**: Complete usage history
- **Team Management**: Role-based access control

## Configuration Priority

1. **Model argument**: `--model gpt-4` (highest)
2. **Environment variables**: Direct provider keys
3. **VS Code settings**: Provider configurations
4. **Hanzo AI**: Default with HANZO_API_KEY

## Provider Status Display

The agent shows which provider is being used:
```
## Task Completed
**LLM Provider**: hanzo (https://api.hanzo.ai/ext/v1)

[Agent results...]
```

For direct API usage:
```
## Task Completed
**LLM Provider**: openai

[Agent results...]
```

## Hanzo Cloud Features

When using Hanzo AI, you get:
- **200+ Models**: Access to all major AI providers and models
- **4000+ MCP Servers**: Specialized tools and integrations
- **Shared Context**: Maintain context across sessions and models
- **Intelligent Search**: Search across all interactions
- **Automatic Failover**: Switches providers if one fails
- **Rate Limiting**: Built-in protection against rate limits
- **Cost Tracking**: Monitor spending across all models
- **API Key Vault**: Securely store provider keys in cloud
- **Team Management**: Share credits, context, and access with your team
- **Usage Insights**: Detailed analytics and reporting

## Getting Your Hanzo API Key

1. Visit [iam.hanzo.ai](https://iam.hanzo.ai)
2. Sign up or log in to your account
3. Navigate to API Keys section
4. Generate a new API key
5. Add credits to your account
6. Set the key as `HANZO_API_KEY` environment variable

## Managing Provider Keys in Hanzo Cloud

Instead of managing multiple API keys locally, you can:
1. Log in to [iam.hanzo.ai](https://iam.hanzo.ai)
2. Go to "API Key Management"
3. Add your provider API keys (OpenAI, Anthropic, etc.)
4. Use Hanzo AI to access all providers with just your Hanzo key

## Troubleshooting

### No Credits Available
```
Error: Insufficient credits in your Hanzo account
```
**Solution**: Add credits at [iam.hanzo.ai](https://iam.hanzo.ai)

### Invalid API Key
```
Error: Invalid Hanzo API key
```
**Solution**: Check your API key at [iam.hanzo.ai](https://iam.hanzo.ai)

### Model Not Available
```
Error: Model xyz not available through Hanzo AI
```
**Solution**: Check supported models or contact support

## Advanced Usage

### Multi-Agent with Mixed Providers
```bash
# Some agents use Hanzo AI, others use direct APIs
@hanzo agent --agents '[
  {"name": "Architect", "role": "Design with Claude 4 via Hanzo"},
  {"name": "Analyst", "role": "Analyze with O3-Pro via Hanzo"},
  {"name": "Coder", "role": "Implement with GPT-4o"},
  {"name": "Reviewer", "role": "Review with DeepSeek V3"}
]' implement feature
```

### Credit Optimization
```bash
# Use cheaper models for simple tasks
@hanzo agent --model gpt-3.5-turbo quick task

# Use powerful models for complex tasks
@hanzo agent --model o3-pro complex reasoning
@hanzo agent --model claude-4 deep analysis
@hanzo agent --model llama-3.1-405b advanced math

# Use specialized models
@hanzo agent --model deepseek-v3 code generation
@hanzo agent --model command-r-plus technical writing
@hanzo agent --model gemini-2.0-flash rapid prototyping
```

## Security & Privacy

- **Hanzo AI**: Secure API with encrypted transport
- **Local Keys**: Never sent to Hanzo when using direct APIs
- **Cloud Keys**: Encrypted storage in Hanzo Cloud
- **Audit Trail**: Track all API usage through Hanzo dashboard
- **Privacy Controls**: Configure data retention and privacy settings

## Support

- **Documentation**: [docs.hanzo.ai](https://docs.hanzo.ai)
- **Dashboard**: [iam.hanzo.ai](https://iam.hanzo.ai)
- **Support**: support@hanzo.ai

**Hanzo AI is the unified platform for building AI-powered companies.** Access 200+ LLMs (OpenRouter/LiteLLM compatible), 4000+ MCP servers, legendary programmer modes, unlimited memory with vector/graph/relational search, browser automation, and everything you need to supercharge AI development. 

🚀 **[Get Started](https://iam.hanzo.ai)** | 📖 **[View Modes & Features](./HANZO_MODES.md)** | 💬 **[Join Discord](https://discord.gg/hanzoai)**