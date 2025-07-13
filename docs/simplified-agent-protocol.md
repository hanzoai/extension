# Simplified Agent Protocol

## Core Principle

Each agent is exposed as a single tool to all other agents. No complex multi-tool interfaces - just one tool per agent that accepts requests.

## Protocol Design

### Agent as Tool

```typescript
// Each agent exposes exactly one tool
{
  name: "developer",  // The agent's name IS the tool
  description: "Senior developer for implementation",
  inputSchema: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "Your request to this agent"
      },
      context: {
        type: "object", 
        description: "Optional context"
      }
    },
    required: ["request"]
  }
}
```

### Using Agents

```python
# Simple request
use_tool("architect", {
  "request": "Design a scalable API for user management"
})

# With context
use_tool("developer", {
  "request": "Implement the user service",
  "context": {
    "language": "Python",
    "framework": "FastAPI",
    "requirements": ["JWT auth", "PostgreSQL"]
  }
})

# The developer can recursively call other agents
# Inside developer's execution:
use_tool("reviewer", {
  "request": "Review my implementation of user service",
  "context": {"code_path": "/src/services/user.py"}
})
```

## Shared MCP Tools

All agents have access to the same set of MCP tools:

### Configuration

```yaml
swarm:
  shared_mcps:
    github:
      enabled: true
      token: "${GITHUB_TOKEN}"
    linear:
      enabled: true
      apiKey: "${LINEAR_API_KEY}"
    slack:
      enabled: true
      token: "${SLACK_TOKEN}"
    playwright:
      enabled: true
    custom:
      - name: "postgres"
        type: "stdio"
        command: "npx"
        args: ["-y", "@modelcontextprotocol/server-postgres"]
```

### Available to All Agents

1. **Standard Hanzo Tools**:
   - `read_file` - Read files
   - `write_file` - Write files
   - `search` - Search in codebase
   - `bash` - Execute commands

2. **GitHub MCP** (when enabled):
   - Create/update issues
   - Create/review PRs
   - Manage repositories

3. **Linear MCP** (when enabled):
   - Create/update tasks
   - Manage projects
   - Track progress

4. **Slack MCP** (when enabled):
   - Send messages
   - Create channels
   - Post updates

5. **Playwright MCP** (when enabled):
   - Navigate web pages
   - Click elements
   - Fill forms
   - Take screenshots

## Recursion and Networking

### Recursive Calls

Agents can call each other recursively:

```
coordinator -> architect -> developer -> reviewer
                    ↓           ↓           ↓
                  tester    architect    developer
```

### Network Effects

- Every agent sees every other agent
- No explicit connection configuration needed
- Natural delegation through tool calls
- Recursion depth limits prevent infinite loops

## Benefits

1. **Simplicity**: One tool per agent, clear mental model
2. **Flexibility**: Any agent can call any other agent
3. **Extensibility**: Easy to add new agents or MCP servers
4. **Cost Efficiency**: Hanzo Zen orchestrates locally
5. **Tool Sharing**: All agents access the same MCP tools

## Example Flow

```yaml
# User request to coordinator
"Create a GitHub issue and implement the fix"

# Coordinator uses tools:
1. github: Create issue #123
2. architect: "Design solution for issue #123"
   
   # Architect uses tools:
   - read_file: Analyze current code
   - developer: "Implement fix for issue #123"
   
     # Developer uses tools:
     - write_file: Implement changes
     - bash: Run tests
     - reviewer: "Review my fix"
     
       # Reviewer uses tools:
       - read_file: Review changes
       - github: Comment on PR

3. github: Create PR with fix
4. slack: Notify team about completion
```

## Implementation

Each agent receives:
1. Access to all other agents as tools
2. Access to all shared MCP servers
3. Access to standard Hanzo tools
4. Their own prompt and context

The orchestrator (Hanzo Zen) manages:
1. Tool routing between agents
2. Recursion depth tracking
3. Cost optimization (local vs API calls)
4. Result aggregation