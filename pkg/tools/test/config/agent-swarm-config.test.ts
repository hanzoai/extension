import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { 
  AgentSwarmManager, 
  AgentInstance, 
  AgentSwarmConfig,
  NetworkConfig,
  MCPServerConfig,
  SharedMCPConfig
} from '../../../cli-tools/config/agent-swarm-config';

vi.mock('fs');
vi.mock('path');

describe('AgentSwarmManager', () => {
  let manager: AgentSwarmManager;
  const mockConfigPath = '/test/agents.yaml';
  
  const mockConfig: AgentSwarmConfig = {
    version: 1,
    swarm: {
      name: 'Test Swarm',
      main: 'coordinator',
      instances: {
        coordinator: {
          description: 'Main coordinator',
          directory: '.',
          model: 'opus',
          connections: ['developer', 'reviewer'],
          expose_as_mcp: true,
          mcp_port: 8000,
          connect_to_agents: ['developer', 'reviewer'],
          prompt: 'You are the coordinator',
          allowed_tools: ['Read', 'Write'],
          mcps: [{
            name: 'filesystem',
            type: 'stdio',
            command: 'npx',
            args: ['mcp-server-filesystem']
          }]
        },
        developer: {
          description: 'Developer agent',
          directory: './src',
          model: 'sonnet',
          prompt: 'You are a developer'
        },
        reviewer: {
          description: 'Code reviewer',
          directory: '.',
          model: 'haiku',
          prompt: 'You are a reviewer'
        }
      },
      networks: {
        core: {
          name: 'Core Team',
          agents: ['coordinator', 'developer', 'reviewer'],
          mcp_enabled: true,
          shared_tools: ['Read', 'Grep']
        }
      },
      shared_mcps: {
        github: { enabled: true, token: 'test-token' },
        linear: { enabled: true, apiKey: 'test-key' },
        slack: { enabled: false },
        custom: [{
          name: 'postgres',
          type: 'stdio',
          command: 'pg-mcp',
          env: { DATABASE_URL: 'postgres://test' }
        }]
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentSwarmManager(mockConfigPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadConfig', () => {
    it('should load configuration from default path', async () => {
      const configYaml = yaml.dump(mockConfig);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(configYaml);

      const config = await manager.loadConfig();
      
      expect(config).toEqual(mockConfig);
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf8');
    });

    it.skip('should try multiple paths if default not found', async () => {
      const configYaml = yaml.dump(mockConfig);
      
      // Mock process.cwd
      const originalCwd = process.cwd;
      process.cwd = vi.fn().mockReturnValue('/test');
      
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(false) // .hanzo/agents.yaml
        .mockReturnValueOnce(false) // agents.yaml
        .mockReturnValueOnce(true); // .agents.yaml
      vi.mocked(fs.readFileSync).mockReturnValue(configYaml);
      
      // Create new manager without specific path to test multiple paths
      const testManager = new AgentSwarmManager();
      const config = await testManager.loadConfig();
      
      expect(config).toEqual(mockConfig);
      expect(fs.existsSync).toHaveBeenCalledTimes(3);
      
      // Restore process.cwd
      process.cwd = originalCwd;
    });

    it('should throw error if no config found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(manager.loadConfig()).rejects.toThrow('No agent configuration found');
    });

    it('should throw error for invalid version', async () => {
      const invalidConfig = { ...mockConfig, version: 2 };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidConfig));

      await expect(manager.loadConfig()).rejects.toThrow('Invalid or missing version');
    });

    it('should throw error for missing main agent', async () => {
      const invalidConfig = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          main: 'nonexistent'
        }
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidConfig));

      await expect(manager.loadConfig()).rejects.toThrow("Main agent 'nonexistent' not found");
    });

    it('should throw error for invalid agent connections', async () => {
      const invalidConfig = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          instances: {
            ...mockConfig.swarm.instances,
            coordinator: {
              ...mockConfig.swarm.instances.coordinator,
              connections: ['nonexistent']
            }
          }
        }
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidConfig));

      await expect(manager.loadConfig()).rejects.toThrow("invalid connection to 'nonexistent'");
    });
  });

  describe('getMainAgent', () => {
    it('should return main agent when config loaded', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();

      const mainAgent = manager.getMainAgent();
      
      expect(mainAgent).toEqual(mockConfig.swarm.instances.coordinator);
    });

    it('should return null when no config loaded', () => {
      const mainAgent = manager.getMainAgent();
      expect(mainAgent).toBeNull();
    });
  });

  describe('getAgent', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should return specific agent', () => {
      const agent = manager.getAgent('developer');
      expect(agent).toEqual(mockConfig.swarm.instances.developer);
    });

    it('should return null for non-existent agent', () => {
      const agent = manager.getAgent('nonexistent');
      expect(agent).toBeNull();
    });
  });

  describe('getAllAgents', () => {
    it('should return all agents', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();

      const agents = manager.getAllAgents();
      
      expect(agents).toEqual(mockConfig.swarm.instances);
      expect(Object.keys(agents)).toHaveLength(3);
    });

    it('should return empty object when no config', () => {
      const agents = manager.getAllAgents();
      expect(agents).toEqual({});
    });
  });

  describe('getConnectedAgents', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should return connected agents', () => {
      const connected = manager.getConnectedAgents('coordinator');
      
      expect(connected).toHaveLength(2);
      expect(connected[0]).toEqual(mockConfig.swarm.instances.developer);
      expect(connected[1]).toEqual(mockConfig.swarm.instances.reviewer);
    });

    it('should return empty array for agent without connections', () => {
      const connected = manager.getConnectedAgents('developer');
      expect(connected).toEqual([]);
    });
  });

  describe('getNetwork', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should return network configuration', () => {
      const network = manager.getNetwork('core');
      expect(network).toEqual(mockConfig.swarm.networks!.core);
    });

    it('should return null for non-existent network', () => {
      const network = manager.getNetwork('nonexistent');
      expect(network).toBeNull();
    });
  });

  describe('getNetworkAgents', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should return agents in network', () => {
      const agents = manager.getNetworkAgents('core');
      
      expect(agents).toHaveLength(3);
      expect(agents.map(a => a.description)).toContain('Main coordinator');
    });

    it('should return empty array for non-existent network', () => {
      const agents = manager.getNetworkAgents('nonexistent');
      expect(agents).toEqual([]);
    });
  });

  describe('getAgentNetworks', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should return networks containing agent', () => {
      const networks = manager.getAgentNetworks('developer');
      
      expect(networks).toHaveLength(1);
      expect(networks[0].name).toBe('Core Team');
    });

    it('should return empty array for agent not in any network', () => {
      const testConfig = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          instances: {
            ...mockConfig.swarm.instances,
            isolated: {
              description: 'Isolated agent',
              directory: '.',
              model: 'haiku',
              prompt: 'Isolated'
            }
          }
        }
      };
      
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(testConfig));
      manager = new AgentSwarmManager(mockConfigPath);
      manager.loadConfig();
      
      const networks = manager.getAgentNetworks('isolated');
      expect(networks).toEqual([]);
    });
  });

  describe('applyNetworkConfig', () => {
    beforeEach(async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();
    });

    it('should apply network configuration to agent', () => {
      const agent = manager.getAgent('developer')!;
      const configured = manager.applyNetworkConfig(agent, 'developer');
      
      expect(configured.allowed_tools).toContain('Read');
      expect(configured.allowed_tools).toContain('Grep');
      expect(configured.connect_to_agents).toContain('coordinator');
      expect(configured.connect_to_agents).toContain('reviewer');
    });

    it('should handle agent not in any network', () => {
      const agent: AgentInstance = {
        description: 'Test',
        directory: '.',
        model: 'haiku',
        prompt: 'Test'
      };
      
      const configured = manager.applyNetworkConfig(agent, 'nonexistent');
      expect(configured).toEqual(agent);
    });

    it('should remove duplicates from arrays', () => {
      const testConfig = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          networks: {
            net1: {
              name: 'Network 1',
              agents: ['developer'],
              mcp_enabled: true,
              shared_tools: ['Read', 'Write']
            },
            net2: {
              name: 'Network 2',
              agents: ['developer'],
              mcp_enabled: true,
              shared_tools: ['Read', 'Grep']
            }
          }
        }
      };
      
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(testConfig));
      manager = new AgentSwarmManager(mockConfigPath);
      manager.loadConfig();
      
      const agent = manager.getAgent('developer')!;
      const configured = manager.applyNetworkConfig(agent, 'developer');
      
      // Should have unique tools
      const uniqueTools = [...new Set(configured.allowed_tools)];
      expect(configured.allowed_tools).toEqual(uniqueTools);
    });
  });

  describe('getConfig', () => {
    it('should return full configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(mockConfig));
      await manager.loadConfig();

      const config = manager.getConfig();
      expect(config).toEqual(mockConfig);
    });

    it('should return null when no config loaded', () => {
      const config = manager.getConfig();
      expect(config).toBeNull();
    });
  });

  describe('static methods', () => {
    describe('initConfig', () => {
      it('should create new configuration file', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
        vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
        vi.mocked(path.dirname).mockReturnValue('.hanzo');

        await AgentSwarmManager.initConfig('/test/agents.yaml');

        expect(fs.mkdirSync).toHaveBeenCalledWith('.hanzo', { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalled();
      });

      it('should throw if config already exists', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        await expect(AgentSwarmManager.initConfig('/test/agents.yaml'))
          .rejects.toThrow('Configuration already exists');
      });
    });

    describe('initPeerNetworkConfig', () => {
      it('should create peer network configuration', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
        vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
        vi.mocked(path.dirname).mockReturnValue('.hanzo');

        await AgentSwarmManager.initPeerNetworkConfig('/test/agents-peer.yaml');

        expect(fs.writeFileSync).toHaveBeenCalled();
        const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(writtenContent).toContain('hanzo-zen');
        expect(writtenContent).toContain('network_type: peer');
      });
    });

    describe('createSampleConfig', () => {
      it('should create valid sample configuration', () => {
        const sampleYaml = AgentSwarmManager.createSampleConfig();
        const sample = yaml.load(sampleYaml) as AgentSwarmConfig;
        
        expect(sample.version).toBe(1);
        expect(sample.swarm.name).toBe('Development Team');
        expect(sample.swarm.main).toBe('architect');
        expect(Object.keys(sample.swarm.instances)).toContain('architect');
        expect(Object.keys(sample.swarm.instances)).toContain('frontend');
      });
    });

    describe('createPeerNetworkConfig', () => {
      it('should create valid peer network configuration', () => {
        const peerYaml = AgentSwarmManager.createPeerNetworkConfig();
        const peer = yaml.load(peerYaml) as any;
        
        expect(peer.version).toBe(1);
        expect(peer.swarm.network_type).toBe('peer');
        expect(peer.swarm.local_llm.model).toBe('hanzo-zen');
        expect(Object.keys(peer.swarm.instances)).toContain('orchestrator');
        expect(peer.swarm.instances.orchestrator.model).toBe('zen');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty networks configuration', async () => {
      const configWithoutNetworks = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          networks: undefined
        }
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(configWithoutNetworks));
      await manager.loadConfig();
      
      const network = manager.getNetwork('any');
      expect(network).toBeNull();
      
      const networks = manager.getAgentNetworks('coordinator');
      expect(networks).toEqual([]);
    });

    it('should handle agent without required fields', async () => {
      const invalidAgent = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          main: 'invalid',
          instances: {
            invalid: {
              description: 'Invalid agent'
              // Missing required fields: directory, model, prompt
            }
          }
        }
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidAgent));
      
      await expect(manager.loadConfig()).rejects.toThrow('missing required fields');
    });

    it('should handle invalid MCP server config', async () => {
      const invalidMCP = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          instances: {
            ...mockConfig.swarm.instances,
            coordinator: {
              ...mockConfig.swarm.instances.coordinator,
              mcps: [{
                name: 'invalid'
                // Missing required fields
              }]
            }
          }
        }
      };
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(yaml.dump(invalidMCP));
      
      await expect(manager.loadConfig()).rejects.toThrow('Invalid MCP server configuration');
    });
  });
});