import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { AgentSwarmManager } from '../../cli-tools/config/agent-swarm-config';

// Mock modules
vi.mock('fs');
vi.mock('../../cli-tools/config/agent-swarm-config');
vi.mock('../../cli-tools/orchestration/swarm-orchestrator');
vi.mock('../../cli-tools/orchestration/peer-agent-network');

describe('Swarm CLI Commands', () => {
  let program: Command;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    
    // Create a new commander program for testing
    program = new Command();
    program.exitOverride(); // Prevent actual process exit
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('swarm init', () => {
    beforeEach(async () => {
      // Dynamically import to get fresh module with mocks
      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program.addCommand(swarmCommand);
      }
    });

    it('should initialize default agent configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      await program.parseAsync(['node', 'test', 'swarm', 'init']);

      expect(AgentSwarmManager.initConfig).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created'));
    });

    it('should initialize peer network configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      await program.parseAsync(['node', 'test', 'swarm', 'init', '--peer-network']);

      expect(AgentSwarmManager.initPeerNetworkConfig).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('peer network'));
    });

    it('should handle existing configuration error', async () => {
      vi.mocked(AgentSwarmManager.initConfig).mockRejectedValue(
        new Error('Configuration already exists')
      );

      await expect(
        program.parseAsync(['node', 'test', 'swarm', 'init'])
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Configuration already exists')
      );
    });
  });

  describe('swarm run', () => {
    let mockOrchestrator: any;
    let mockPeerNetwork: any;

    beforeEach(async () => {
      // Mock orchestrator
      mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(undefined),
        executeTask: vi.fn().mockResolvedValue([
          { agentName: 'leader', result: 'Task completed', duration: 1000 }
        ]),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      // Mock peer network
      mockPeerNetwork = {
        initialize: vi.fn().mockResolvedValue(undefined),
        executeTask: vi.fn().mockResolvedValue({
          status: 'success',
          result: 'Task completed via peer network',
          agents_used: ['orchestrator', 'developer'],
          cost_analysis: {
            local_calls: 5,
            api_calls: 2,
            estimated_savings: 0.85
          }
        }),
        shutdown: vi.fn().mockResolvedValue(undefined),
        getCostMetrics: vi.fn().mockReturnValue({
          total_local_calls: 5,
          total_api_calls: 2,
          estimated_savings: 0.85
        })
      };

      // Mock constructors
      const { SwarmOrchestrator } = await import('../../cli-tools/orchestration/swarm-orchestrator');
      vi.mocked(SwarmOrchestrator).mockImplementation(() => mockOrchestrator);

      const { PeerAgentNetwork } = await import('../../cli-tools/orchestration/peer-agent-network');
      vi.mocked(PeerAgentNetwork).mockImplementation(() => mockPeerNetwork);

      // Mock config
      const mockConfig = {
        version: 1,
        swarm: {
          name: 'Test Swarm',
          main: 'leader',
          instances: {
            leader: { description: 'Leader', directory: '.', model: 'opus', prompt: 'Lead' }
          }
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      // Re-import and setup command
      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }
    });

    it('should run task with default orchestrator', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'run', 'Build a feature']);

      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(mockOrchestrator.executeTask).toHaveBeenCalledWith(
        'Build a feature',
        expect.any(Object)
      );
      expect(mockOrchestrator.shutdown).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Task completed'));
    });

    it('should run task with peer network', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'run', 'Build a feature', '--peer']);

      expect(mockPeerNetwork.initialize).toHaveBeenCalled();
      expect(mockPeerNetwork.executeTask).toHaveBeenCalledWith(
        'Build a feature',
        expect.objectContaining({ includeCritic: false })
      );
      expect(mockPeerNetwork.shutdown).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('peer network'));
    });

    it('should include critic review when requested', async () => {
      mockPeerNetwork.executeTask.mockResolvedValue({
        status: 'success',
        result: 'Task completed',
        critic_review: 'Code looks good with minor suggestions'
      });

      await program.parseAsync(['node', 'test', 'swarm', 'run', 'Review code', '--peer', '--critic']);

      expect(mockPeerNetwork.executeTask).toHaveBeenCalledWith(
        'Review code',
        expect.objectContaining({ includeCritic: true })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Critic Review'));
    });

    it('should use custom config file', async () => {
      await program.parseAsync([
        'node', 'test', 'swarm', 'run', 'Test', 
        '-c', '/custom/agents.yaml'
      ]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using configuration: /custom/agents.yaml')
      );
    });

    it('should display cost metrics for peer network', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'run', 'Test', '--peer']);

      expect(mockPeerNetwork.getCostMetrics).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Cost Analysis'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('85%'));
    });

    it('should handle task execution errors', async () => {
      mockOrchestrator.executeTask.mockRejectedValue(new Error('Execution failed'));

      await expect(
        program.parseAsync(['node', 'test', 'swarm', 'run', 'Failing task'])
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Execution failed')
      );
    });
  });

  describe('swarm status', () => {
    let mockOrchestrator: any;

    beforeEach(async () => {
      mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(undefined),
        getStatus: vi.fn().mockReturnValue({
          agents: {
            leader: { status: 'ready', directory: '.', model: 'opus' },
            developer: { status: 'active', directory: './src', model: 'sonnet' }
          },
          mcpServers: {
            'leader-filesystem': { status: 'running', config: { name: 'filesystem' } }
          },
          results: [
            { agentName: 'leader', result: 'Previous task', duration: 500 }
          ]
        }),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const { SwarmOrchestrator } = await import('../../cli-tools/orchestration/swarm-orchestrator');
      vi.mocked(SwarmOrchestrator).mockImplementation(() => mockOrchestrator);

      const mockConfig = {
        version: 1,
        swarm: {
          name: 'Test Swarm',
          main: 'leader',
          instances: {}
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }
    });

    it('should display swarm status', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'status']);

      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(mockOrchestrator.getStatus).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Swarm Status'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('leader'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('ready'));
    });

    it('should show MCP servers status', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('MCP Servers'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('filesystem'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
    });

    it('should show recent results', async () => {
      await program.parseAsync(['node', 'test', 'swarm', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Recent Results'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Previous task'));
    });
  });

  describe('swarm chat', () => {
    let mockOrchestrator: any;
    let mockReadline: any;

    beforeEach(async () => {
      // Mock readline
      mockReadline = {
        question: vi.fn(),
        close: vi.fn(),
        on: vi.fn()
      };

      const readline = await import('readline');
      vi.mocked(readline.createInterface).mockReturnValue(mockReadline as any);

      mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(undefined),
        executeAgentTask: vi.fn().mockResolvedValue({
          agentName: 'developer',
          result: 'Hello! I can help with that.',
          duration: 200
        }),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const { SwarmOrchestrator } = await import('../../cli-tools/orchestration/swarm-orchestrator');
      vi.mocked(SwarmOrchestrator).mockImplementation(() => mockOrchestrator);

      const mockConfig = {
        version: 1,
        swarm: {
          name: 'Test Swarm',
          main: 'project_manager',
          instances: {
            project_manager: { description: 'PM', directory: '.', model: 'opus', prompt: 'PM' },
            developer: { description: 'Dev', directory: './src', model: 'sonnet', prompt: 'Dev' }
          }
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }
    });

    it('should start chat session with default agents', async () => {
      // Simulate chat interaction
      let questionCallback: any;
      mockReadline.question.mockImplementation((prompt: string, cb: Function) => {
        questionCallback = cb;
        // Simulate exit after first message
        setTimeout(() => cb('exit'), 10);
      });

      await program.parseAsync(['node', 'test', 'swarm', 'chat']);

      expect(mockOrchestrator.initialize).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Agent Chat Session'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('project_manager'));
    });

    it('should handle agent messages', async () => {
      let messageCount = 0;
      mockReadline.question.mockImplementation((prompt: string, cb: Function) => {
        messageCount++;
        if (messageCount === 1) {
          setTimeout(() => cb('@developer How is the feature going?'), 10);
        } else {
          setTimeout(() => cb('exit'), 10);
        }
      });

      await program.parseAsync(['node', 'test', 'swarm', 'chat']);

      expect(mockOrchestrator.executeAgentTask).toHaveBeenCalledWith(
        'developer',
        expect.stringContaining('How is the feature going?'),
        expect.any(Object)
      );
    });

    it('should use specified from and to agents', async () => {
      mockReadline.question.mockImplementation((prompt: string, cb: Function) => {
        setTimeout(() => cb('exit'), 10);
      });

      await program.parseAsync([
        'node', 'test', 'swarm', 'chat',
        '-f', 'project_manager',
        '-t', 'developer'
      ]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('developer')
      );
    });
  });

  describe('swarm network', () => {
    let mockOrchestrator: any;

    beforeEach(async () => {
      mockOrchestrator = {
        initialize: vi.fn().mockResolvedValue(undefined),
        executeTask: vi.fn().mockResolvedValue([
          { agentName: 'architect', result: 'Designed', duration: 300 },
          { agentName: 'developer', result: 'Implemented', duration: 500 }
        ]),
        shutdown: vi.fn().mockResolvedValue(undefined)
      };

      const { SwarmOrchestrator } = await import('../../cli-tools/orchestration/swarm-orchestrator');
      vi.mocked(SwarmOrchestrator).mockImplementation(() => mockOrchestrator);

      const mockSwarmManager = {
        loadConfig: vi.fn().mockResolvedValue(true),
        getNetwork: vi.fn().mockReturnValue({
          name: 'Core Team',
          agents: ['architect', 'developer', 'tester']
        }),
        getNetworkAgents: vi.fn().mockReturnValue([
          { description: 'Architect', model: 'opus' },
          { description: 'Developer', model: 'sonnet' }
        ])
      };

      vi.mocked(AgentSwarmManager).mockImplementation(() => mockSwarmManager as any);

      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }
    });

    it('should run task with network agents', async () => {
      await program.parseAsync([
        'node', 'test', 'swarm', 'network',
        'core_team',
        'Build authentication'
      ]);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network: Core Team')
      );
      expect(mockOrchestrator.executeTask).toHaveBeenCalledWith(
        'Build authentication',
        expect.any(Object)
      );
    });

    it('should handle invalid network name', async () => {
      const mockSwarmManager = {
        loadConfig: vi.fn().mockResolvedValue(true),
        getNetwork: vi.fn().mockReturnValue(null)
      };

      vi.mocked(AgentSwarmManager).mockImplementation(() => mockSwarmManager as any);

      await expect(
        program.parseAsync([
          'node', 'test', 'swarm', 'network',
          'invalid_network',
          'Task'
        ])
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network \'invalid_network\' not found')
      );
    });
  });

  describe('error handling', () => {
    it('should handle missing configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }

      await expect(
        program.parseAsync(['node', 'test', 'swarm', 'run', 'Task'])
      ).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No agent configuration found')
      );
    });

    it('should handle invalid YAML configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid: yaml: content:');

      const devModule = await import('../../cli/dev');
      const swarmCommand = devModule.default.commands.find(cmd => cmd.name() === 'swarm');
      if (swarmCommand) {
        program = new Command();
        program.exitOverride();
        program.addCommand(swarmCommand);
      }

      await expect(
        program.parseAsync(['node', 'test', 'swarm', 'status'])
      ).rejects.toThrow();
    });
  });
});