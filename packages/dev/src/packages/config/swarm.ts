/**
 * Swarm Configuration
 * YAML-based swarm configuration system
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

// Zod schemas for validation
const MCPServerSchema = z.object({
  name: z.string(),
  type: z.enum(['stdio', 'http', 'websocket']),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional()
});

const AgentInstanceSchema = z.object({
  description: z.string(),
  directory: z.string(),
  model: z.enum(['opus', 'sonnet', 'haiku', 'gpt-4', 'gpt-3.5', 'gemini-pro', 'local']),
  connections: z.array(z.string()).optional(),
  vibe: z.boolean().optional(),
  prompt: z.string(),
  mcps: z.array(MCPServerSchema).optional(),
  allowed_tools: z.array(z.string()).optional(),
  resources: z.object({
    memory: z.string().optional(),
    cpu: z.string().optional(),
    timeout: z.number().optional()
  }).optional()
});

const SwarmConfigSchema = z.object({
  version: z.number(),
  swarm: z.object({
    name: z.string(),
    main: z.string(),
    instances: z.record(AgentInstanceSchema),
    coordination: z.object({
      strategy: z.enum(['round-robin', 'load-balanced', 'priority', 'random']).optional(),
      max_parallel: z.number().optional(),
      retry_policy: z.object({
        max_retries: z.number(),
        backoff: z.enum(['exponential', 'linear', 'constant'])
      }).optional()
    }).optional(),
    monitoring: z.object({
      metrics: z.boolean().optional(),
      logging: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      trace: z.boolean().optional()
    }).optional()
  })
});

export type SwarmConfig = z.infer<typeof SwarmConfigSchema>;
export type AgentInstance = z.infer<typeof AgentInstanceSchema>;
export type MCPServer = z.infer<typeof MCPServerSchema>;

export class SwarmConfigManager {
  private configs: Map<string, SwarmConfig> = new Map();
  
  async loadConfig(filePath: string): Promise<SwarmConfig> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const raw = yaml.load(content) as any;
    
    try {
      const config = SwarmConfigSchema.parse(raw);
      this.configs.set(path.basename(filePath, '.yaml'), config);
      return config;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid swarm configuration: ${error.errors.map(e => e.message).join(', ')}`);
      }
      throw error;
    }
  }
  
  async saveConfig(filePath: string, config: SwarmConfig): Promise<void> {
    const validated = SwarmConfigSchema.parse(config);
    const yamlStr = yaml.dump(validated, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });
    
    await fs.promises.writeFile(filePath, yamlStr, 'utf-8');
  }
  
  getConfig(name: string): SwarmConfig | undefined {
    return this.configs.get(name);
  }
  
  listConfigs(): string[] {
    return Array.from(this.configs.keys());
  }
  
  validateConfig(config: any): { valid: boolean; errors?: string[] } {
    try {
      SwarmConfigSchema.parse(config);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          errors: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        };
      }
      return { valid: false, errors: [String(error)] };
    }
  }
  
  mergeConfigs(base: SwarmConfig, override: Partial<SwarmConfig>): SwarmConfig {
    return {
      ...base,
      swarm: {
        ...base.swarm,
        ...override.swarm,
        instances: {
          ...base.swarm.instances,
          ...(override.swarm?.instances || {})
        }
      }
    };
  }
  
  // Helper methods for working with swarm configs
  getMainAgent(config: SwarmConfig): AgentInstance {
    const mainName = config.swarm.main;
    const main = config.swarm.instances[mainName];
    
    if (!main) {
      throw new Error(`Main agent '${mainName}' not found in configuration`);
    }
    
    return main;
  }
  
  getAgentConnections(config: SwarmConfig, agentName: string): AgentInstance[] {
    const agent = config.swarm.instances[agentName];
    if (!agent || !agent.connections) {
      return [];
    }
    
    return agent.connections
      .map(name => config.swarm.instances[name])
      .filter(Boolean);
  }
  
  getTopologicalOrder(config: SwarmConfig): string[] {
    const visited = new Set<string>();
    const stack: string[] = [];
    
    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      
      const agent = config.swarm.instances[name];
      if (agent?.connections) {
        agent.connections.forEach(dep => visit(dep));
      }
      
      stack.push(name);
    };
    
    // Start with main agent
    visit(config.swarm.main);
    
    // Visit any unconnected agents
    Object.keys(config.swarm.instances).forEach(name => visit(name));
    
    return stack;
  }
  
  // Generate example configuration
  generateExample(): SwarmConfig {
    return {
      version: 1,
      swarm: {
        name: "Example Development Team",
        main: "architect",
        instances: {
          architect: {
            description: "Main coordinator agent",
            directory: ".",
            model: "opus",
            connections: ["backend", "frontend", "tester"],
            vibe: true,
            prompt: `You are the lead architect coordinating development.
            
            ## Responsibilities
            1. Understand requirements
            2. Break down tasks
            3. Delegate to specialists
            4. Ensure quality`,
            mcps: [
              {
                name: "filesystem",
                type: "stdio",
                command: "mcp-server-filesystem",
                env: {
                  "ALLOWED_PATHS": "."
                }
              }
            ]
          },
          backend: {
            description: "Backend development specialist",
            directory: "./backend",
            model: "sonnet",
            prompt: "You are a backend specialist focused on APIs and databases.",
            allowed_tools: ["read_file", "write_file", "run_command"]
          },
          frontend: {
            description: "Frontend development specialist",
            directory: "./frontend",
            model: "sonnet",
            prompt: "You are a frontend specialist focused on UI/UX.",
            allowed_tools: ["read_file", "write_file", "run_command"]
          },
          tester: {
            description: "Testing and QA specialist",
            directory: "./tests",
            model: "haiku",
            prompt: "You are a testing specialist ensuring code quality.",
            allowed_tools: ["read_file", "run_command"]
          }
        },
        coordination: {
          strategy: "priority",
          max_parallel: 3,
          retry_policy: {
            max_retries: 3,
            backoff: "exponential"
          }
        },
        monitoring: {
          metrics: true,
          logging: "info",
          trace: false
        }
      }
    };
  }
}

// Global instance
export const swarmConfigManager = new SwarmConfigManager();