# VS Code Chat Participant Integration

The Hanzo extension now includes full VS Code Chat Participant integration, making all 53+ MCP tools available through VS Code's chat interface.

## Features

### 1. Chat Participant Registration
- Registered as `@hanzo` (lowercase) in VS Code's chat interface
- Accessible via Ctrl+Alt+I (Cmd+Alt+I on Mac)
- Shows up with the Hanzo icon

### 2. LLM Integration
The chat participant supports multiple LLM providers:

- **Hanzo AI Gateway** (default): Uses api.hanzo.ai
- **LM Studio**: Local models via http://localhost:1234
- **Ollama**: Local models via http://localhost:11434
- **OpenAI**: Direct OpenAI API integration
- **Anthropic**: Direct Claude API integration

### 3. Tool Access
All MCP tools are available through natural language or direct commands:

**File Operations:**
- `@hanzo read src/index.ts`
- `@hanzo write config.json content: { "key": "value" }`
- `@hanzo edit file.ts replace "old" with "new"`

**Search Operations:**
- `@hanzo search "TODO"`
- `@hanzo grep "function" in **/*.ts`

**Shell Operations:**
- `@hanzo run npm test`
- `@hanzo bash git status`

**AI Operations:**
- `@hanzo agent analyze this codebase for security issues`
- `@hanzo dispatch_agent implement new feature X`

### 4. Configuration

Add to VS Code settings.json:

```json
{
  // Choose LLM provider
  "hanzo.llm.provider": "hanzo", // or "lmstudio", "ollama", "openai", "anthropic"
  
  // Hanzo AI Gateway (default)
  "hanzo.llm.hanzo.apiKey": "your-api-key",
  
  // LM Studio (local)
  "hanzo.llm.lmstudio.endpoint": "http://localhost:1234/v1",
  "hanzo.llm.lmstudio.model": "model-name",
  
  // Ollama (local)
  "hanzo.llm.ollama.endpoint": "http://localhost:11434",
  "hanzo.llm.ollama.model": "llama2",
  
  // OpenAI
  "hanzo.llm.openai.apiKey": "sk-...",
  "hanzo.llm.openai.model": "gpt-4",
  
  // Anthropic
  "hanzo.llm.anthropic.apiKey": "sk-ant-...",
  "hanzo.llm.anthropic.model": "claude-3-opus-20240229"
}
```

### 5. Agent Tool

The `agent` and `dispatch_agent` tools now support all configured LLM providers:

```typescript
// Single agent
@hanzo agent analyze the security of this codebase

// Multi-agent dispatch
@hanzo dispatch_agent implement user authentication with JWT
```

The agent tool will:
- Use the configured LLM provider
- Have access to specified MCP tools
- Execute tasks with proper context
- Support both sequential and parallel execution

### 6. Privacy with Local LLMs

For complete privacy, use LM Studio or Ollama:

1. **LM Studio**: Download from lmstudio.ai, load a model, start the server
2. **Ollama**: Install via `brew install ollama`, run `ollama pull llama2`

Then set `"hanzo.llm.provider": "lmstudio"` or `"ollama"` in settings.

## Installation

1. Install the VSIX: `code --install-extension dist/hanzoai-1.5.4.vsix`
2. Configure your preferred LLM provider in settings
3. Open VS Code chat (Ctrl+Alt+I)
4. Type `@hanzo` to start using the assistant

## Usage Examples

```
@hanzo show available tools
@hanzo read package.json
@hanzo search for TODO comments
@hanzo run the tests
@hanzo agent refactor this function to be more efficient
```

The assistant will use the configured LLM to understand your intent and execute the appropriate tools.