# Hanzo AI for VS Code

The ultimate toolkit for AI engineers. Access 200+ LLMs through one unified API, with symbol search, 4000+ MCP servers, and intelligent routing.

## Quick Start

1. **Login to Hanzo AI**
   ```
   @hanzo login
   ```
   This opens [iam.hanzo.ai](https://iam.hanzo.ai) in your browser

2. **Start Using AI**
   ```
   @hanzo agent solve this algorithm
   @hanzo agent --model claude-4 review my code
   @hanzo agent --model o3-pro explain this
   ```

## Key Features

### 🚀 200+ LLMs via [Hanzo AI](https://hanzo.ai)
- OpenAI (O3-Pro, O3, GPT-4o, GPT-4)
- Anthropic (Claude 4, Claude 3.5 Sonnet)
- Google (Gemini 2.0 Flash, Gemini Pro)
- Meta (Llama 3.1 405B, Llama 3.1 70B)
- DeepSeek V3, Mistral Large 2, and 190+ more

### 🔍 Symbol Search
Find any code element across your entire project:
```
@hanzo symbols "class UserController"
@hanzo symbols "function authenticate"
@hanzo symbols "interface Config"
```

### 🛠️ MCP Servers
Access 4000+ specialized tools:
```
@hanzo mcp --action install --package @modelcontextprotocol/server-github
@hanzo mcp --action call --tool github_search --args '{"query": "AI"}'
```

### 🧠 Legendary Modes
Code with the style of programming legends:
```
@hanzo mode carmack    # Game engine optimization
@hanzo mode norvig     # AI implementation patterns
@hanzo mode knuth      # Algorithm perfection
```

### 🌐 Browser Automation
Control browsers directly from VS Code:
```
@hanzo browser navigate https://example.com
@hanzo browser screenshot
@hanzo browser execute "document.title"
```

### 📊 Unified Search
Search across files, symbols, and git history:
```
@hanzo search "authentication flow"
@hanzo unified_search "TODO: implement"
```

## Commands

- `@hanzo login` - Login to Hanzo AI
- `@hanzo agent [prompt]` - Talk to AI models
- `@hanzo agent --model [model] [prompt]` - Use specific model
- `@hanzo symbols [query]` - Search for code symbols
- `@hanzo search [query]` - Search across all content
- `@hanzo mode [name]` - Activate legendary coding mode
- `@hanzo browser [action]` - Control browser
- `@hanzo mcp [options]` - Manage MCP servers

## Available Models

Access any model from:
- **OpenAI**: O3-Pro, O3, GPT-4o, GPT-4 Turbo, GPT-3.5
- **Anthropic**: Claude 4, Claude 3.5, Claude 3 (Opus/Sonnet/Haiku)
- **Google**: Gemini 2.0 Flash, Gemini Pro, Gemini Ultra
- **Meta**: Llama 3.1 (405B/70B/8B), CodeLlama
- **DeepSeek**: V3, Coder V2
- **Mistral**: Large 2, Medium, Mixtral 8x22B
- **And 190+ more models...**

## Configuration

The extension works out of the box after login. For advanced configuration:

1. **VS Code Settings** (`Cmd+,` or `Ctrl+,`)
   - Search for "Hanzo" to see all options
   - Configure enabled tools, API endpoints, etc.

2. **Environment Variables** (optional)
   ```bash
   export HANZO_API_KEY=hzo_...  # From iam.hanzo.ai
   ```

## Support

- 🌐 [Hanzo AI](https://hanzo.ai)
- 📖 [Documentation](https://docs.hanzo.ai)
- 💬 [Discord Community](https://discord.gg/hanzoai)
- 📧 [Support](mailto:support@hanzo.ai)

---

Built for engineers who ship.