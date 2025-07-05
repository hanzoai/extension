# Hanzo MCP Tools - Complete Breakdown

The Hanzo extension provides 53+ powerful tools organized into categories. All tools are accessible through VS Code's chat interface via `@hanzo`.

## 📁 File Operations (6 tools)

### Core File Tools
- **read** - Read any file with line numbers and syntax highlighting
- **write** - Create new files with content
- **edit** - Replace text in files with exact string matching
- **multi_edit** - Make multiple edits to a file in one operation
- **directory_tree** - Display directory structure with file sizes
- **find_files** - Find files by name pattern or content

## 🔍 Search & Analysis (8 tools)

### Search Tools
- **search** - Semantic search across the codebase
- **grep** - Pattern search using regular expressions
- **git_search** - Search through git history
- **symbols** - Find code symbols (functions, classes, variables)
- **unified_search** - Combined search across multiple sources
- **content_replace** - Find and replace across multiple files
- **diff** - Show differences between files or commits
- **web_fetch** - Fetch and analyze web content

## 💻 Shell & System (11 tools)

### Command Execution
- **bash** - Execute bash commands with environment
- **run_command** - Run any shell command
- **run_background** - Run commands in background
- **processes** - List running processes
- **pkill** - Kill processes by name/pattern
- **logs** - View and tail log files
- **npx** - Run Node.js packages
- **uvx** - Run Python packages with uv
- **open** - Open files/URLs in default application
- **process** - Advanced process management
- **mcp** - Run other MCP servers

## 🤖 AI & Intelligence (6 tools)

### AI Tools
- **agent** - AI agent for complex tasks (single or multi-agent)
- **llm** - Query LLM providers (Hanzo, OpenAI, Anthropic, local)
- **consensus** - Get consensus from multiple LLMs
- **llm_manage** - Manage LLM configurations
- **think** - Deep thinking and problem solving
- **critic** - Critical analysis and review

## 📝 Development Tools (6 tools)

### Task Management
- **todo_read** - Read task list
- **todo_write** - Write/update tasks
- **todo_unified** - Unified todo management
- **zen** - Zen mode for focused work
- **rules** - Manage IDE rules (.cursorrules, etc.)
- **config** - Configuration management

## 🗄️ Database & Storage (5 tools)

### Data Management
- **graph_db** - Graph database operations
- **vector_index** - Vector database indexing
- **vector_search** - Semantic vector search
- **vector_similar** - Find similar vectors
- **document_store** - Document storage and retrieval

## 📊 Jupyter & Notebooks (2 tools)

### Notebook Tools
- **notebook_read** - Read Jupyter notebooks
- **notebook_edit** - Edit Jupyter notebook cells

## 🎨 Configuration & Modes (3 tools)

### Environment Setup
- **mode** - Development modes (guido, linus, 10x, etc.)
- **palette** - VS Code command palette access
- **batch** - Batch operations on multiple tools

## 🔧 Utility Tools (6 tools)

### Helpers
- **sql_query** - Execute SQL queries
- **batch_search** - Batch search operations
- **editor** - Advanced editor operations
- **system** - System information and management
- **ast_analyzer** - AST code analysis (experimental)
- **treesitter_analyzer** - Tree-sitter analysis (experimental)

---

## 🚀 Development Modes

The **mode** tool provides preconfigured tool sets based on famous programmers and workflows:

### Language Creators
- **guido** - Guido van Rossum (Python) - "Readability counts"
- **linus** - Linus Torvalds (Linux) - "Talk is cheap. Show me the code."
- **brendan** - Brendan Eich (JavaScript) - "Always bet on JavaScript"

### Special Configurations
- **fullstack** - Frontend to backend, all common tools
- **minimal** - Essential tools only (read, write, edit, grep, bash)
- **10x** - Maximum productivity, all tools enabled
- **security** - Security-focused, read-only tools
- **data_scientist** - Jupyter, SQL, vector tools
- **hanzo** - Optimal Hanzo AI configuration

Example: `@hanzo mode activate 10x`

---

## 🤝 Agent Tool Usage

The unified **agent** tool supports both single and multi-agent workflows:

### Single Agent
```
@hanzo agent analyze security vulnerabilities
@hanzo agent --role "performance expert" optimize this function
@hanzo agent --tools ["read", "grep", "critic"] review this PR
```

### Multi-Agent (Default: Analyst → Developer → Reviewer)
```
@hanzo agent implement user authentication
@hanzo agent --agents [{"name": "Architect", "role": "Design the system"}] design a microservice
@hanzo agent --parallel analyze and fix all TODOs
```

### Model Selection
```
@hanzo agent --model gpt-4 complex reasoning task
@hanzo agent --model llama2 local analysis
@hanzo agent --model claude-3 creative writing
```

---

## 🔐 Privacy & Local LLMs

Configure local LLMs for complete privacy:

### LM Studio
```json
{
  "hanzo.llm.provider": "lmstudio",
  "hanzo.llm.lmstudio.endpoint": "http://localhost:1234/v1",
  "hanzo.llm.lmstudio.model": "codellama-13b"
}
```

### Ollama
```json
{
  "hanzo.llm.provider": "ollama",
  "hanzo.llm.ollama.endpoint": "http://localhost:11434",
  "hanzo.llm.ollama.model": "llama2"
}
```

---

## 📋 Common Workflows

### Code Analysis
```
@hanzo mode activate security
@hanzo agent analyze this codebase for vulnerabilities
@hanzo grep "TODO|FIXME|HACK"
@hanzo critic review recent changes
```

### Feature Development
```
@hanzo mode activate 10x
@hanzo agent implement feature: add dark mode toggle
@hanzo todo_write track progress
@hanzo git_search similar implementations
```

### Refactoring
```
@hanzo symbols find all UserService methods
@hanzo agent refactor UserService to use dependency injection
@hanzo diff show changes
@hanzo critic review refactoring
```

### Documentation
```
@hanzo agent document all public APIs
@hanzo grep "^export" in **/*.ts
@hanzo write API_DOCS.md with findings
```

---

## 🎯 Tool Categories Summary

1. **File Management** (6) - Read, write, edit files
2. **Search & Analysis** (8) - Find anything in code
3. **Shell & System** (11) - Execute commands, manage processes
4. **AI & Intelligence** (6) - LLMs, agents, thinking tools
5. **Development** (6) - Tasks, config, productivity
6. **Database** (5) - Vector, graph, document storage
7. **Notebooks** (2) - Jupyter integration
8. **Configuration** (3) - Modes, settings, batch ops
9. **Utilities** (6) - SQL, analysis, misc tools

Total: **53+ tools** available through `@hanzo` in VS Code!