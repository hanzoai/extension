# MCP Universal Proxy Guide

The Hanzo MCP Universal Proxy allows you to install and use ANY Model Context Protocol (MCP) server through a single unified interface.

## Quick Start

```bash
# Install any MCP server
@hanzo mcp --action install --package @modelcontextprotocol/server-github

# List all capabilities
@hanzo mcp --action list

# Call any tool from any server
@hanzo mcp --action call --tool github_search --args '{"query": "typescript"}'
```

## Features

### 🚀 Auto-Installation
- **NPM packages**: Automatically installed via `npm`
- **Python packages**: Automatically installed via `uvx`
- **Smart detection**: Package type detected from naming conventions
- **Version tracking**: Keeps track of installed versions

### 🔌 Universal Proxy
- **Single interface**: One command for all MCP servers
- **Tool routing**: Automatically routes tool calls to correct server
- **Connection management**: Handles server lifecycle automatically
- **Error recovery**: Reconnects on failure

### 📦 Supported Servers

#### Official NPM Servers
```bash
# Browser automation
@hanzo mcp --action install --package @modelcontextprotocol/server-puppeteer
@hanzo mcp --action install --package @modelcontextprotocol/server-playwright

# Databases
@hanzo mcp --action install --package @modelcontextprotocol/server-sqlite
@hanzo mcp --action install --package @modelcontextprotocol/server-postgresql

# Development tools
@hanzo mcp --action install --package @modelcontextprotocol/server-github
@hanzo mcp --action install --package @modelcontextprotocol/server-filesystem

# Utilities
@hanzo mcp --action install --package @modelcontextprotocol/server-memory
@hanzo mcp --action install --package @modelcontextprotocol/server-fetch
```

#### Python Servers
```bash
# Version control
@hanzo mcp --action install --package mcp-server-git

# Communication
@hanzo mcp --action install --package mcp-server-slack
@hanzo mcp --action install --package mcp-server-discord

# Utilities
@hanzo mcp --action install --package mcp-server-time
@hanzo mcp --action install --package mcp-server-weather
```

## Usage Examples

### 1. GitHub Integration
```bash
# Install GitHub server
@hanzo mcp --action install --package @modelcontextprotocol/server-github

# Search repositories
@hanzo mcp --action call --tool github_search --args '{
  "query": "language:typescript stars:>1000",
  "max_results": 10
}'

# Create an issue
@hanzo mcp --action call --tool github_create_issue --args '{
  "repo": "owner/repo",
  "title": "Bug report",
  "body": "Description of the issue"
}'
```

### 2. Database Operations
```bash
# Install SQLite server
@hanzo mcp --action install --package @modelcontextprotocol/server-sqlite

# Query database
@hanzo mcp --action call --tool sqlite_query --args '{
  "database": "myapp.db",
  "query": "SELECT * FROM users WHERE active = 1"
}'

# Execute SQL
@hanzo mcp --action call --tool sqlite_execute --args '{
  "database": "myapp.db",
  "query": "INSERT INTO logs (message, timestamp) VALUES (?, ?)",
  "params": ["User login", "2024-01-20 10:30:00"]
}'
```

### 3. Browser Automation
```bash
# Install Playwright server
@hanzo mcp --action install --package @modelcontextprotocol/server-playwright

# Navigate and screenshot
@hanzo mcp --action call --tool playwright_navigate --args '{
  "url": "https://example.com"
}'

@hanzo mcp --action call --tool playwright_screenshot --args '{
  "path": "screenshot.png"
}'

# Extract content
@hanzo mcp --action call --tool playwright_extract --args '{
  "selector": "h1",
  "attribute": "textContent"
}'
```

### 4. Git Operations
```bash
# Install Git server (Python)
@hanzo mcp --action install --package mcp-server-git --type python

# Get repository status
@hanzo mcp --action call --tool git_status --args '{
  "repo_path": "/path/to/repo"
}'

# Commit changes
@hanzo mcp --action call --tool git_commit --args '{
  "repo_path": "/path/to/repo",
  "message": "feat: Add new feature"
}'
```

## Advanced Usage

### Force Reinstall
```bash
# Reinstall with latest version
@hanzo mcp --action install --package @modelcontextprotocol/server-github --force
```

### List Installed Servers
```bash
# Show all servers and their capabilities
@hanzo mcp --action list
```

Output:
```
# MCP Proxy Status

## Installed Servers

### github
- Package: `@modelcontextprotocol/server-github`
- Version: 1.0.0
- Type: npm
- Tools: 5
- Resources: 2
- Prompts: 1

## Available Tools
- `github_search` (github)
- `github_create_issue` (github)
- `github_create_pr` (github)
...
```

## How It Works

1. **Installation**
   - Creates isolated environment for each server
   - NPM servers: Installed in `node_modules` 
   - Python servers: Installed via `uvx`
   - Tracks versions and capabilities

2. **Discovery**
   - Connects to server on first use
   - Queries available tools/resources/prompts
   - Builds routing map for efficient dispatch

3. **Proxy Mechanism**
   - Single `mcp` tool handles all requests
   - Routes to appropriate server based on tool name
   - Manages server lifecycle (start/stop/restart)
   - Handles errors and reconnections

4. **Persistence**
   - Saves installed servers to VS Code storage
   - Remembers capabilities across sessions
   - Quick startup with cached information

## Troubleshooting

### Server Not Found
```bash
# Check if server is installed
@hanzo mcp --action list

# Reinstall if needed
@hanzo mcp --action install --package <package-name>
```

### Connection Issues
```bash
# Force reconnection by calling a tool
@hanzo mcp --action call --tool <tool-name>

# Or reinstall with force flag
@hanzo mcp --action install --package <package-name> --force
```

### Python Package Issues
Ensure `uvx` is installed:
```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Then install Python MCP servers
@hanzo mcp --action install --package mcp-server-git --type python
```

## Creating Your Own MCP Server

The proxy supports ANY MCP server that follows the protocol:

1. **NPM Package**: Name it `@yourscope/server-name` or `mcp-server-name`
2. **Python Package**: Name it `mcp-server-name` 
3. **Implement MCP protocol** with stdio transport
4. **Publish** to npm or PyPI

Then install with:
```bash
@hanzo mcp --action install --package your-package-name
```

## Security Considerations

- Servers run in isolated processes
- Each server has its own installation directory
- No shared state between servers
- Servers can only access what you explicitly provide

## Future Features

- [ ] Auto-discovery of tools from package name
- [ ] Parallel tool execution across servers
- [ ] Server health monitoring
- [ ] Resource usage tracking
- [ ] Custom server configurations
- [ ] Direct server management UI

---

The MCP Universal Proxy makes it easy to extend Hanzo AI with any MCP server, giving you access to unlimited capabilities through a single, unified interface!