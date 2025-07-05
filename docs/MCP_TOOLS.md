# Hanzo MCP Tools Documentation

This document provides comprehensive documentation for all tools available in the Hanzo VS Code extension with Model Context Protocol (MCP) support.

## Overview

The Hanzo extension provides 55+ tools across multiple categories to enhance AI-assisted development. These tools work seamlessly with VS Code, Cursor, Windsurf, and Claude Desktop.

## Tool Categories

### 1. File System Operations

#### `read`
Read the contents of a file with optional pagination.
```json
{
  "path": "src/index.ts",    // File path (absolute or relative)
  "offset": 0,               // Line offset (optional)
  "limit": 100               // Number of lines to read (optional)
}
```

#### `write`
Write content to a file (creates if doesn't exist).
```json
{
  "path": "src/new-file.ts",
  "content": "// File content here"
}
```

#### `edit`
Edit a file by replacing exact text patterns.
```json
{
  "path": "src/index.ts",
  "old_text": "const oldValue = 1",
  "new_text": "const newValue = 2",
  "replace_all": false       // Replace all occurrences (optional)
}
```

#### `multi_edit`
Make multiple edits to a file in one atomic operation.
```json
{
  "path": "src/index.ts",
  "edits": [
    {
      "old_text": "import old from 'old'",
      "new_text": "import new from 'new'"
    },
    {
      "old_text": "const x = 1",
      "new_text": "const x = 2"
    }
  ]
}
```

#### `directory_tree`
Display directory structure as a tree.
```json
{
  "path": "src",             // Directory path
  "max_depth": 3,            // Maximum depth (optional)
  "show_hidden": false,      // Show hidden files (optional)
  "ignore_patterns": ["node_modules", "*.log"]  // Patterns to ignore
}
```

#### `find_files`
Find files matching a pattern.
```json
{
  "pattern": "**/*.ts",      // Glob pattern
  "path": "src",             // Search path (optional)
  "max_results": 50          // Maximum results (optional)
}
```

### 2. Search Operations

#### `unified_search`
Comprehensive parallel search across code, symbols, git history, and filenames.
```json
{
  "query": "authentication",
  "include": ["grep", "symbol", "git", "filename"],  // Search types
  "file_pattern": "*.ts",    // File filter (optional)
  "max_results": 20          // Max results per type
}
```

#### `grep`
Search for patterns in files using ripgrep.
```json
{
  "pattern": "TODO",         // Search pattern (regex)
  "path": "src",             // Search path (optional)
  "include": "*.ts",         // Include pattern (optional)
  "case_sensitive": false    // Case sensitivity (optional)
}
```

#### `search`
Unified search across files, symbols, and git history.
```json
{
  "query": "handleAuth",
  "type": "all",             // all, files, symbols, git
  "max_results": 30
}
```

#### `symbols`
Search for code symbols (functions, classes, etc.).
```json
{
  "query": "Controller",     // Symbol name pattern
  "kind": "class",           // Symbol kind filter (optional)
  "in_file": "src/**/*.ts"   // File pattern (optional)
}
```

### 3. Shell & System Operations

#### `run_command`
Execute a shell command with timeout support.
```json
{
  "command": "npm test",
  "cwd": ".",                // Working directory (optional)
  "timeout": 30000,          // Timeout in ms (optional)
  "shell": true              // Use shell (optional)
}
```

#### `process`
Unified process management with background execution.
```json
{
  "action": "run",           // run, list, kill, logs, clean
  "command": "npm run dev",  // Command for run action
  "name": "dev-server",      // Process name (optional)
  "id": "uuid",              // Process ID for kill/logs
  "tail": 50                 // Lines to tail for logs
}
```

#### `open`
Open a file or URL in the default application.
```json
{
  "target": "https://docs.hanzo.ai",  // File path or URL
  "wait": false              // Wait for app to close (optional)
}
```

### 4. Development Tools

#### `todo` (Unified)
Comprehensive todo management.
```json
{
  "action": "read",          // read, write, add, update, delete, clear
  "task": "Implement auth",  // Task content for add
  "tasks": [{                // Tasks array for write
    "id": "1",
    "content": "Task content",
    "status": "pending",     // pending, in_progress, completed
    "priority": "high"       // high, medium, low
  }],
  "id": "1",                 // Task ID for update/delete
  "status": "pending",       // Filter by status for read
  "priority": "high"         // Filter by priority
}
```

#### `think`
Structured thinking and reasoning space.
```json
{
  "thought": "Breaking down the authentication flow...",
  "category": "analysis",    // analysis, planning, debugging, design, reflection, hypothesis
  "metadata": {              // Additional context (optional)
    "component": "auth",
    "complexity": "high"
  }
}
```

#### `critic`
Critical analysis and code review.
```json
{
  "code": "function auth() { ... }",  // Code to review
  "file": "src/auth.ts",     // Or file path to review
  "aspect": "security"       // security, performance, readability, correctness, all
}
```

### 5. Configuration & Project Tools

#### `palette`
Tool palette management for context switching.
```json
{
  "action": "list",          // list, activate, show, create
  "name": "python",          // Palette name
  "tools": ["read", "write"], // Tools for create action
  "environment": {           // Environment vars for create
    "PYTHON_VERSION": "3.9"
  }
}
```

Built-in palettes:
- `minimal`: Basic file operations
- `python`: Python development tools
- `javascript`: JavaScript/TypeScript tools
- `devops`: DevOps and system tools
- `data-science`: Data analysis tools

#### `rules`
Read project rules and conventions.
```json
{
  "path": ".",               // Project path (optional)
  "format": "full"           // full, summary, list
}
```

Searches for:
- `.cursorrules`
- `.claude_instructions`
- `.continuerules`
- `CONVENTIONS.md`
- `CONTRIBUTING.md`
- And more...

#### `config`
Git-style configuration management.
```json
{
  "action": "get",           // get, set, list, unset
  "key": "hanzo.theme",      // Config key
  "value": "dark",           // Value for set action
  "global": false            // Global vs workspace config
}
```

### 6. Web & External Tools

#### `web_fetch`
Fetch and extract content from web URLs.
```json
{
  "url": "https://api.example.com/data",
  "method": "GET",           // HTTP method
  "headers": {               // HTTP headers (optional)
    "Authorization": "Bearer token"
  },
  "body": "{}",              // Request body for POST/PUT
  "format": "text",          // text, json, raw, metadata
  "max_length": 50000        // Max content length
}
```

### 7. AI & Advanced Tools

#### `dispatch_agent` (Planned)
Delegate tasks to specialized sub-agents.
```json
{
  "task": "Analyze this codebase for security issues",
  "context": {},             // Additional context
  "tools": ["read", "grep"], // Tools available to agent
  "max_iterations": 10       // Max agent iterations
}
```

#### `llm` (Planned)
Direct LLM integration for complex reasoning.
```json
{
  "prompt": "Explain this code",
  "model": "gpt-4",          // Model selection
  "temperature": 0.7,        // Generation parameters
  "max_tokens": 1000
}
```

### 8. Jupyter & Notebook Support

#### `notebook_read`
Read Jupyter notebook contents.
```json
{
  "path": "analysis.ipynb",
  "cell_id": "cell-123",     // Specific cell (optional)
  "include_outputs": true    // Include cell outputs
}
```

#### `notebook_edit`
Edit Jupyter notebook cells.
```json
{
  "path": "analysis.ipynb",
  "cell_id": "cell-123",
  "content": "print('Hello')",
  "cell_type": "code"        // code or markdown
}
```

### 9. Database Tools (Planned)

#### `db_query`
Execute database queries.
```json
{
  "connection": "postgres://...",
  "query": "SELECT * FROM users",
  "params": [],              // Query parameters
  "limit": 100               // Result limit
}
```

### 10. Vector Search (Planned)

#### `vector_search`
Semantic search using embeddings.
```json
{
  "query": "authentication flow",
  "index": "codebase",       // Vector index name
  "top_k": 10,               // Number of results
  "threshold": 0.7           // Similarity threshold
}
```

## Tool Configuration

### Environment Variables

Configure tools via environment variables:

```bash
# Workspace directory
HANZO_WORKSPACE=/path/to/project

# Tool configuration
HANZO_MCP_ENABLED_TOOLS=read,write,search,unified_search
HANZO_MCP_DISABLED_TOOLS=db_query,vector_search

# Feature flags
HANZO_MCP_DISABLEWRITETOOLS=false
HANZO_MCP_DISABLESEARCHTOOLS=false
```

### VS Code Settings

Configure in `.vscode/settings.json`:

```json
{
  "hanzo.mcp.enabled": true,
  "hanzo.mcp.enabledTools": ["read", "write", "unified_search"],
  "hanzo.mcp.disabledTools": ["db_query"],
  "hanzo.mcp.disableWriteTools": false,
  "hanzo.mcp.disableSearchTools": false
}
```

## Claude Desktop Integration

### Installation

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
         "args": ["/path/to/extension/out/mcp-server-standalone.js"],
         "env": {
           "HANZO_WORKSPACE": "/path/to/your/project"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

### Usage in Claude

Once configured, you can use tools directly:

```
Please search for "authentication" across the codebase
```

Claude will automatically use the `unified_search` tool.

## Best Practices

1. **Use Unified Search First**: The `unified_search` tool provides the most comprehensive results by searching across multiple dimensions in parallel.

2. **Leverage Palettes**: Switch tool palettes based on your current task (Python development, DevOps, etc.).

3. **Think Before Acting**: Use the `think` tool to plan complex operations before executing them.

4. **Batch Operations**: Use `multi_edit` for multiple file changes and `batch` for multiple tool operations.

5. **Background Processes**: Use the `process` tool for long-running operations to avoid blocking.

6. **Project Rules**: Always check `rules` tool output to understand project conventions.

## Error Handling

All tools provide structured error messages:

```json
{
  "error": "File not found",
  "details": "The file 'src/missing.ts' does not exist",
  "suggestion": "Use 'find_files' to search for similar files"
}
```

## Performance Considerations

- File operations are limited to reasonable sizes (default 2MB)
- Search operations have result limits to prevent overwhelming output
- Background processes are managed with resource limits
- Vector operations are chunked for large codebases

## Security

- File operations respect `.gitignore` and workspace boundaries
- Shell commands run with limited permissions
- Web fetch validates URLs and has timeout protection
- No operations outside the workspace without explicit paths

## Troubleshooting

### Tools not appearing in Claude Desktop

1. Check the MCP server is running:
   ```bash
   node out/mcp-server-standalone.js --help
   ```

2. Verify configuration in Claude Desktop settings

3. Check logs in Claude Desktop developer console

### Search not finding results

1. Ensure `ripgrep` is installed for grep operations
2. Check file permissions in the workspace
3. Verify git repository for git search features

### Process management issues

1. Check process logs in `~/.hanzo/logs/`
2. Use `process action:clean` to clean up stale processes
3. Verify shell permissions for command execution