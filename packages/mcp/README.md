# @hanzo/mcp

TypeScript implementation of Model Context Protocol (MCP) server with 40+ built-in tools for AI development.

## Features

- 📁 **File Operations**: Read, write, edit, move, delete, and manage files
- 🔍 **Advanced Search**: Grep, ripgrep, file finding, and unified search
- 💻 **Shell Integration**: Execute commands, manage background processes
- ✏️ **Smart Editing**: Single and multi-file editing with precise replacements
- 🌳 **Project Navigation**: Directory trees, file listing, and exploration
- 🧠 **AI Tools**: Think, critic, consensus, and agent delegation capabilities
- 🔎 **Vector Search**: LanceDB integration for multimodal embeddings
- 🌲 **AST Search**: Code intelligence with syntax-aware search
- 📋 **Todo Management**: Task tracking with priorities, tags, and projects
- 🎯 **Mode System**: Context-aware tool filtering and command palettes

## Installation

```bash
npm install -g @hanzo/mcp
```

## Usage

### As a CLI

```bash
# Start MCP server
hanzo-mcp serve

# Use with Claude Desktop
hanzo-mcp install-desktop
```

### As a Library

```typescript
import { createMCPServer } from '@hanzo/mcp';

const server = await createMCPServer({
  name: 'my-mcp-server',
  version: '1.0.0',
  customTools: [
    // Your custom tools
  ]
});

await server.start();
```

## Built-in Tools

### File Operations
- `read_file` - Read file contents
- `write_file` - Write or overwrite files  
- `edit_file` - Replace text in files
- `multi_edit` - Multiple edits in one operation
- `create_file` - Create new files
- `delete_file` - Delete files
- `move_file` - Move or rename files
- `list_files` - List directory contents
- `tree` - Show directory tree structure

### Search Tools
- `grep` - Pattern search with grep/ripgrep
- `find_files` - Find files by name pattern
- `search` - Unified search combining multiple strategies
- `ast_search` - AST-based code pattern search
- `find_symbol` - Find function/class definitions
- `analyze_dependencies` - Analyze import dependencies

### Shell Tools
- `bash` - Execute shell commands
- `shell` - Cross-platform shell execution
- `background_bash` - Run background processes
- `kill_process` - Terminate processes
- `list_processes` - List running processes

### AI Tools
- `think` - Structured reasoning space
- `critic` - Critical analysis tool
- `consensus` - Multi-model consensus
- `agent` - Delegate tasks to sub-agents

### Vector Search
- `vector_index` - Create vector indexes
- `vector_search` - Search with embeddings
- `vector_stats` - Vector database statistics

### Todo Management
- `todo_add` - Add new todo items
- `todo_list` - List and filter todos
- `todo_update` - Update todo status/details
- `todo_delete` - Delete todos
- `todo_stats` - Todo statistics and productivity

### Mode & Palette System
- `mode_switch` - Switch tool modes
- `mode_list` - List available modes
- `palette_select` - Select command palette
- `palette_list` - List palettes
- `mode_create` - Create custom modes
- `shortcut` - Execute palette shortcuts

## Modes

The MCP server supports different modes that filter available tools:

- **developer** - Full access to all tools
- **research** - Read-only exploration tools
- **editor** - File editing focused tools
- **terminal** - Shell and system operations
- **ai_assistant** - AI-powered assistance tools
- **project_manager** - Task and project management

## Configuration

### Environment Variables

```bash
# Vector search database path
HANZO_VECTOR_DB=/path/to/vector.db

# Todo storage path
HANZO_TODO_PATH=/path/to/todos.json

# AI Provider Keys (for AI tools)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
```

### Custom Tools

```typescript
import { Tool, createMCPServer } from '@hanzo/mcp';

const myTool: Tool = {
  name: 'my_tool',
  description: 'My custom tool',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    },
    required: ['input']
  },
  handler: async (args) => {
    return {
      content: [{
        type: 'text',
        text: `Processed: ${args.input}`
      }]
    };
  }
};

const server = await createMCPServer({
  customTools: [myTool]
});
```

## Integration with Claude Desktop

1. Install the MCP server:
```bash
npm install -g @hanzo/mcp
```

2. Configure Claude Desktop:
```bash
hanzo-mcp install-desktop
```

This adds the server to your Claude Desktop configuration at:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

## Development

```bash
# Clone the repository
git clone https://github.com/hanzoai/mcp.git
cd mcp

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode
npm run dev
```

## License

MIT © Hanzo AI