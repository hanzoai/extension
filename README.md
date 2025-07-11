# Dev - Ship Up to 100X Faster with Parallel AI Agents 🚀

[![VS Code Extension CI/CD](https://github.com/hanzoai/dev/workflows/VS%20Code%20Extension%20CI%2FCD/badge.svg)](https://github.com/hanzoai/dev/actions/workflows/vscode-extension.yml)
[![JetBrains Plugin CI/CD](https://github.com/hanzoai/dev/workflows/JetBrains%20Plugin%20CI%2FCD/badge.svg)](https://github.com/hanzoai/dev/actions/workflows/jetbrains-plugin.yml)

**Run multiple AI agents in parallel. Zero wait time. Instant results.**

Dev orchestrates unlimited AI agents working simultaneously with unified memory across your entire codebase. 

## 🚀 What Makes Dev Fast

### ⚡ **Parallel Agent Execution**
- Run 10, 50, or 100+ AI agents simultaneously
- Each agent in isolated git worktrees
- No sequential waiting - everything runs in parallel

### 🧠 **Unified Memory Architecture**
- Entire codebase indexed and instantly searchable
- Persistent context across all sessions
- Cross-file intelligence and relationship mapping

### 🔗 **Cloud.Hanzo.AI Integration**
- Login and subscribe at cloud.hanzo.ai
- Access your enabled LLMs and MCP servers
- Use cloud-indexed repos and data
- Unified billing and usage tracking

## 🚀 Quick Start - Get Running in 2 Minutes

```bash
# Clone and setup
git clone https://github.com/hanzoai/dev.git
cd dev
make setup

# Login to Hanzo AI (opens browser)
make login
# OR use existing API key
export HANZO_API_KEY=hzo_... # from iam.hanzo.ai

# You're ready! Run any AI tool:
dev run claude "implement a REST API"
dev run aider "fix the failing tests" --auto-commit
dev run openhands "analyze this codebase" --worktree

# Multi-agent workflows
dev workflow code-review  # Review your changes
dev multi "optimize this function" --coder claude --reviewer gemini
```

## 🔥 See the Difference

### Traditional AI Workflow (Slow & Buggy)
```bash
# Ask AI to add auth...
# AI: "Here's the code" (with hallucinated imports)
# You: Debug for 30 minutes
# AI: Forgot context, suggests duplicate code
# You: More debugging...
# 2 hours later: Finally works
```

### Dev Workflow (Fast & Accurate)
```bash
dev enhance "Add JWT auth with refresh tokens"

# What happens:
# 1. Analyzes your auth patterns (5 sec)
# 2. Plans implementation across 5 files (3 sec)
# 3. Spawns parallel AIs:
#    - AI 1: Updates user model
#    - AI 2: Creates auth middleware  
#    - AI 3: Adds API endpoints
#    - AI 4: Writes tests
#    - AI 5: Updates docs
# 4. Consensus validation (10 sec)
# 5. You review PR
# Significantly faster than traditional workflows
```

## 📦 Installation Options

### Option 1: CLI Tool (@hanzo/dev) - Recommended for Quick Start
```bash
# Install globally
npm install -g @hanzo/dev

# Login with your Hanzo account
dev login

# Initialize in your project
dev init
```

### Option 2: VS Code Extension (Hanzo AI)
```bash
# Install from marketplace
code --install-extension hanzo-ai.hanzo-ai

# Or install .vsix locally
code --install-extension hanzo-ai-*.vsix
```

### Option 3: MCP Server (@hanzo/mcp)
```bash
# For Claude Desktop
npx @hanzo/mcp@latest
```

## 🎯 Core Features

### 🔐 Unified Authentication & API Management
```bash
# Login once, use everywhere
dev login

# All your API keys are synced and encrypted locally
# - OpenAI/Codex API keys
# - Anthropic/Claude API keys  
# - Google/Gemini API keys
# - Auto-passthrough to all tools
```

### 🤖 Run Any AI Tool
```bash
# Claude - Advanced reasoning and coding
dev run claude "refactor this authentication system"

# Aider - Git-aware pair programming
dev run aider "add test coverage" --auto-commit

# OpenHands - Autonomous software engineering
dev run openhands "implement user management" --worktree

# Codex - Code generation
dev run codex "generate a REST API client"

# Gemini - Multimodal AI
dev run gemini "analyze this architecture diagram"
```

### ⚡ Async Long-Running Tasks
```bash
# Start task in background (auto-quits after 5min idle)
dev run claude "migrate database to PostgreSQL" --async
# Output: Job ID: abc123...

# Check status
dev status abc123

# Keep alive and send more instructions
dev input abc123 "also add connection pooling"
```

### 🌳 Parallel Development with Git Worktrees
```bash
# Spawn multiple AI agents working in parallel
dev run claude "implement auth" --worktree
dev run aider "add tests" --worktree  
dev run openhands "write docs" --worktree

# Each runs in its own branch and directory
dev worktree list
```

### 🔄 Compare AI Tools
```bash
# See how different AIs approach the same problem
dev compare "optimize this database query"

# Output shows results from all tools side-by-side
```

### 🤝 Multi-Agent Workflows
```bash
# Code Review with Multiple Perspectives
dev review  # Reviews current git changes
dev review src/api.js src/auth.js  # Review specific files

# Run Predefined Workflows
dev workflow code-review "review this PR #123"
dev workflow implement-feature "add user authentication"
dev workflow optimize "improve database query performance"
dev workflow debug "fix memory leak in production"

# Custom Multi-Agent Tasks
dev multi "design a REST API" --coder claude --reviewer gemini --critic codex

# Use Local LLMs (Ollama, LM Studio, etc)
dev multi "refactor this code" --local llama3 --reviewer gemini
```

### 🏠 Local LLM Support
```bash
# Auto-detects local LLMs (Ollama, LocalAI, etc)
dev run local-llm "explain this code" --model llama3

# Configure custom endpoints
dev config local-llm --add my-server http://localhost:8080

# Mix local and cloud models
dev multi "implement feature" --coder local:codellama --reviewer claude
```

## 🛠️ Local Development

```bash
# Quick setup with Make
make setup    # Install everything
make dev      # Start dev mode
make test     # Run tests

# Manual setup
npm install
cd packages/dev && npm install && npm link
cd packages/mcp && npm install

# Run locally
dev --help
```

### Build from Source
```bash
# Build everything
make build

# Or individually:
npm run compile           # VS Code extension
cd packages/dev && npm run build  # CLI tool
cd packages/mcp && npm run build  # MCP server
```

## CI/CD

All extensions are automatically built and tested on push:
- VS Code extension tests run on Node.js 18
- JetBrains plugin tests run on Java 17
- Releases are created automatically for tagged versions

## 🏗️ Architecture

- **Dev CLI** (`@hanzo/dev`) - Command-line interface for all AI tools
- **Multi-Agent Orchestrator** - Intelligent task routing and parallel execution
- **Local LLM Manager** - Seamless integration with Ollama, LocalAI, etc
- **Hanzo AI Extension** - VS Code/JetBrains integration  
- **MCP Server** (`@hanzo/mcp`) - Model Context Protocol tools
- **Platform Sync** - Universal context and bi-directional file sync
- **Async Wrapper** - Long-running task management with idle detection

## 🧠 Intelligent Agent Assignment

Dev automatically assigns the right AI tool for each role:

- **Claude** - Architecture, complex reasoning, code review synthesis
- **Gemini** - Code review, documentation, multimodal tasks
- **Codex** - Code generation, optimization, critiques
- **Aider** - Git-aware coding, automated commits
- **OpenHands** - Autonomous feature implementation
- **Local LLMs** - Privacy-sensitive tasks, rapid iteration

## 🚀 Key Capabilities

- **Up to 100x faster** with parallel AI execution
- **Multiple AI models** working simultaneously
- **Unified memory** across your entire codebase
- **Git worktree support** for conflict-free development
- **Framework-aware** code generation

## 🌐 Landing Pages

### hanzo.app - Download Hub
Access Hanzo from any platform:
- **Desktop Apps**: Windows, macOS, Linux
- **Mobile Apps**: iOS, Android
- **Browser Extensions**: Chrome, Firefox, Edge, Safari  
- **IDE Extensions**: VS Code, JetBrains
- **CLI Tools**: Dev CLI, MCP Server
- **Cloud Platform**: cloud.hanzo.ai

Visit [hanzo.app](https://hanzo.app) to download.

### Local Preview
```bash
npm run preview
# Visit http://localhost:3000
```

### Deployment
```bash
npm run deploy         # Deploy to production
npm run deploy:preview # Deploy preview
```

## 🔗 Links

🚀 **[Login to Hanzo AI](https://iam.hanzo.ai)** | 🌐 **[Hanzo AI](https://hanzo.ai)** | 📖 **[Docs](https://docs.hanzo.ai)** | 💬 **[Discord](https://discord.gg/hanzoai)** | 📱 **[Download Apps](https://hanzo.app)**

---

Built with ❤️ for engineers who ship fast.