# Hanzo AI Extension - MCP Edition

A powerful VS Code extension that brings AI-enhanced development capabilities through the Model Context Protocol (MCP). Works seamlessly with VS Code, Cursor, Windsurf, and Claude Desktop.

## Features

- **55+ AI-Powered Tools**: Comprehensive toolset for file operations, search, web fetching, process management, and more
- **Multi-Platform Support**: Single codebase works across VS Code, Cursor, Windsurf, and Claude Desktop
- **Unified Search**: Parallel search across code, symbols, git history, and filenames
- **Smart Project Analysis**: Automatic codebase understanding and metrics
- **Background Process Management**: Run and monitor long-running tasks
- **Tool Palettes**: Context-aware tool sets for different development scenarios
- **Web Content Fetching**: Research documentation and APIs directly
- **Structured Thinking**: Built-in tools for planning and reasoning

## Installation

### VS Code / Cursor / Windsurf

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile the extension:
   ```bash
   npm run compile
   ```

3. Package the extension:
   ```bash
   npm run package
   ```

4. Install the `.vsix` file in your editor

### Claude Desktop

1. Build the MCP server:
   ```bash
   npm run build:mcp
   ```

2. Add to Claude Desktop configuration:
   ```json
   {
     "mcpServers": {
       "hanzo": {
         "command": "node",
         "args": ["/absolute/path/to/extension/out/mcp-server-standalone.js"],
         "env": {
           "HANZO_WORKSPACE": "/path/to/your/project"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

## Quick Start

### In VS Code/Cursor/Windsurf

1. Open Command Palette (`Cmd+Shift+P`)
2. Run "Hanzo: Analyze Project" to scan your codebase
3. Use "Hanzo: Show Analysis" to view insights

### In Claude Desktop

Simply ask Claude to use the tools:

```
Search for authentication-related code in the project
```

```
Create a comprehensive analysis of the codebase architecture
```

```
Find all TODO comments and create a task list
```

## Core Tools

### Search & Navigation
- `unified_search` - Parallel search across all dimensions
- `grep` - Pattern search with ripgrep
- `symbols` - Find functions, classes, methods
- `find_files` - Locate files by pattern

### File Operations
- `read` - Read file contents with pagination
- `write` - Create or overwrite files
- `edit` - Precise text replacement
- `multi_edit` - Multiple edits in one operation

### Development
- `todo` - Advanced task management
- `think` - Structured reasoning space
- `critic` - Code review and analysis
- `process` - Background task management

### Web & External
- `web_fetch` - Fetch and parse web content
- `open` - Open files/URLs in default apps

### Configuration
- `palette` - Switch tool contexts
- `rules` - Read project conventions
- `config` - Manage settings

## Tool Palettes

Pre-configured tool sets for different workflows:

- **Minimal**: Basic file operations only
- **Python**: Python development tools
- **JavaScript**: JS/TS development tools
- **DevOps**: System and deployment tools
- **Data Science**: Analysis and notebook tools

Activate a palette:
```json
{
  "action": "activate",
  "name": "python"
}
```

## Configuration

### VS Code Settings

```json
{
  "hanzo.analysis.enabled": true,
  "hanzo.analysis.autoAnalyze": true,
  "hanzo.analysis.excludePatterns": ["**/node_modules/**", "**/dist/**"],
  "hanzo.mcp.enabled": true,
  "hanzo.mcp.enabledTools": ["read", "write", "search"],
  "hanzo.auth.apiKey": "your-api-key"
}
```

### Environment Variables

```bash
# Core settings
HANZO_WORKSPACE=/path/to/project
HANZO_API_KEY=your-api-key

# Tool configuration
HANZO_MCP_ENABLED_TOOLS=read,write,search,unified_search
HANZO_MCP_DISABLED_TOOLS=db_query,vector_search

# Feature flags
HANZO_MCP_DISABLEWRITETOOLS=false
HANZO_MCP_DISABLESEARCHTOOLS=false
```

## Advanced Features

### Project Analysis

The extension automatically analyzes your codebase to understand:
- Technology stack and frameworks
- Code complexity and quality metrics
- Dependency relationships
- Common patterns and anti-patterns

### Background Processes

Run long-running tasks without blocking:

```json
{
  "action": "run",
  "command": "npm run build",
  "name": "build-process"
}
```

Monitor with:
```json
{
  "action": "logs",
  "id": "process-id",
  "tail": 50
}
```

### Web Research

Fetch documentation or API responses:

```json
{
  "url": "https://docs.example.com/api",
  "format": "text",
  "max_length": 10000
}
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Build MCP server
npm run build:mcp

# Package extension
npm run package
```

### Testing Tools

```bash
# Test MCP server
node out/mcp-server-standalone.js --version

# Test with sample workspace
node out/mcp-server-standalone.js --workspace ./test-project
```

### Debug Mode

1. Open project in VS Code
2. Press F5 to launch Extension Development Host
3. Test commands in the new window

## Architecture

```
extension/
├── src/
│   ├── extension.ts          # Main entry point
│   ├── mcp/
│   │   ├── server.ts         # MCP server integration
│   │   ├── tools/            # Tool implementations
│   │   └── prompts/          # AI prompts
│   ├── services/             # Core services
│   │   ├── AnalysisService.ts
│   │   ├── ProjectManager.ts
│   │   └── FileCollectionService.ts
│   └── auth/                 # Authentication
├── out/                      # Compiled JavaScript
└── docs/                     # Documentation
```

## Troubleshooting

### Extension not loading

1. Check VS Code version (requires 1.85.0+)
2. Verify compilation: `npm run compile`
3. Check extension logs: View > Output > Hanzo

### MCP tools not available in Claude

1. Verify server runs: `node out/mcp-server-standalone.js --help`
2. Check Claude Desktop config path
3. Restart Claude Desktop
4. Check Claude developer console for errors

### Search not finding results

1. Install ripgrep: `brew install ripgrep` (macOS)
2. Check file permissions
3. Verify git repository for git search

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Security

- All file operations respect workspace boundaries
- Shell commands run with limited permissions
- API keys stored securely in VS Code
- No telemetry or data collection

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Support

- Documentation: [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md)
- Issues: [GitHub Issues](https://github.com/hanzoai/extension/issues)
- Discord: [Hanzo Community](https://discord.gg/hanzo)

## Acknowledgments

- Built on the [Model Context Protocol](https://modelcontextprotocol.io)
- Inspired by the Python FastMCP framework
- Uses ripgrep for fast searching

---

Made with ❤️ by the Hanzo team