# MCP Tool Usage Examples

The `mcp` tool allows you to run arbitrary Model Context Protocol servers within the Hanzo extension.

## Basic Usage

### Add an MCP Server

```typescript
// Add a filesystem MCP server
mcp --action add --name fs-server --command "npx @modelcontextprotocol/server-filesystem" --args ["/home/user/documents"]

// Add a GitHub MCP server
mcp --action add --name github-server --command "npx @modelcontextprotocol/server-github" --env {"GITHUB_TOKEN": "your-token"}

// Add a Python MCP server
mcp --action add --name python-server --command "python" --args ["-m", "mcp.server.example"]

// Add a TCP-based MCP server
mcp --action add --name tcp-server --command "node tcp-server.js" --transport tcp --port 8080
```

### Start/Stop Servers

```typescript
// Start a server
mcp --action start --name fs-server

// Stop a server
mcp --action stop --name fs-server
```

### List Servers

```typescript
// List all configured servers
mcp --action list
```

### View Logs

```typescript
// View last 50 lines of logs (default)
mcp --action logs --name fs-server

// View last 100 lines
mcp --action logs --name fs-server --lines 100
```

### Remove Server

```typescript
// Remove a server configuration
mcp --action remove --name fs-server
```

## Advanced Examples

### Running Multiple MCP Servers

You can run multiple MCP servers simultaneously:

```typescript
// Add multiple servers
mcp --action add --name weather --command "npx @modelcontextprotocol/server-weather"
mcp --action add --name slack --command "npx @modelcontextprotocol/server-slack" --env {"SLACK_TOKEN": "xoxb-..."}
mcp --action add --name postgres --command "npx @modelcontextprotocol/server-postgres" --env {"DATABASE_URL": "postgresql://..."}

// Start all
mcp --action start --name weather
mcp --action start --name slack
mcp --action start --name postgres

// Check status
mcp --action list
```

### Using with Batch Tool

You can use the batch tool to manage multiple servers:

```typescript
batch --operations [
  {"tool": "mcp", "args": {"action": "add", "name": "server1", "command": "npx server1"}},
  {"tool": "mcp", "args": {"action": "add", "name": "server2", "command": "npx server2"}},
  {"tool": "mcp", "args": {"action": "start", "name": "server1"}},
  {"tool": "mcp", "args": {"action": "start", "name": "server2"}}
]
```

## Common MCP Servers

Here are some commonly used MCP servers you can add:

### Filesystem Server
```typescript
mcp --action add --name filesystem --command "npx @modelcontextprotocol/server-filesystem" --args ["/path/to/files"]
```

### GitHub Server
```typescript
mcp --action add --name github --command "npx @modelcontextprotocol/server-github" --env {"GITHUB_TOKEN": "ghp_..."}
```

### Slack Server
```typescript
mcp --action add --name slack --command "npx @modelcontextprotocol/server-slack" --env {"SLACK_TOKEN": "xoxb-...", "SLACK_TEAM_ID": "T..."}
```

### PostgreSQL Server
```typescript
mcp --action add --name postgres --command "npx @modelcontextprotocol/server-postgres" --env {"DATABASE_URL": "postgresql://user:pass@localhost/db"}
```

### Google Drive Server
```typescript
mcp --action add --name gdrive --command "npx @modelcontextprotocol/server-gdrive" --env {"GOOGLE_CREDENTIALS": "{...}"}
```

### Custom Python Server
```typescript
mcp --action add --name custom --command "python" --args ["/path/to/custom_mcp_server.py"]
```

## Troubleshooting

### Server Won't Start
- Check logs: `mcp --action logs --name server-name`
- Verify the command exists: Try running the command manually
- Check environment variables are set correctly

### Port Already in Use (TCP servers)
- Use a different port: `mcp --action add --name server --command "..." --transport tcp --port 8081`
- Find what's using the port: `lsof -i :8080`

### Server Crashes Immediately
- Check if all required environment variables are set
- Look for error messages in logs
- Try running the command manually to debug

## Security Considerations

- Store sensitive environment variables (tokens, passwords) securely
- Be cautious when running untrusted MCP servers
- Review server permissions and access controls
- Use anonymous mode (`--anon`) when testing untrusted servers