# Hanzo for JetBrains

The plugin (`ai.hanzo.intellij`, builds 233–243, `com.intellij.modules.platform`
only) is a tool window, AI symbol search, the "Ask Hanzo AI" action and Hanzo
IAM sign-in (`hanzo-jetbrains`, loopback PKCE). It registers Hanzo with no
JetBrains agent surface.

## Hanzo as an agent: the steps, done by hand

JetBrains AI Assistant keeps its MCP servers and its ACP agents in its own
settings and publishes no extension point a plugin could register either
through, so the plugin does not. A person adds both:

1. **MCP server** — Settings | Tools | AI Assistant | Model Context Protocol
   (MCP) → Add, paste, and set Level to global:

   ```json
   { "mcpServers": { "hanzo": { "command": "hanzo-mcp", "args": ["--transport", "stdio"] } } }
   ```

   The AI Chat then has every Hanzo tool. `browser` and `cdp` drive the
   person's own signed-in browser through the Hanzo browser extension.

2. **ACP agent** — AI Chat → ⋯ → Add Custom Agent opens `~/.jetbrains/acp.json`:

   ```json
   {
     "default_mcp_settings": { "use_custom_mcp": true },
     "agent_servers": { "Hanzo Dev": { "command": "npx", "args": ["-y", "@hanzo/dev", "acp"] } }
   }
   ```

   hanzo-mcp speaks MCP, not ACP, so the agent is Hanzo Dev, the same entry
   Zed takes (`hanzoai/dev` `docs/integration-zed.md`). `use_custom_mcp`
   (default true) hands it the MCP servers from step 1, hanzo-mcp included.
   Sign in to Dev in a terminal first; AI Assistant passes no credential.

Doing either from the plugin means writing those two files, which the person
also edits, and raising `pluginSinceBuild` past 243 to the IDEs that read
them. That is a product decision, not a patch.
