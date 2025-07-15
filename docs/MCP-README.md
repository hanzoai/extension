# Hanzo MCP Integration

This extension includes a full Model Context Protocol (MCP) server implementation, providing 65+ powerful tools for AI assistants.

## Features

### 🚀 Multi-Platform Support
- **VS Code/Cursor/Windsurf**: Native extension with integrated MCP server
- **Claude Desktop**: Standalone MCP server with one-click installation
- **Any MCP Client**: Standard MCP protocol support

### 🛠️ Available Tools

#### File System Operations
- `read` - Read file contents with pagination
- `write` - Create or overwrite files
- `edit` - Pattern-based file editing
- `multi_edit` - Batch edits to single files
- `directory_tree` - Visual directory structure
- `find_files` - Fast file finding

#### Search Capabilities
- `grep` - Fast pattern/regex search
- `search` - Unified multi-modal search
- `symbols` - Find code symbols
- `git_search` - Search git history
- `grep_ast` - AST-aware code search
- `batch_search` - Parallel search operations

#### Shell & Process Management
- `run_command` / `bash` - Execute shell commands
- `run_background` - Background processes
- `processes` - List running processes
- `pkill` - Terminate processes
- `open` - Open files/URLs
- `npx` / `uvx` - Run packages directly

#### Development Tools
- `todo_read` / `todo_write` - Task management
- `think` - Structured reasoning space
- `notebook_read` / `notebook_edit` - Jupyter support
- `neovim_edit` - Advanced editor integration

#### AI/Agent Capabilities
- `dispatch_agent` - Delegate to sub-agents
- `llm` - Query multiple LLM providers
- `consensus` - Multi-LLM consensus
- `batch` - Atomic multi-operation execution

## Installation

### For VS Code/Cursor/Windsurf
1. Install the Hanzo extension from marketplace
2. MCP server starts automatically
3. Configure via VS Code settings

### For Claude Desktop

#### Automatic Installation
```bash
# Build Claude Desktop package
npm run build:claude-desktop

# Run installer
./dist/claude-desktop/install.sh  # Mac/Linux
# or
./dist/claude-desktop/install.bat  # Windows
```

#### Manual Installation
1. Build the MCP server:
   ```bash
   npm run build:mcp
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "hanzo": {
         "command": "node",
         "args": ["/path/to/extension/dist/mcp-server.js"],
         "env": {
           "HANZO_WORKSPACE": "/path/to/workspace"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

## Configuration

### VS Code Settings
```json
{
  "hanzo.mcp.enabled": true,
  "hanzo.mcp.transport": "stdio",
  "hanzo.mcp.allowedPaths": ["/path/to/workspace"],
  "hanzo.mcp.disableWriteTools": false,
  "hanzo.mcp.enabledTools": ["read", "write", "search"],
  "hanzo.mcp.disabledTools": ["neovim_edit"]
}
```

### Environment Variables
- `MCP_TRANSPORT` - Transport method (stdio/tcp)
- `HANZO_WORKSPACE` - Default workspace path
- `HANZO_MCP_ALLOWED_PATHS` - Comma-separated allowed paths
- `HANZO_MCP_DISABLED_TOOLS` - Comma-separated disabled tools

## Security

- Path permissions restrict file access
- Write operations can be globally disabled
- Tool-level enable/disable controls
- Audit trails for all operations

## Development

### Running Locally
```bash
# Development mode with TCP transport
npm run dev:mcp

# Test with stdio transport
MCP_TRANSPORT=stdio node ./out/mcp-server-standalone.js
```

### Adding New Tools
1. Create tool in `src/mcp/tools/`
2. Export from category file
3. Register in `tools/index.ts`

## Troubleshooting

### Claude Desktop Not Finding Tools
1. Check Claude Desktop logs
2. Verify config file syntax
3. Ensure server path is absolute
4. Restart Claude Desktop

### Permission Errors
1. Add paths to `allowedPaths` config
2. Check file system permissions
3. Disable write tools if needed

## License

MIT - See LICENSE file