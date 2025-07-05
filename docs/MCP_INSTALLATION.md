# Hanzo MCP Installation Guide

The Hanzo Model Context Protocol (MCP) server provides powerful development tools and AI assistance across multiple platforms. This guide covers installation for all supported environments.

## Table of Contents
- [Features](#features)
- [Authentication](#authentication)
- [Claude Desktop](#claude-desktop)
- [Claude Code](#claude-code)
- [VS Code](#vs-code)
- [Cursor](#cursor)
- [Windsurf](#windsurf)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

## Features

The Hanzo MCP server provides 53+ tools including:
- **File Operations**: read, write, edit, multi_edit, directory_tree
- **Search & Analysis**: grep, search, symbols, git_search
- **Shell & System**: run_command, bash, open
- **Development**: todo_read, todo_write, think, critic
- **Database**: query, schema, vector store operations
- **Jupyter**: notebook support
- **And many more!**

## Authentication

By default, Hanzo MCP requires authentication with your Hanzo account to access cloud features. You have two options:

### Authenticated Mode (Default)
- Full access to all features including cloud services
- Sync across devices
- Access to vector database and cloud storage
- Team collaboration features

### Anonymous Mode
- No login required
- Local-only features
- Limited to file operations, search, and local tools
- No cloud features (database, vector store, etc.)

To run in anonymous mode, add `--anon` flag or set `HANZO_ANONYMOUS=true` in environment.

## Claude Desktop

### Quick Install

```bash
npx @hanzo/mcp@latest
```

This command will:
1. Install the MCP server
2. Configure Claude Desktop automatically
3. Set up your workspace

### Manual Installation

1. Install the package globally:
```bash
npm install -g @hanzo/mcp
```

2. Add to Claude Desktop config:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hanzo": {
      "command": "node",
      "args": ["~/.npm-global/lib/node_modules/@hanzo/mcp/server.js"],
      "env": {
        "HANZO_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

3. Restart Claude Desktop

### Anonymous Mode

To run without authentication:

```json
{
  "mcpServers": {
    "hanzo": {
      "command": "node",
      "args": ["~/.npm-global/lib/node_modules/@hanzo/mcp/server.js", "--anon"],
      "env": {
        "HANZO_WORKSPACE": "/path/to/workspace"
      }
    }
  }
}
```

## Claude Code

Claude Code configuration is similar to Claude Desktop. The config file location may vary:

1. Check for Claude Code config directory
2. Use the same installation process as Claude Desktop
3. Restart Claude Code after configuration

## VS Code

The Hanzo extension includes built-in MCP support:

### Installation

1. Install from VS Code Marketplace:
```bash
code --install-extension hanzoai.hanzoai
```

Or search for "Hanzo AI Context Manager" in the Extensions view.

2. The extension will automatically:
   - Set up MCP server
   - Handle authentication
   - Configure workspace

### Configuration

VS Code settings (`.vscode/settings.json`):

```json
{
  "hanzo.mcp.enabled": true,
  "hanzo.mcp.transport": "tcp",
  "hanzo.mcp.port": 3000,
  "hanzo.mcp.allowedPaths": ["/path/to/project"],
  "hanzo.ide": "cursor"  // or "copilot", "continue", "codium"
}
```

## Cursor

Cursor uses the same extension system as VS Code:

1. Open Cursor
2. Go to Extensions (Cmd/Ctrl + Shift + X)
3. Search for "Hanzo AI Context Manager"
4. Click Install
5. Configure in settings:

```json
{
  "hanzo.ide": "cursor",
  "hanzo.mcp.enabled": true
}
```

The extension will generate `.cursorrules` file with project context.

## Windsurf

Windsurf (Codeium) support:

1. Install the VS Code extension in Windsurf
2. Configure settings:

```json
{
  "hanzo.ide": "codium",
  "hanzo.mcp.enabled": true
}
```

The extension will generate `.windsurfrules` file.

## Configuration

### Environment Variables

- `HANZO_WORKSPACE` - Default workspace directory
- `HANZO_ANONYMOUS` - Set to 'true' for anonymous mode
- `MCP_TRANSPORT` - Transport method (stdio or tcp)
- `MCP_PORT` - Port for TCP transport (default: 3000)
- `HANZO_IAM_ENDPOINT` - Custom IAM endpoint (default: https://iam.hanzo.ai)

### Tool Configuration

Disable specific tools:
```json
{
  "env": {
    "HANZO_MCP_DISABLED_TOOLS": "tool1,tool2",
    "HANZO_MCP_DISABLE_WRITE_TOOLS": "true",
    "HANZO_MCP_DISABLE_SEARCH_TOOLS": "true"
  }
}
```

### Path Restrictions

Limit MCP access to specific paths:
```json
{
  "env": {
    "HANZO_MCP_ALLOWED_PATHS": "/home/user/projects,/home/user/documents"
  }
}
```

## Troubleshooting

### Authentication Issues

1. **First-time setup**: The server will open a browser for authentication
2. **Token expired**: Re-run the server, it will refresh automatically
3. **Logout**: Use `hanzo-mcp --logout` to clear credentials

### Common Problems

**Tools not appearing**:
- Restart the application after configuration
- Check the logs for errors
- Verify the server path is correct

**Permission denied**:
- Ensure the workspace path is accessible
- Check file permissions on config files

**Connection failed**:
- Verify the transport method matches your setup
- Check if the port is available (for TCP)
- Look for firewall issues

### Debug Mode

Enable debug logging:
```json
{
  "env": {
    "HANZO_DEBUG": "true"
  }
}
```

### Getting Help

- GitHub Issues: https://github.com/hanzoai/extension/issues
- Documentation: https://github.com/hanzoai/extension
- Discord: https://discord.gg/hanzo

## Security

- Authentication tokens are stored securely
- File access is restricted to allowed paths
- All cloud communications are encrypted
- Anonymous mode available for privacy

## Updates

The MCP server updates automatically when you update the npm package:

```bash
npm update -g @hanzo/mcp
```

Or reinstall:
```bash
npx @hanzo/mcp@latest
```