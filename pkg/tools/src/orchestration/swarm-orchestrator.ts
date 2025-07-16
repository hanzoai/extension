import { EventEmitter } from 'events';
import { AgentSwarmManager, AgentInstance, MCPServerConfig } from '../config/agent-swarm-config';
import { CLIToolManager } from '../cli-tool-manager';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface AgentTask {
  agentName: string;
  task: string;
  context?: any;
  dependencies?: string[];
}

interface AgentResult {
  agentName: string;
  result: string;
  error?: string;
  duration: number;
}

interface MCPServer {
  process: ChildProcess;
  config: MCPServerConfig;
}

interface AgentMCPServer {
  port: number;
  process: ChildProcess;
  agentName: string;
}

export class SwarmOrchestrator extends EventEmitter {
  private swarmManager: AgentSwarmManager;
  private toolManager: CLIToolManager;
  private activeAgents: Map<string, any> = new Map();
  private mcpServers: Map<string, MCPServer> = new Map();
  private agentMCPServers: Map<string, AgentMCPServer> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private basePort: number = 8000; // Base port for agent MCP servers

  constructor() {
    super();
    this.swarmManager = new AgentSwarmManager();
    this.toolManager = new CLIToolManager();
  }

  /**
   * Initialize the swarm orchestrator
   */
  async initialize(): Promise<void> {
    // Load agent configuration
    await this.swarmManager.loadConfig();
    
    // Initialize tool manager
    await this.toolManager.initialize();
    
    // Start MCP servers for all agents
    const agents = this.swarmManager.getAllAgents();
    for (const [name, agent] of Object.entries(agents)) {
      // Apply network configuration
      const configuredAgent = this.swarmManager.applyNetworkConfig(agent, name);
      
      // Start regular MCP servers
      if (configuredAgent.mcps && configuredAgent.mcps.length > 0) {
        await this.startMCPServers(name, configuredAgent.mcps);
      }
      
      // Start agent as MCP server if configured
      if (configuredAgent.expose_as_mcp) {
        await this.startAgentMCPServer(name, configuredAgent);
      }
    }
    
    // Connect agents to each other via MCP
    await this.connectAgentMCPServers();
  }

  /**
   * Start MCP servers for an agent
   */
  private async startMCPServers(agentName: string, mcps: MCPServerConfig[]): Promise<void> {
    for (const mcp of mcps) {
      const serverKey = `${agentName}-${mcp.name}`;
      
      try {
        const mcpProcess = spawn(mcp.command, mcp.args || [], {
          env: { ...process.env, ...mcp.env },
          stdio: mcp.type === 'stdio' ? ['pipe', 'pipe', 'pipe'] : 'inherit'
        });

        mcpProcess.on('error', (error) => {
          console.error(`MCP server ${serverKey} error:`, error);
          this.emit('mcp-error', { agentName, server: mcp.name, error });
        });

        mcpProcess.on('exit', (code) => {
          console.log(`MCP server ${serverKey} exited with code ${code}`);
          this.mcpServers.delete(serverKey);
        });

        this.mcpServers.set(serverKey, { process: mcpProcess, config: mcp });
        this.emit('mcp-started', { agentName, server: mcp.name });
      } catch (error) {
        console.error(`Failed to start MCP server ${serverKey}:`, error);
        this.emit('mcp-error', { agentName, server: mcp.name, error });
      }
    }
  }

  /**
   * Execute a task with the main agent
   */
  async executeTask(task: string, context?: any): Promise<AgentResult[]> {
    const mainAgentName = this.swarmManager.getMainAgent() ? 
      Object.keys(this.swarmManager.getAllAgents()).find(
        name => this.swarmManager.getAgent(name) === this.swarmManager.getMainAgent()
      ) : null;

    if (!mainAgentName) {
      throw new Error('No main agent configured');
    }

    // Clear previous results
    this.results.clear();

    // Execute with main agent
    const result = await this.executeAgentTask(mainAgentName, task, context);
    
    // Return all results including delegated tasks
    return Array.from(this.results.values());
  }

