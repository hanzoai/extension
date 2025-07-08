# Dev CLI Examples

## Basic Usage

```bash
# Quick start
dev login
dev init

# Run any AI tool
dev run claude "write a Python web server"
dev run aider "fix the failing tests"
dev run gemini "explain this codebase"
```

## Multi-Agent Workflows

### Code Review
```bash
# Review current changes
dev review

# Review specific files
dev review src/api.js src/auth.js

# Deep security-focused review
dev workflow custom-review "$(git diff)"
```

### Feature Implementation
```bash
# Full feature implementation workflow
dev workflow implement-feature "add OAuth2 authentication"

# This runs:
# 1. Claude designs the architecture
# 2. Aider implements code + Codex writes tests + Gemini writes docs (parallel)
# 3. Claude & Gemini review the implementation
```

### Custom Multi-Agent Tasks
```bash
# Specify which tool handles what
dev multi "optimize database queries" \
  --coder claude \
  --reviewer gemini \
  --critic codex

# Mix local and cloud models
dev multi "refactor authentication system" \
  --coder local:codellama \
  --reviewer claude \
  --critic gemini
```

## Local LLM Integration

```bash
# Use Ollama (auto-detected)
dev run local-llm "explain this function" --model llama3

# Use specific local provider
dev multi "implement caching layer" \
  --local llama3:latest \
  --reviewer claude

# Configure custom local LLM
echo '{
  "providers": [{
    "name": "my-llm",
    "endpoint": "http://192.168.1.100:8080",
    "models": ["my-model"],
    "defaultModel": "my-model",
    "apiFormat": "openai"
  }]
}' > ~/.dev/local-llm.json

dev run local-llm "generate tests" --provider my-llm
```

## Async and Parallel Execution

```bash
# Long-running task in background
dev run claude "refactor entire codebase to TypeScript" --async
# Returns: Job ID: abc123...

# Check progress
dev status abc123

# Send additional instructions
dev input abc123 "focus on the API layer first"

# Run multiple agents in parallel branches
dev run claude "implement user service" --worktree &
dev run aider "implement auth service" --worktree &
dev run openhands "implement notification service" --worktree &

# Check all worktrees
dev worktree list
```

## Advanced Workflows

### Performance Optimization
```bash
dev workflow optimize "SELECT * FROM users WHERE created_at > '2024-01-01'"
# Claude and Codex analyze in parallel, then Aider implements the best solution
```

### Debugging
```bash
dev workflow debug "app crashes when processing large files"
# Multiple agents diagnose the issue from different angles
```

### Custom Workflow
```bash
# Create your own workflow
cat > ~/.dev/workflows/my-workflow.json << 'EOF'
{
  "name": "my-workflow",
  "description": "My custom workflow",
  "steps": [
    {
      "name": "analyze",
      "agents": [
        { "role": "architect", "tool": "claude" },
        { "role": "critic", "tool": "local-llm", "model": "llama3" }
      ],
      "parallel": true
    },
    {
      "name": "implement",
      "agents": [
        { "role": "coder", "tool": "aider" }
      ],
      "parallel": false
    }
  ]
}
EOF

dev workflow my-workflow "implement new feature"
```

## Tips and Tricks

```bash
# List all workflows
dev workflow list

# Compare all tools at once
dev compare "how would you implement a rate limiter?"

# Quick code review before commit
git add .
dev review  # Reviews staged changes
git commit -m "feat: add rate limiting"

# Use with git hooks
echo 'dev review --type quick' >> .git/hooks/pre-commit

# Pipe output to other tools
dev run claude "generate API spec" | swagger-cli validate

# Use in scripts
#!/bin/bash
for file in src/*.js; do
  dev review "$file" >> review-report.md
done
```