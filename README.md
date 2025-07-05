# Hanzo AI

[![VS Code Extension CI/CD](https://github.com/hanzoai/extension/workflows/VS%20Code%20Extension%20CI%2FCD/badge.svg)](https://github.com/hanzoai/extension/actions/workflows/vscode-extension.yml)
[![JetBrains Plugin CI/CD](https://github.com/hanzoai/extension/workflows/JetBrains%20Plugin%20CI%2FCD/badge.svg)](https://github.com/hanzoai/extension/actions/workflows/jetbrains-plugin.yml)

The ultimate toolkit for AI engineers. 

## What You Get

- **200+ LLMs via [Hanzo AI](https://hanzo.ai)** - Every model in one unified API
- **4000+ MCP Servers** - Install ANY MCP server with one command
- **Symbol Search** - Find classes, functions, variables across all projects
- **Universal MCP Proxy** - Auto-install via npm/uvx and proxy all calls  
- **45+ Legendary Modes** - Code like Carmack, think like Norvig
- **Unlimited Memory** - Vector/graph/relational/symbol search
- **Browser Automation** - Built-in Playwright for web tasks
- **Team Collaboration** - Shared context and credits

## Quick Start

```bash
# VS Code / Cursor / Windsurf
Install hanzoai-*.vsix

# Claude Code
Drag hanzoai-*.dxt

# JetBrains IDEs (IntelliJ, PyCharm, WebStorm, etc.)
Install hanzo-ai-plugin.zip via Settings → Plugins → Install from Disk

# Terminal / Neovim
npx @hanzo/mcp@latest
```

## Use It

```bash
# Login to Hanzo AI
@hanzo login  # Opens iam.hanzo.ai in browser

# Or set API key directly
export HANZO_API_KEY=hzo_...  # from iam.hanzo.ai

# Talk to any model
@hanzo agent --model o3-pro solve this algorithm
@hanzo agent --model claude-4 review my code

# Activate legendary modes
@hanzo mode carmack    # Optimize like a game engine
@hanzo mode norvig     # AI implementation mastery

# Control browsers
@hanzo browser navigate https://example.com
@hanzo browser screenshot

# Search everything
@hanzo search "auth flow"

# Symbol search across projects
@hanzo symbols "class UserController"
@hanzo symbols "function authenticate"

# Install any MCP server
@hanzo mcp --action install --package @modelcontextprotocol/server-github
@hanzo mcp --action call --tool github_search --args '{"query": "MCP"}'
```

## Development

### VS Code Extension
```bash
npm install
npm run compile
npm test
vsce package  # Build VSIX
```

### JetBrains Plugin
```bash
cd jetbrains-plugin
./gradlew build
# Or with Docker:
./build-plugin-simple.sh
```

### Claude Code Extension
```bash
npm run build:dxt
```

## CI/CD

All extensions are automatically built and tested on push:
- VS Code extension tests run on Node.js 18
- JetBrains plugin tests run on Java 17
- Releases are created automatically for tagged versions

## Links

🚀 **[Login to Hanzo AI](https://iam.hanzo.ai)** | 🌐 **[Hanzo AI](https://hanzo.ai)** | 📖 **[Docs](https://docs.hanzo.ai)** | 💬 **[Discord](https://discord.gg/hanzoai)**

---

Built for engineers who ship.