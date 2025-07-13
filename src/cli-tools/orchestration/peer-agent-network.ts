import { EventEmitter } from 'events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { AgentInstance, AgentSwarmManager } from '../config/agent-swarm-config';
import { CLIToolManager } from '../cli-tool-manager';
import { HanzoAuth } from '../auth/hanzo-auth';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface LocalLLMConfig {
  model: string;
  endpoint?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentPeer {
  name: string;
  instance: AgentInstance;
  mcpServer: Server;
  process?: ChildProcess;
  port: number;
  status: 'starting' | 'ready' | 'busy' | 'error';
  connections: Set<string>;
}

export interface NetworkConfig {
  mainLoopLLM: LocalLLMConfig;
  enableRecursiveCalls: boolean;
  maxRecursionDepth: number;
  costOptimization: boolean;
}

export class PeerAgentNetwork extends EventEmitter {
  private peers: Map<string, AgentPeer> = new Map();
  private swarmManager: AgentSwarmManager;
  private toolManager: CLIToolManager;
  private auth: HanzoAuth;
  private networkConfig: NetworkConfig;
  private basePort: number = 10000;
  private recursionTracker: Map<string, number> = new Map();

  constructor(config: NetworkConfig) {
    super();
    this.networkConfig = config;
    this.swarmManager = new AgentSwarmManager();
    this.toolManager = new CLIToolManager();
    this.auth = new HanzoAuth();
  }

  /**
   * Initialize the peer network with all agents
   */
  async initialize(): Promise<void> {
    // Load agent configuration
    await this.swarmManager.loadConfig();
    
    // Check authentication for API-based LLMs
    if (!this.auth.isAuthenticated()) {
      console.warn('Not authenticated. Some LLM providers may not work.');
    }

    // Initialize all agents as peers
    const agents = this.swarmManager.getAllAgents();
    for (const [name, instance] of Object.entries(agents)) {
      await this.createAgentPeer(name, instance);
    }

    // Connect all peers to each other
    await this.establishPeerConnections();
    
    // Start the main orchestration loop with local LLM
    await this.startMainLoop();
  }

  /**
   * Create an agent peer with MCP server
   */
  private async createAgentPeer(name: string, instance: AgentInstance): Promise<void> {
    const port = instance.mcp_port || this.basePort++;
    
    // Create MCP server that exposes ALL other agents as tools
    const mcpServer = await this.createPeerMCPServer(name, instance, port);
    
    const peer: AgentPeer = {
      name,
      instance,
      mcpServer,
      port,
      status: 'starting',
      connections: new Set()
    };

    // Start the MCP server process
    const serverProcess = spawn('node', [
      path.join(__dirname, 'peer-mcp-server.js'),
      name,
      JSON.stringify({
        instance,
        port,
        peers: Array.from(this.peers.keys()),
        networkConfig: this.networkConfig
      })
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AGENT_NAME: name,
        AGENT_PORT: port.toString(),
        HANZO_AUTH: this.auth.getCredentials() ? JSON.stringify(this.auth.getCredentials()) : ''
      }
    });

    serverProcess.on('error', (error) => {
      console.error(`Peer ${name} error:`, error);
      peer.status = 'error';
      this.emit('peer-error', { name, error });
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[${name}] ${data.toString()}`);
    });

    peer.process = serverProcess;
    this.peers.set(name, peer);
    
    // Wait for peer to be ready
    await this.waitForPeerReady(name);
    peer.status = 'ready';
    
    this.emit('peer-ready', { name, port });
  }

  /**
   * Create MCP server that exposes all other agents
   */
  private async createPeerMCPServer(name: string, instance: AgentInstance, port: number): Promise<Server> {
    const server = new Server(
      {
        name: `peer-${name}`,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // This server will expose tools for ALL other agents
    return server;
  }

  /**
   * Establish connections between all peers
   */
  private async establishPeerConnections(): Promise<void> {
    const peerNames = Array.from(this.peers.keys());
    
    for (const sourcePeer of peerNames) {
      for (const targetPeer of peerNames) {
        if (sourcePeer !== targetPeer) {
          await this.connectPeers(sourcePeer, targetPeer);
        }
      }
    }
  }

  /**
   * Connect two peers bidirectionally
   */
  private async connectPeers(source: string, target: string): Promise<void> {
    const sourcePeer = this.peers.get(source);
    const targetPeer = this.peers.get(target);
    
    if (!sourcePeer || !targetPeer) return;
    
    sourcePeer.connections.add(target);
    targetPeer.connections.add(source);
    
    this.emit('peers-connected', { source, target });
  }

  /**
   * Start the main orchestration loop with local LLM
   */
  private async startMainLoop(): Promise<void> {
    console.log(`Starting main orchestration loop with ${this.networkConfig.mainLoopLLM.model}`);
    
    // The main loop uses Hanzo Zen or other local LLM for coordination
    // This saves costs by using local inference for orchestration
    this.emit('main-loop-started', this.networkConfig.mainLoopLLM);
  }

  /**
   * Execute a task through the peer network
   */
  async executeTask(task: string, options?: {
    startAgent?: string;
    maxHops?: number;
    requireCritic?: boolean;
  }): Promise<any> {
    const startAgent = options?.startAgent || this.swarmManager.getMainAgent();
    const maxHops = options?.maxHops || this.networkConfig.maxRecursionDepth;
    
    // Track recursion to prevent infinite loops
    const taskId = `${Date.now()}-${Math.random()}`;
    this.recursionTracker.set(taskId, 0);
    
    try {
      // Use local LLM to determine execution plan
      const executionPlan = await this.planExecution(task, startAgent);
      
      // Execute through peer network
      const results = await this.executePeerTask(
        taskId,
        startAgent,
        task,
        executionPlan,
        maxHops
      );
      
      // If critic is required, run final analysis
      if (options?.requireCritic) {
        const criticResult = await this.runCriticAnalysis(task, results);
        results.critic = criticResult;
      }
      
      return results;
    } finally {
      this.recursionTracker.delete(taskId);
    }
  }

  /**
   * Plan execution using local LLM (Hanzo Zen)
   */
  private async planExecution(task: string, startAgent: string): Promise<any> {
    // Use local LLM for planning to save costs
    const prompt = `
    Task: ${task}
    Available agents: ${Array.from(this.peers.keys()).join(', ')}
    Starting agent: ${startAgent}
    
    Create an execution plan that minimizes API calls while maximizing effectiveness.
    Consider which agents need to collaborate and in what order.
    `;
    
    // Call local Hanzo Zen model
    const plan = await this.callLocalLLM(prompt);
    return plan;
  }

  /**
   * Execute task through peer network with recursion support
   */
  private async executePeerTask(
    taskId: string,
    agentName: string,
    task: string,
    plan: any,
    maxHops: number
  ): Promise<any> {
    const recursionCount = this.recursionTracker.get(taskId) || 0;
    if (recursionCount >= maxHops) {
      return { error: 'Max recursion depth reached' };
    }
    
    this.recursionTracker.set(taskId, recursionCount + 1);
    
    const peer = this.peers.get(agentName);
    if (!peer) {
      return { error: `Agent ${agentName} not found` };
    }
    
    // Mark peer as busy
    peer.status = 'busy';
    
    try {
      // Execute with cost optimization
      const result = await this.executePeerWithCostOptimization(
        peer,
        task,
        plan,
        taskId
      );
      
      peer.status = 'ready';
      return result;
    } catch (error) {
      peer.status = 'error';
      throw error;
    }
  }

  /**
   * Execute peer task with cost optimization
   */
  private async executePeerWithCostOptimization(
    peer: AgentPeer,
    task: string,
    plan: any,
    taskId: string
  ): Promise<any> {
    const instance = peer.instance;
    
    // Determine if we should use local or API-based LLM
    const useLocalLLM = this.shouldUseLocalLLM(instance, task);
    
    if (useLocalLLM) {
      // Use Hanzo Zen for this agent to save costs
      return await this.executeWithLocalLLM(peer, task, plan);
    } else {
      // Use configured API-based LLM (Claude, OpenAI, etc.)
      return await this.executeWithAPILLM(peer, task, plan);
    }
  }

  /**
   * Determine if local LLM should be used based on task complexity
   */
  private shouldUseLocalLLM(instance: AgentInstance, task: string): boolean {
    if (!this.networkConfig.costOptimization) {
      return false;
    }
    
    // Use local LLM for:
    // - Simple routing decisions
    // - Status checks
    // - Basic queries
    // - Coordination tasks
    
    const simplePatterns = [
      /status/i,
      /check/i,
      /route/i,
      /coordinate/i,
      /plan/i,
      /summarize/i
    ];
    
    return simplePatterns.some(pattern => pattern.test(task));
  }

  /**
   * Execute with local Hanzo Zen LLM
   */
  private async executeWithLocalLLM(peer: AgentPeer, task: string, plan: any): Promise<any> {
    const prompt = this.buildPeerPrompt(peer, task, plan);
    return await this.callLocalLLM(prompt);
  }

  /**
   * Execute with API-based LLM
   */
  private async executeWithAPILLM(peer: AgentPeer, task: string, plan: any): Promise<any> {
    const tool = this.getToolForModel(peer.instance.model);
    const prompt = this.buildPeerPrompt(peer, task, plan);
    
    return await this.toolManager.runTool(tool, prompt, {
      model: peer.instance.model,
      cwd: peer.instance.directory,
      env: this.buildPeerEnvironment(peer)
    });
  }

  /**
   * Build prompt for peer execution
   */
  private buildPeerPrompt(peer: AgentPeer, task: string, plan: any): string {
    let prompt = peer.instance.prompt + '\n\n';
    
    // Add network context
    prompt += `## Network Context\n`;
    prompt += `You are part of a peer network with these agents:\n`;
    
    for (const [name, otherPeer] of this.peers) {
      if (name !== peer.name) {
        prompt += `- ${name}: ${otherPeer.instance.description}\n`;
        prompt += `  Tools: chat_with_${name}, ask_${name}, delegate_to_${name}, etc.\n`;
      }
    }
    
    prompt += `\n## Task\n${task}\n`;
    prompt += `\n## Execution Plan\n${JSON.stringify(plan, null, 2)}\n`;
    prompt += `\nYou can recursively call other agents as needed. All agents are available as MCP tools.\n`;
    
    return prompt;
  }

  /**
   * Build environment for peer execution
   */
  private buildPeerEnvironment(peer: AgentPeer): Record<string, string> {
    return {
      ...process.env,
      AGENT_NAME: peer.name,
      AGENT_PORT: peer.port.toString(),
      PEER_NETWORK: 'true',
      PEERS: Array.from(this.peers.keys()).join(','),
      LOCAL_LLM_ENDPOINT: this.networkConfig.mainLoopLLM.endpoint || 'http://localhost:8080'
    };
  }

  /**
   * Run critic analysis on results
   */
  private async runCriticAnalysis(task: string, results: any): Promise<any> {
    const criticAgent = this.peers.get('critic');
    if (!criticAgent) {
      // Create ad-hoc critic if not defined
      return await this.runAdHocCritic(task, results);
    }
    
    const criticPrompt = `
    Analyze the following task execution and results:
    
    Task: ${task}
    Results: ${JSON.stringify(results, null, 2)}
    
    Provide:
    1. Quality assessment
    2. Completeness check
    3. Potential improvements
    4. Risk analysis
    `;
    
    return await this.executePeerTask(
      `critic-${Date.now()}`,
      'critic',
      criticPrompt,
      {},
      1
    );
  }

  /**
   * Run ad-hoc critic analysis using local LLM
   */
  private async runAdHocCritic(task: string, results: any): Promise<any> {
    const prompt = `
    Act as a critic analyzing this task execution:
    Task: ${task}
    Results: ${JSON.stringify(results, null, 2)}
    
    Provide constructive criticism and suggestions.
    `;
    
    return await this.callLocalLLM(prompt);
  }

  /**
   * Call local Hanzo Zen LLM
   */
  private async callLocalLLM(prompt: string): Promise<any> {
    const { model, endpoint, maxTokens, temperature } = this.networkConfig.mainLoopLLM;
    
    // Call local Hanzo Zen endpoint
    const response = await fetch(endpoint || 'http://localhost:8080/v1/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'hanzo-zen',
        prompt,
        max_tokens: maxTokens || 2000,
        temperature: temperature || 0.7,
        tools: this.getAvailableTools()
      })
    });
    
    const result = await response.json();
    return result.choices[0].text;
  }

  /**
   * Get available tools for all agents
   */
  private getAvailableTools(): any[] {
    const tools = [];
    
    for (const [name, peer] of this.peers) {
      tools.push(
        {
          name: `chat_with_${name}`,
          description: `Chat with ${name} agent: ${peer.instance.description}`
        },
        {
          name: `ask_${name}`,
          description: `Ask ${name} a specific question`
        },
        {
          name: `delegate_to_${name}`,
          description: `Delegate a task to ${name}`
        },
        {
          name: `get_${name}_status`,
          description: `Get status of ${name} agent`
        }
      );
    }
    
    return tools;
  }

  /**
   * Wait for peer to be ready
   */
  private async waitForPeerReady(name: string, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const peer = this.peers.get(name);
      if (peer && peer.status === 'ready') {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Peer ${name} failed to start within timeout`);
  }

  /**
   * Get tool for model
   */
  private getToolForModel(model: string): string {
    const modelMap: Record<string, string> = {
      'opus': 'claude',
      'sonnet': 'claude',
      'haiku': 'claude',
      'gpt-4': 'codex',
      'gpt-3.5': 'codex',
      'gemini-pro': 'gemini',
      'gemini-ultra': 'gemini',
      'zen': 'local',
      'hanzo-zen': 'local'
    };
    
    return modelMap[model.toLowerCase()] || 'claude';
  }

  /**
   * Shutdown the peer network
   */
  async shutdown(): Promise<void> {
    for (const [name, peer] of this.peers) {
      if (peer.process) {
        peer.process.kill();
      }
    }
    
    this.peers.clear();
    this.emit('shutdown');
  }

  /**
   * Get network status
   */
  getStatus(): any {
    const status = {
      peers: {},
      connections: {},
      mainLoop: this.networkConfig.mainLoopLLM,
      authenticated: this.auth.isAuthenticated()
    };
    
    for (const [name, peer] of this.peers) {
      status.peers[name] = {
        status: peer.status,
        port: peer.port,
        connections: Array.from(peer.connections),
        model: peer.instance.model
      };
    }
    
    return status;
  }
}