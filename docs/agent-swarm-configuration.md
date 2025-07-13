# Agent Swarm Configuration

The Hanzo Dev CLI supports sophisticated multi-agent configurations through YAML files, enabling teams of specialized AI agents to work together on complex tasks. The system supports both traditional swarm orchestration and cost-optimized peer networks powered by Hanzo Zen.

## Quick Start

1. Initialize an agent configuration:
```bash
dev swarm init
```

2. Run a task with the swarm:
```bash
dev swarm run "implement a new feature"
```

3. Check swarm status:
```bash
dev swarm status
```

## Configuration Structure

### Basic Agent Configuration

```yaml
version: 1
swarm:
  name: "My Agent Team"
  main: "lead"  # The main agent that receives initial tasks
  instances:
    lead:
      description: "Lead coordinator"
      directory: "."
      model: "opus"
      connections: ["agent1", "agent2"]  # Can delegate to these agents
      prompt: |
        Your role and responsibilities...
```

### Agent Properties

- **description**: Brief description of the agent's role
- **directory**: Working directory for the agent
- **model**: LLM model to use (opus, sonnet, haiku, gpt-4, etc.)
- **connections**: List of agents this agent can delegate to
- **vibe**: Enable vibes for Claude models
- **prompt**: System prompt defining the agent's behavior
- **allowed_tools**: Restrict which tools the agent can use
- **mcps**: MCP servers available to this agent
- **expose_as_mcp**: Expose this agent as an MCP server
- **mcp_port**: Port for the agent's MCP server
- **connect_to_agents**: Other agents to connect to via MCP

## Networks

Networks allow you to group agents and apply shared configurations:

```yaml
networks:
  development:
    name: "Development Team"
    agents: ["frontend", "backend", "tests"]
    mcp_enabled: true  # Enable MCP connections between all agents
    shared_tools: ["Read", "Grep"]  # Tools available to all agents
    shared_mcps:  # MCP servers available to all agents
      - name: "filesystem"
        type: "stdio"
        command: "npx"
        args: ["-y", "@modelcontextprotocol/server-filesystem"]
```

### Network Features

- **mcp_enabled**: Automatically creates MCP connections between all agents in the network
- **shared_tools**: Tools available to all agents in the network
- **shared_mcps**: MCP servers available to all agents in the network

## MCP Integration

### Agent as MCP Server

Agents can be exposed as MCP servers, allowing other agents to query them directly:

```yaml
architect:
  expose_as_mcp: true
  mcp_port: 8001  # Optional, auto-assigned if not specified
```

### Connecting to Other Agents

Agents can connect to other agents via MCP:

```yaml
reviewer:
  connect_to_agents: ["architect", "builder"]
```

This creates bidirectional communication channels between agents.

## Example Configurations

### Simple Team

```yaml
version: 1
swarm:
  name: "Simple Dev Team"
  main: "lead"
  instances:
    lead:
      description: "Lead developer"
      directory: "."
      model: "sonnet"
      connections: ["coder", "reviewer"]
      prompt: |
        Coordinate development work by delegating to specialists.
    
    coder:
      description: "Implementation specialist"
      directory: "./src"
      model: "haiku"
      allowed_tools: ["Read", "Edit", "Write"]
      prompt: |
        Implement clean, efficient code.
    
    reviewer:
      description: "Code reviewer"
      directory: "."
      model: "haiku"
      allowed_tools: ["Read", "Grep"]
      prompt: |
        Review code for quality and security.
```

### Rails Development Team

See `agents-rails-example.yaml` for a comprehensive Rails team with 10+ specialized agents.

### Recursive MCP Network

See `agents-recursive-mcp-example.yaml` for a fully connected agent network with bidirectional MCP communication.

## Delegation

Agents can delegate tasks to their connected agents using:

```
DELEGATE TO [agent_name]: [specific task]
```

Example:
```
DELEGATE TO [frontend]: Create a React component for user profile
DELEGATE TO [backend]: Implement the API endpoint for user data
```

## Running Tasks

### With Default Configuration

```bash
# Uses agents.yaml in current directory or .hanzo/agents.yaml
dev swarm run "build a todo app"
```

### With Custom Configuration

```bash
dev swarm run "refactor the authentication system" -c my-agents.yaml
```

### Running a Network

```bash
# Run task with agents in a specific network
dev swarm network development "add user authentication"
```

## Agent Communication

### Simplified Agent Communication

Each agent is exposed as a single tool to all other agents. This creates a clean, simple protocol:

**Tool Name**: The agent's name (e.g., `developer`, `architect`, `reviewer`)

**Tool Usage**:
```
Use: developer
Arguments: {
  "request": "Implement user authentication with JWT",
  "context": { "framework": "FastAPI", "database": "PostgreSQL" }
}
```

**Examples**:
- Simple request: `Use tool "architect" with request "Design the API structure"`
- With context: `Use tool "reviewer" with request "Review the login implementation" and context {"pr_number": 123}`
- Recursive: The called agent can call other agents in turn