  /**
   * Execute a task with a specific agent
   */
  async executeAgentTask(
    agentName: string, 
    task: string, 
    context?: any
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const agent = this.swarmManager.getAgent(agentName);
    
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    this.emit('agent-start', { agentName, task });

    try {
      // Change to agent's directory
      const originalDir = process.cwd();
      if (agent.directory && agent.directory !== '.') {
        process.chdir(path.resolve(originalDir, agent.directory));
      }

      // Prepare agent prompt with context
      const fullPrompt = this.buildAgentPrompt(agent, task, context);

      // Get the appropriate tool for the model
      const tool = this.getToolForModel(agent.model);
      
      // Execute the task
      const result = await this.toolManager.runTool(tool, fullPrompt, {
        model: agent.model,
        cwd: process.cwd(),
        env: this.buildAgentEnvironment(agentName, agent)
      });

      // Change back to original directory
      process.chdir(originalDir);

      // Parse agent response for delegations
      const delegations = this.parseDelegations(result, agent);
      
      // Execute delegated tasks in parallel
      if (delegations.length > 0) {
        await this.executeDelegatedTasks(delegations, { 
          parentAgent: agentName,
          parentTask: task,
          context 
        });
      }

      const agentResult: AgentResult = {
        agentName,
        result,
        duration: Date.now() - startTime
      };

      this.results.set(agentName, agentResult);
      this.emit('agent-complete', agentResult);
      
      return agentResult;
    } catch (error) {
      const agentResult: AgentResult = {
        agentName,
        result: '',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      };

      this.results.set(agentName, agentResult);
      this.emit('agent-error', agentResult);
      
      return agentResult;
    }
  }

  /**
   * Build the full prompt for an agent
   */
  private buildAgentPrompt(agent: AgentInstance, task: string, context?: any): string {
    let prompt = agent.prompt + '\n\n';
    
    // Add context if provided
    if (context) {
      prompt += `## Context\n${JSON.stringify(context, null, 2)}\n\n`;
    }

    // Add task
    prompt += `## Task\n${task}\n\n`;

    // Simplified: Each agent is just one tool
    const allAgents = this.swarmManager.getAllAgents();
    const agentName = this.getAgentName(agent);
    
    prompt += `## Available Agents (as Tools)\n`;
    prompt += `Each agent is available as a single tool. Just use their name:\n\n`;
    
    for (const [name, otherAgent] of Object.entries(allAgents)) {
      if (name !== agentName) {
        prompt += `- **${name}**: ${otherAgent.description}\n`;
      }
    }
    
    prompt += `\nTo use an agent, call the tool with their name and your request.\n`;
    prompt += `Example: Use tool "developer" with request: "implement the login feature"\n\n`;

    // Add shared MCP tools if configured
    prompt += `## Shared Tools\n`;
    prompt += `- **read_file**: Read file content\n`;
    prompt += `- **write_file**: Write to file\n`;
    prompt += `- **search**: Search in files\n`;
    prompt += `- **bash**: Execute commands\n`;
    prompt += `- **github**: GitHub integration (if configured)\n`;
    prompt += `- **linear**: Linear project management (if configured)\n`;
    prompt += `- **slack**: Slack messaging (if configured)\n`;
    prompt += `- **playwright**: Web automation (if configured)\n\n`;

    prompt += `Agents can recursively call each other. Be mindful of recursion depth.\n`;

    return prompt;
  }

  /**
   * Get agent name from the swarm manager
   */
  private getAgentName(agent: AgentInstance): string {
    const agents = this.swarmManager.getAllAgents();
    for (const [name, a] of Object.entries(agents)) {
      if (a === agent) return name;
    }
    return 'unknown';
  }

