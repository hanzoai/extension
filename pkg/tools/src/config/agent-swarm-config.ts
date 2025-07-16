import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'http';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SharedMCPConfig {
  github?: {
    enabled: boolean;
    token?: string;
  };
  linear?: {
    enabled: boolean;
    apiKey?: string;
  };
  slack?: {
    enabled: boolean;
    token?: string;
  };
  playwright?: {
    enabled: boolean;
    headless?: boolean;
  };
  custom?: MCPServerConfig[];
}

export interface AgentInstance {
  description: string;
  directory: string;
  model: string;
  connections?: string[];
  vibe?: boolean;
  prompt: string;
  allowed_tools?: string[];
  mcps?: MCPServerConfig[];
  expose_as_mcp?: boolean; // Expose this agent as an MCP server to other agents
  mcp_port?: number; // Port for MCP server if exposed
  connect_to_agents?: string[]; // Other agents to connect to via MCP
}

export interface NetworkConfig {
  name: string;
  agents: string[];
  mcp_enabled?: boolean; // Enable MCP connections between all agents in network
  shared_tools?: string[]; // Tools available to all agents in network
  shared_mcps?: MCPServerConfig[]; // MCP servers available to all agents
}

export interface AgentSwarmConfig {
  version: number;
  swarm: {
    name: string;
    main: string;
    instances: Record<string, AgentInstance>;
    networks?: Record<string, NetworkConfig>; // Named networks of agents
    shared_mcps?: SharedMCPConfig; // Shared MCP servers for all agents
  };
}