### Shared MCP Tools

All agents have access to shared MCP servers configured at the swarm level:

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
      headless: true
```

**Available Shared Tools**:
- **github**: Create issues, PRs, review code
- **linear**: Manage tasks and projects
- **slack**: Send messages, create channels
- **playwright**: Automate web interactions
- **Custom MCPs**: Any additional MCP servers

**Standard Hanzo Tools** (always available):
- **read_file**: Read file content
- **write_file**: Write to files
- **search**: Search patterns in files
- **bash**: Execute shell commands

### Interactive Chat Sessions

Start an interactive chat between agents:

```bash
# Chat as project_manager with any agent
dev swarm chat

# Chat as tech_lead with designer
dev swarm chat -f tech_lead -t designer

# Use custom config
dev swarm chat -c agents-chat-example.yaml
```

In chat sessions:
- Type messages directly to chat with the specified agent
- Use `@agent_name message` to chat with a different agent
- Type `exit` to end the session

Example session:
```
🗨️  Agent Chat Session

Chatting as: project_manager
Type "@agent_name message" to chat with a specific agent
Type "exit" to end the session

project_manager> @tech_lead What's the status of the API refactoring?
tech_lead> The API refactoring is 70% complete. I've restructured the authentication 
and user management endpoints. Still working on the data processing APIs. Should be 
done by end of week.

project_manager> @designer Have you reviewed the new API structure?
designer> Yes, I've reviewed it. The new structure aligns well with our UI components. 
I particularly like the consistent error response format - it will help us create 
better user feedback.
```

## Peer Networks with Hanzo Zen

Peer networks provide a cost-optimized architecture where all agents can communicate with each other through MCP, with Hanzo Zen handling the main orchestration loop locally.

### Key Benefits

1. **90% Cost Reduction**: Use local Hanzo Zen for orchestration, only calling API-based LLMs when needed
2. **Full Connectivity**: Every agent can call every other agent recursively
3. **Flexible Deployment**: Run on laptop, mobile, or edge devices
4. **Smart Routing**: Orchestrator decides when to use local vs API models

### Peer Network Configuration

```yaml
swarm:
  network_type: "peer"
  local_llm:
    model: "hanzo-zen"
    endpoint: "http://localhost:8080"
  instances:
    orchestrator:
      model: "zen"  # Local Hanzo Zen
      connect_to_agents: ["architect", "developer", "reviewer"]
    architect:
      model: "opus"  # API-based for complex tasks
      expose_as_mcp: true
```

### Running Peer Networks

```bash
# Initialize peer network configuration
dev swarm init --peer-network

# Run with peer network and cost optimization
dev swarm run "build feature" --peer

# Include critic analysis
dev swarm run "refactor code" --peer --critic

# Use specific local LLM endpoint
dev swarm run "analyze" --peer --local-llm http://localhost:8080
```

### Cost Optimization Strategy

The peer network architecture optimizes costs by:

1. **Local Orchestration**: Main loop runs on free local Hanzo Zen
2. **Selective API Calls**: Only use expensive models for complex tasks
3. **Batching**: Group similar requests to minimize API calls
4. **Caching**: Reuse results from previous agent interactions
5. **Smart Routing**: Orchestrator decides optimal agent for each task

### Hanzo Zen Features

- **Model**: Mixture of Experts (MoE) architecture
- **Deployment**: Edge to exascale (1B-1T parameters)
- **Platforms**: Laptop, mobile, edge devices
- **Cost**: Free when running locally
- **Integration**: Full MCP tool support

## Best Practices

1. **Specialized Agents**: Create agents with focused responsibilities
2. **Clear Prompts**: Define clear roles and capabilities in prompts
3. **Directory Isolation**: Use separate directories for different concerns
4. **Tool Restrictions**: Limit tools based on agent responsibilities
5. **Network Organization**: Group related agents into networks
6. **MCP for Quick Queries**: Use MCP connections for status updates and quick questions
7. **Delegation for Complex Tasks**: Use delegation for multi-step tasks
8. **Cost Awareness**: Use local models for coordination, API models for expertise
9. **Recursive Limits**: Set appropriate recursion depths to prevent infinite loops
10. **Peer Communication**: Leverage full mesh connectivity wisely

## Troubleshooting

### Check Agent Status

```bash
dev swarm status
```

Shows:
- Active agents and their status
- Running MCP servers
- Recent task results

### Debug MCP Connections

MCP server logs are shown in stderr. Look for:
- `[agent-name] Agent MCP server started`
- Connection errors
- Task execution logs

### Common Issues

1. **Port Conflicts**: Ensure MCP ports are unique
2. **Model Availability**: Verify API keys for required models
3. **Directory Permissions**: Ensure agents have access to their directories
4. **Network Configuration**: Check agent names in network definitions