  /**
   * Build environment variables for an agent
   */
  private buildAgentEnvironment(agentName: string, agent: AgentInstance): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      AGENT_NAME: agentName,
      AGENT_MODEL: agent.model,
      AGENT_DIR: agent.directory
    };

    // Add MCP server endpoints if available
    const mcpServers = Array.from(this.mcpServers.entries())
      .filter(([key]) => key.startsWith(`${agentName}-`));
    
    if (mcpServers.length > 0) {
      env.MCP_SERVERS = mcpServers.map(([key]) => key).join(',');
    }

    return env;
  }

  /**
   * Get the appropriate tool for a model
   */
  private getToolForModel(model: string): string {
    const modelMap: Record<string, string> = {
      'opus': 'claude',
      'sonnet': 'claude',
      'haiku': 'claude',
      'gpt-4': 'codex',
      'gpt-3.5': 'codex',
      'gemini-pro': 'gemini',
      'gemini-ultra': 'gemini'
    };

    return modelMap[model.toLowerCase()] || 'claude';
  }

  /**
   * Parse agent response for delegation commands
   */
  private parseDelegations(response: string, agent: AgentInstance): AgentTask[] {
    if (!agent.connections || agent.connections.length === 0) {
      return [];
    }

    const delegations: AgentTask[] = [];
    const delegateRegex = /DELEGATE TO \[([^\]]+)\]: (.+?)(?=DELEGATE TO|$)/gs;
    
    let match;
    while ((match = delegateRegex.exec(response)) !== null) {
      const agentName = match[1].trim();
      const task = match[2].trim();
      
      if (agent.connections.includes(agentName)) {
        delegations.push({ agentName, task });
      }
    }

    return delegations;
  }

  /**
   * Execute delegated tasks in parallel
   */
  private async executeDelegatedTasks(
    tasks: AgentTask[], 
    context: any
  ): Promise<void> {
    const promises = tasks.map(task => 
      this.executeAgentTask(task.agentName, task.task, context)
    );
    
    await Promise.all(promises);
  }

  /**
   * Start an agent as an MCP server
   */
  private async startAgentMCPServer(agentName: string, agent: AgentInstance): Promise<void> {
    const port = agent.mcp_port || this.basePort++;
    
    try {
      // Create MCP server process for the agent
      const agentConfigJson = JSON.stringify(agent);
      const mcpServerPath = path.join(__dirname, 'agent-mcp-server.js');
      
      const mcpProcess = spawn('node', [
        mcpServerPath,
        agentName,
        agentConfigJson
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          AGENT_MCP_PORT: port.toString()
        }
      });

      mcpProcess.on('error', (error) => {
        console.error(`Agent MCP server ${agentName} error:`, error);
        this.emit('agent-mcp-error', { agentName, error });
      });

      mcpProcess.on('exit', (code) => {
        console.log(`Agent MCP server ${agentName} exited with code ${code}`);
        this.agentMCPServers.delete(agentName);
      });

      // Log stderr for debugging
      mcpProcess.stderr.on('data', (data) => {
        console.error(`[${agentName}] ${data.toString()}`);
      });

      this.agentMCPServers.set(agentName, {
        port,
        process: mcpProcess,
        agentName
      });

      this.emit('agent-mcp-started', { agentName, port });
    } catch (error) {
      console.error(`Failed to start agent MCP server for ${agentName}:`, error);
      this.emit('agent-mcp-error', { agentName, error });
    }
  }

  /**
   * Connect agents to each other via MCP
   */
  private async connectAgentMCPServers(): Promise<void> {
    const agents = this.swarmManager.getAllAgents();
    
    for (const [name, agent] of Object.entries(agents)) {
      const configuredAgent = this.swarmManager.applyNetworkConfig(agent, name);
      
      if (configuredAgent.connect_to_agents && configuredAgent.connect_to_agents.length > 0) {
        for (const targetAgent of configuredAgent.connect_to_agents) {
          const targetServer = this.agentMCPServers.get(targetAgent);
          if (targetServer) {
            // Create MCP client configuration for connecting to the target agent
            const mcpConfig: MCPServerConfig = {
              name: `agent-${targetAgent}`,
              type: 'stdio',
              command: 'node',
              args: [
                path.join(__dirname, 'agent-mcp-server.js'),
                targetAgent,
                JSON.stringify(this.swarmManager.getAgent(targetAgent))
              ],
              env: {
                AGENT_MCP_PORT: targetServer.port.toString(),
                AGENT_NAME: targetAgent
              }
            };
            
            // Store the MCP connection for this agent
            const connectionKey = `${name}-connects-to-${targetAgent}`;
            await this.startMCPServers(connectionKey, [mcpConfig]);
          }
        }
      }
    }
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    // Stop all MCP servers
    for (const [key, server] of this.mcpServers.entries()) {
      server.process.kill();
      this.mcpServers.delete(key);
    }

    // Stop all agent MCP servers
    for (const [key, server] of this.agentMCPServers.entries()) {
      server.process.kill();
      this.agentMCPServers.delete(key);
    }

    // Clear active agents
    this.activeAgents.clear();
    
    this.emit('shutdown');
  }

  /**
   * Get swarm status
   */
  getStatus(): {
    agents: Record<string, { status: string; directory: string; model: string }>;
    mcpServers: Record<string, { status: string; config: MCPServerConfig }>;
    results: AgentResult[];
  } {
    const agents: Record<string, any> = {};
    const allAgents = this.swarmManager.getAllAgents();
    
    for (const [name, agent] of Object.entries(allAgents)) {
      agents[name] = {
        status: this.activeAgents.has(name) ? 'active' : 'ready',
        directory: agent.directory,
        model: agent.model
      };
    }

    const mcpServers: Record<string, any> = {};
    for (const [key, server] of this.mcpServers.entries()) {
      mcpServers[key] = {
        status: server.process.exitCode === null ? 'running' : 'stopped',
        config: server.config
      };
    }

    return {
      agents,
      mcpServers,
      results: Array.from(this.results.values())
    };
  }
}