export class AgentSwarmManager {
  private config: AgentSwarmConfig | null = null;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), '.hanzo', 'agents.yaml');
  }

  /**
   * Load agent configuration from YAML file
   */
  async loadConfig(): Promise<AgentSwarmConfig> {
    try {
      // Check multiple possible locations
      const possiblePaths = [
        this.configPath,
        path.join(process.cwd(), 'agents.yaml'),
        path.join(process.cwd(), '.agents.yaml'),
        path.join(process.cwd(), 'config', 'agents.yaml')
      ];

      let configContent: string | null = null;
      let foundPath: string | null = null;

      for (const configPath of possiblePaths) {
        if (fs.existsSync(configPath)) {
          configContent = fs.readFileSync(configPath, 'utf8');
          foundPath = configPath;
          break;
        }
      }

      if (!configContent || !foundPath) {
        throw new Error(`No agent configuration found. Searched paths: ${possiblePaths.join(', ')}`);
      }

      this.config = yaml.load(configContent) as AgentSwarmConfig;
      console.log(`Loaded agent configuration from: ${foundPath}`);
      
      // Validate configuration
      this.validateConfig(this.config);
      
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load agent configuration: ${error}`);
    }
  }

  /**
   * Validate the agent configuration
   */
  private validateConfig(config: AgentSwarmConfig): void {
    if (!config.version || config.version !== 1) {
      throw new Error('Invalid or missing version in agent configuration');
    }

    if (!config.swarm || !config.swarm.name || !config.swarm.main) {
      throw new Error('Invalid swarm configuration: missing name or main agent');
    }

    if (!config.swarm.instances || Object.keys(config.swarm.instances).length === 0) {
      throw new Error('No agent instances defined');
    }

    // Validate main agent exists
    if (!config.swarm.instances[config.swarm.main]) {
      throw new Error(`Main agent '${config.swarm.main}' not found in instances`);
    }

    // Validate each instance
    for (const [name, instance] of Object.entries(config.swarm.instances)) {
      if (!instance.description || !instance.directory || !instance.model || !instance.prompt) {
        throw new Error(`Agent '${name}' missing required fields (description, directory, model, prompt)`);
      }

      // Validate connections reference existing agents
      if (instance.connections) {
        for (const connection of instance.connections) {
          if (!config.swarm.instances[connection]) {
            throw new Error(`Agent '${name}' has invalid connection to '${connection}'`);
          }
        }
      }

      // Validate MCP servers
      if (instance.mcps) {
        for (const mcp of instance.mcps) {
          if (!mcp.name || !mcp.type || !mcp.command) {
            throw new Error(`Invalid MCP server configuration in agent '${name}'`);
          }
        }
      }
    }
  }

  /**
   * Get the main agent instance
   */
  getMainAgent(): AgentInstance | null {
    if (!this.config) return null;
    return this.config.swarm.instances[this.config.swarm.main];
  }

  /**
   * Get a specific agent instance
   */
  getAgent(name: string): AgentInstance | null {
    if (!this.config) return null;
    return this.config.swarm.instances[name] || null;
  }

  /**
   * Get all agent instances
   */
  getAllAgents(): Record<string, AgentInstance> {
    if (!this.config) return {};
    return this.config.swarm.instances;
  }

  /**
   * Get the full configuration
   */
  getConfig(): AgentSwarmConfig | null {
    return this.config;
  }

  /**
   * Get agents connected to a specific agent
   */
  getConnectedAgents(agentName: string): AgentInstance[] {
    if (!this.config) return [];
    
    const agent = this.getAgent(agentName);
    if (!agent || !agent.connections) return [];

    return agent.connections
      .map(name => this.getAgent(name))
      .filter((agent): agent is AgentInstance => agent !== null);
  }

  /**
   * Get network configuration by name
   */
  getNetwork(networkName: string): NetworkConfig | null {
    if (!this.config || !this.config.swarm.networks) return null;
    return this.config.swarm.networks[networkName] || null;
  }

  /**
   * Get all agents in a network
   */
  getNetworkAgents(networkName: string): AgentInstance[] {
    const network = this.getNetwork(networkName);
    if (!network) return [];

    return network.agents
      .map(name => this.getAgent(name))
      .filter((agent): agent is AgentInstance => agent !== null);
  }

  /**
   * Get all networks an agent belongs to
   */
  getAgentNetworks(agentName: string): NetworkConfig[] {
    if (!this.config || !this.config.swarm.networks) return [];

    return Object.values(this.config.swarm.networks)
      .filter(network => network.agents.includes(agentName));
  }

  /**
   * Apply network configuration to agents
   */
  applyNetworkConfig(agent: AgentInstance, agentName: string): AgentInstance {
    const networks = this.getAgentNetworks(agentName);
    if (networks.length === 0) return agent;

    // Clone agent to avoid mutation
    const configuredAgent = { ...agent };

    for (const network of networks) {
      // Add shared tools
      if (network.shared_tools) {
        configuredAgent.allowed_tools = [
          ...(configuredAgent.allowed_tools || []),
          ...network.shared_tools
        ];
      }

      // Add shared MCP servers
      if (network.shared_mcps) {
        configuredAgent.mcps = [
          ...(configuredAgent.mcps || []),
          ...network.shared_mcps
        ];
      }

      // Add MCP connections to other agents in network
      if (network.mcp_enabled) {
        const otherAgents = network.agents.filter(a => a !== agentName);
        configuredAgent.connect_to_agents = [
          ...(configuredAgent.connect_to_agents || []),
          ...otherAgents
        ];
      }
    }

    // Remove duplicates
    if (configuredAgent.allowed_tools) {
      configuredAgent.allowed_tools = [...new Set(configuredAgent.allowed_tools)];
    }
    if (configuredAgent.connect_to_agents) {
      configuredAgent.connect_to_agents = [...new Set(configuredAgent.connect_to_agents)];
    }

    return configuredAgent;
  }

  /**
   * Create a sample agent configuration
   */
  static createSampleConfig(): string {
    const sampleConfig = {
      version: 1,
      swarm: {
        name: "Development Team",
        main: "architect",
        instances: {
          architect: {
            description: "Lead architect coordinating development",
            directory: ".",
            model: "opus",
            connections: ["frontend", "backend", "tests", "devops"],
            vibe: true,
            expose_as_mcp: true,
            mcp_port: 8001,
            prompt: `# Lead Architect Agent

You are the lead architect coordinating development. Your role is to:

1. Understand requirements and break them down
2. Delegate work to appropriate specialists
3. Ensure best practices across the team
4. Maintain coherent system design

## Your Team
- Frontend: UI/UX implementation
- Backend: API and business logic
- Tests: Test coverage and quality
- DevOps: Infrastructure and deployment

Always coordinate effectively and synthesize work into cohesive solutions.`,
            mcps: [
              {
                name: "filesystem",
                type: "stdio",
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-filesystem"],
                env: {
                  ALLOWED_DIRECTORIES: "."
                }
              }
            ]
          },
          frontend: {
            description: "Frontend UI/UX specialist",
            directory: "./src/frontend",
            model: "sonnet",
            expose_as_mcp: true,
            mcp_port: 8002,
            allowed_tools: ["Read", "Edit", "Write", "Grep"],
            prompt: `# Frontend Specialist

You are a frontend specialist focusing on:
- Component architecture
- User experience
- Responsive design
- Performance optimization

Work closely with the architect to implement UI features.`
          },
          backend: {
            description: "Backend API specialist",
            directory: "./src/backend",
            model: "sonnet",
            expose_as_mcp: true,
            mcp_port: 8003,
            allowed_tools: ["Read", "Edit", "Write", "Bash"],
            prompt: `# Backend Specialist

You are a backend specialist focusing on:
- API design and implementation
- Database optimization
- Security best practices
- Performance and scalability

Coordinate with frontend for API contracts.`
          },
          tests: {
            description: "Testing and quality assurance specialist",
            directory: "./tests",
            model: "haiku",
            expose_as_mcp: true,
            mcp_port: 8004,
            allowed_tools: ["Read", "Edit", "Write", "Bash"],
            prompt: `# Testing Specialist

You are a testing specialist ensuring:
- Comprehensive test coverage
- Test quality and maintainability
- Performance testing
- Integration testing

Write tests for all new features and bug fixes.`
          },
          devops: {
            description: "DevOps and infrastructure specialist",
            directory: "./infrastructure",
            model: "haiku",
            expose_as_mcp: true,
            mcp_port: 8005,
            allowed_tools: ["Read", "Edit", "Write", "Bash"],
            prompt: `# DevOps Specialist

You handle infrastructure and deployment:
- CI/CD pipelines
- Docker and containerization
- Cloud infrastructure
- Monitoring and logging`
          }
        },
        networks: {
          core_team: {
            name: "Core Development Team",
            agents: ["architect", "frontend", "backend", "tests"],
            mcp_enabled: true,
            shared_tools: ["Grep", "Read"],
            shared_mcps: [
              {
                name: "project-search",
                type: "stdio",
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-everything"]
              }
            ]
          },
          deployment_team: {
            name: "Deployment Team",
            agents: ["backend", "devops", "tests"],
            mcp_enabled: true,
            shared_tools: ["Bash"]
          }
        }
      }
    };

    return yaml.dump(sampleConfig, { 
      indent: 2,
      lineWidth: 80,
      quotingType: '"',
      forceQuotes: false
    });
  }

  /**
   * Initialize a new agent configuration file
   */
  static async initConfig(targetPath?: string): Promise<void> {
    const configPath = targetPath || path.join(process.cwd(), '.hanzo', 'agents.yaml');
    
    // Create directory if needed
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if config already exists
    if (fs.existsSync(configPath)) {
      throw new Error(`Configuration already exists at ${configPath}`);
    }

    // Write sample config
    const sampleConfig = AgentSwarmManager.createSampleConfig();
    fs.writeFileSync(configPath, sampleConfig, 'utf8');
    
    console.log(`Created agent configuration at: ${configPath}`);
    console.log('Edit this file to customize your agent swarm configuration.');
  }

  /**
   * Initialize a peer network configuration with Hanzo Zen
   */
  static async initPeerNetworkConfig(targetPath?: string): Promise<void> {
    const configPath = targetPath || path.join(process.cwd(), '.hanzo', 'agents-peer.yaml');
    
    // Create directory if needed
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if config already exists
    if (fs.existsSync(configPath)) {
      throw new Error(`Configuration already exists at ${configPath}`);
    }

    // Write peer network config
    const peerConfig = AgentSwarmManager.createPeerNetworkConfig();
    fs.writeFileSync(configPath, peerConfig, 'utf8');
    
    console.log(`Created peer network configuration at: ${configPath}`);
    console.log('This configuration uses Hanzo Zen for cost-effective local orchestration.');
  }

  /**
   * Create a peer network configuration
   */
  static createPeerNetworkConfig(): string {
    const config = {
      version: 1,
      swarm: {
        name: "Peer Agent Network",
        main: "orchestrator",
        network_type: "peer",
        local_llm: {
          model: "hanzo-zen",
          endpoint: "http://localhost:8080",
          description: "Local Hanzo Zen MoE for cost-effective orchestration"
        },
        instances: {
          orchestrator: {
            description: "Main orchestrator using Hanzo Zen for coordination",
            directory: ".",
            model: "zen",
            expose_as_mcp: true,
            mcp_port: 10000,
            connect_to_agents: ["architect", "developer", "reviewer", "tester", "critic"],
            vibe: true,
            prompt: `# Orchestrator Agent (Hanzo Zen)
            
You are the main orchestrator running on local Hanzo Zen for cost efficiency.
Your role is to coordinate all other agents efficiently.

## Cost Optimization Strategy
- Use local inference (yourself) for planning and coordination
- Delegate complex tasks to specialized agents with API-based LLMs
- Batch similar requests to minimize API calls
- Use recursive agent calls wisely

## Available Agents (All exposed as MCP tools)
Every agent can call every other agent. You have tools like:
- chat_with_[agent] - Have conversations
- ask_[agent] - Quick questions
- delegate_to_[agent] - Task delegation
- get_[agent]_status - Check availability
- request_[agent]_expertise - Deep knowledge

Coordinate effectively while minimizing costs.`,
            allowed_tools: ["*"] // Access to all tools
          },
          architect: {
            description: "System architect for design decisions",
            directory: "./src",
            model: "opus",
            expose_as_mcp: true,
            mcp_port: 10001,
            connect_to_agents: ["orchestrator", "developer", "reviewer", "tester", "critic"],
            prompt: `# System Architect
            
You make architectural decisions and system design.
You can consult any other agent for information.
Focus on scalable, maintainable solutions.`,
            allowed_tools: ["Read", "Write", "Edit", "Grep", "chat_with_*", "ask_*"]
          },
          developer: {
            description: "Senior developer for implementation",
            directory: "./src",
            model: "sonnet",
            expose_as_mcp: true,
            mcp_port: 10002,
            connect_to_agents: ["orchestrator", "architect", "reviewer", "tester", "critic"],
            prompt: `# Senior Developer
            
You implement solutions based on architectural decisions.
Consult architect for design questions.
Ask reviewer for code quality feedback.
Coordinate with tester for test coverage.`,
            allowed_tools: ["Read", "Write", "Edit", "Bash", "chat_with_*", "ask_*", "delegate_to_*"]
          },
          reviewer: {
            description: "Code reviewer for quality assurance",
            directory: ".",
            model: "sonnet",
            expose_as_mcp: true,
            mcp_port: 10003,
            connect_to_agents: ["orchestrator", "architect", "developer", "tester", "critic"],
            prompt: `# Code Reviewer
            
You review code for quality, security, and best practices.
You can ask developer for clarifications.
Consult architect for design compliance.
Work with tester on test coverage.`,
            allowed_tools: ["Read", "Grep", "chat_with_*", "ask_*"]
          },
          tester: {
            description: "QA engineer for comprehensive testing",
            directory: "./tests",
            model: "haiku",
            expose_as_mcp: true,
            mcp_port: 10004,
            connect_to_agents: ["orchestrator", "architect", "developer", "reviewer", "critic"],
            prompt: `# QA Engineer
            
You ensure quality through testing.
Ask developer about implementation details.
Coordinate with reviewer on quality standards.
Report issues to architect for design flaws.`,
            allowed_tools: ["Read", "Write", "Edit", "Bash", "chat_with_*", "ask_*"]
          },
          critic: {
            description: "Final critic for comprehensive analysis",
            directory: ".",
            model: "opus",
            expose_as_mcp: true,
            mcp_port: 10005,
            connect_to_agents: ["orchestrator", "architect", "developer", "reviewer", "tester"],
            prompt: `# Critic Agent
            
You provide final analysis of completed work.
Review outputs from all agents critically.
Identify gaps, issues, and improvements.
Ensure requirements are fully met.`,
            allowed_tools: ["Read", "chat_with_*", "ask_*", "request_*_expertise"]
          }
        },
        networks: {
          full_mesh: {
            name: "Fully Connected Peer Network",
            agents: ["orchestrator", "architect", "developer", "reviewer", "tester", "critic"],
            mcp_enabled: true,
            description: "All agents can directly communicate with each other"
          },
          core_team: {
            name: "Core Development Team",
            agents: ["architect", "developer", "reviewer", "tester"],
            mcp_enabled: true,
            shared_tools: ["Read", "Grep"]
          }
        }
      }
    };

    return yaml.dump(config, { 
      indent: 2,
      lineWidth: 100,
      quotingType: '"',
      forceQuotes: false
    });
  }
}