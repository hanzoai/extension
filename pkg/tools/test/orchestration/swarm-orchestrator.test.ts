import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SwarmOrchestrator } from '../../../cli-tools/orchestration/swarm-orchestrator';
import { AgentSwarmManager, AgentInstance, AgentSwarmConfig } from '../../../cli-tools/config/agent-swarm-config';
import { CLIToolManager } from '../../../cli-tools/cli-tool-manager';
import * as child_process from 'child_process';
import * as path from 'path';

vi.mock('../../../cli-tools/config/agent-swarm-config');
vi.mock('../../../cli-tools/cli-tool-manager');
vi.mock('child_process');

describe('SwarmOrchestrator', () => {
  let orchestrator: SwarmOrchestrator;
  let mockSwarmManager: any;
  let mockToolManager: any;
  let mockConfig: AgentSwarmConfig;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConfig = {
      version: 1,
      swarm: {
        name: 'Test Swarm',
        main: 'leader',
        instances: {
          leader: {
            description: 'Team leader',
            directory: '.',
            model: 'opus',
            prompt: 'You are the leader',
            connections: ['developer', 'tester'],
            mcps: [{
              name: 'filesystem',
              type: 'stdio',
              command: 'npx',
              args: ['mcp-server-fs']
            }]
          },
          developer: {
            description: 'Developer',
            directory: './src',
            model: 'sonnet',
            prompt: 'You are a developer',
            expose_as_mcp: true,
            mcp_port: 8001
          },
          tester: {
            description: 'Tester',
            directory: './tests',
            model: 'haiku',
            prompt: 'You are a tester',
            expose_as_mcp: true,
            connect_to_agents: ['developer']
          }
        },
        networks: {
          main: {
            name: 'Main Team',
            agents: ['leader', 'developer', 'tester'],
            mcp_enabled: true,
            shared_tools: ['Read', 'Write']
          }
        }
      }
    };
    
    mockSwarmManager = {
      loadConfig: vi.fn().mockResolvedValue(mockConfig),
      getMainAgent: vi.fn().mockReturnValue(mockConfig.swarm.instances.leader),
      getAgent: vi.fn().mockImplementation((name: string) => mockConfig.swarm.instances[name]),
      getAllAgents: vi.fn().mockReturnValue(mockConfig.swarm.instances),
      getConnectedAgents: vi.fn().mockImplementation((name: string) => {
        const agent = mockConfig.swarm.instances[name];
        if (!agent.connections) return [];
        return agent.connections.map(n => mockConfig.swarm.instances[n]);
      }),
      applyNetworkConfig: vi.fn().mockImplementation((agent: AgentInstance) => ({
        ...agent,
        allowed_tools: ['Read', 'Write', 'Grep'],
        connect_to_agents: ['leader', 'developer', 'tester'].filter(n => n !== agent.description)
      })),
      getConfig: vi.fn().mockReturnValue(mockConfig)
    };
    
    mockToolManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      runTool: vi.fn().mockResolvedValue('Task completed successfully')
    };
    
    vi.mocked(AgentSwarmManager).mockImplementation(() => mockSwarmManager);
    vi.mocked(CLIToolManager).mockImplementation(() => mockToolManager);
    
    orchestrator = new SwarmOrchestrator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize swarm manager and tool manager', async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      await orchestrator.initialize();
      
      expect(mockSwarmManager.loadConfig).toHaveBeenCalled();
      expect(mockToolManager.initialize).toHaveBeenCalled();
    });

    it('should start MCP servers for agents', async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      await orchestrator.initialize();
      
      // Should spawn filesystem MCP for leader
      expect(child_process.spawn).toHaveBeenCalledWith(
        'npx',
        ['mcp-server-fs'],
        expect.any(Object)
      );
    });

    it('should start agent MCP servers when configured', async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      await orchestrator.initialize();
      
      // Should start MCP server for developer (expose_as_mcp: true)
      const spawnCalls = vi.mocked(child_process.spawn).mock.calls;
      const agentMCPCall = spawnCalls.find(call => 
        call[0] === 'node' && call[1].some(arg => arg.includes('agent-mcp-server'))
      );
      
      expect(agentMCPCall).toBeDefined();
    });

    it('should emit events for MCP server lifecycle', async () => {
      const mockProcess = {
        on: vi.fn((event, cb) => {
          if (event === 'error') {
            setTimeout(() => cb(new Error('MCP error')), 10);
          }
        }),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      const errorListener = vi.fn();
      orchestrator.on('mcp-error', errorListener);
      
      await orchestrator.initialize();
      await new Promise(resolve => setTimeout(resolve, 20));
      
      expect(errorListener).toHaveBeenCalled();
    });
  });

  describe('task execution', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
    });

    it('should execute task with main agent', async () => {
      const task = 'Build a new feature';
      const context = { priority: 'high' };
      
      const results = await orchestrator.executeTask(task, context);
      
      expect(mockToolManager.runTool).toHaveBeenCalledWith(
        'claude',
        expect.stringContaining(task),
        expect.objectContaining({
          model: 'opus',
          cwd: expect.any(String)
        })
      );
      
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        agentName: 'leader',
        result: 'Task completed successfully',
        duration: expect.any(Number)
      });
    });

    it('should handle delegated tasks', async () => {
      // Mock response with delegation
      mockToolManager.runTool
        .mockResolvedValueOnce('I will delegate this.\nDELEGATE TO [developer]: Implement the login feature\nDELEGATE TO [tester]: Write tests for login')
        .mockResolvedValueOnce('Login feature implemented')
        .mockResolvedValueOnce('Tests written');
      
      const results = await orchestrator.executeTask('Create login system');
      
      expect(results).toHaveLength(3);
      expect(results.map(r => r.agentName)).toContain('leader');
      expect(results.map(r => r.agentName)).toContain('developer');
      expect(results.map(r => r.agentName)).toContain('tester');
    });

    it('should change to agent directory during execution', async () => {
      const originalCwd = process.cwd();
      let executionCwd: string | undefined;
      
      mockToolManager.runTool.mockImplementation(async (tool, prompt, options) => {
        executionCwd = options.cwd;
        return 'Done';
      });
      
      await orchestrator.executeAgentTask('developer', 'Write code', {});
      
      expect(executionCwd).toContain('src');
      expect(process.cwd()).toBe(originalCwd);
    });

    it('should handle agent task errors', async () => {
      mockToolManager.runTool.mockRejectedValue(new Error('Tool execution failed'));
      
      const results = await orchestrator.executeTask('Failing task');
      
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        agentName: 'leader',
        result: '',
        error: 'Tool execution failed',
        duration: expect.any(Number)
      });
    });

    it('should emit agent lifecycle events', async () => {
      const startListener = vi.fn();
      const completeListener = vi.fn();
      const errorListener = vi.fn();
      
      orchestrator.on('agent-start', startListener);
      orchestrator.on('agent-complete', completeListener);
      orchestrator.on('agent-error', errorListener);
      
      await orchestrator.executeTask('Test task');
      
      expect(startListener).toHaveBeenCalledWith({
        agentName: 'leader',
        task: 'Test task'
      });
      
      expect(completeListener).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'leader',
          result: expect.any(String)
        })
      );
    });
  });

  describe('agent prompts', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
    });

    it('should build agent prompt with simplified tools', async () => {
      let capturedPrompt: string = '';
      
      mockToolManager.runTool.mockImplementation(async (tool, prompt) => {
        capturedPrompt = prompt;
        return 'Done';
      });
      
      await orchestrator.executeAgentTask('leader', 'Test task', { data: 'test' });
      
      expect(capturedPrompt).toContain('You are the leader');
      expect(capturedPrompt).toContain('Test task');
      expect(capturedPrompt).toContain('## Available Agents (as Tools)');
      expect(capturedPrompt).toContain('developer');
      expect(capturedPrompt).toContain('tester');
      expect(capturedPrompt).toContain('Use tool "developer"');
    });

    it('should include shared MCP tools in prompt', async () => {
      let capturedPrompt: string = '';
      
      mockToolManager.runTool.mockImplementation(async (tool, prompt) => {
        capturedPrompt = prompt;
        return 'Done';
      });
      
      await orchestrator.executeAgentTask('leader', 'Test task');
      
      expect(capturedPrompt).toContain('## Shared Tools');
      expect(capturedPrompt).toContain('read_file');
      expect(capturedPrompt).toContain('write_file');
      expect(capturedPrompt).toContain('search');
      expect(capturedPrompt).toContain('bash');
      expect(capturedPrompt).toContain('github');
      expect(capturedPrompt).toContain('linear');
    });
  });

  describe('model mapping', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
    });

    it('should map Claude models correctly', async () => {
      const agents = [
        { name: 'opus-agent', model: 'opus', tool: 'claude' },
        { name: 'sonnet-agent', model: 'sonnet', tool: 'claude' },
        { name: 'haiku-agent', model: 'haiku', tool: 'claude' }
      ];
      
      for (const agent of agents) {
        mockSwarmManager.getAgent.mockReturnValue({
          description: agent.name,
          directory: '.',
          model: agent.model,
          prompt: 'Test'
        });
        
        await orchestrator.executeAgentTask(agent.name, 'Test');
        
        expect(mockToolManager.runTool).toHaveBeenCalledWith(
          agent.tool,
          expect.any(String),
          expect.objectContaining({ model: agent.model })
        );
      }
    });

    it('should map OpenAI models correctly', async () => {
      mockSwarmManager.getAgent.mockReturnValue({
        description: 'GPT agent',
        directory: '.',
        model: 'gpt-4',
        prompt: 'Test'
      });
      
      await orchestrator.executeAgentTask('gpt-agent', 'Test');
      
      expect(mockToolManager.runTool).toHaveBeenCalledWith(
        'codex',
        expect.any(String),
        expect.objectContaining({ model: 'gpt-4' })
      );
    });
  });

  describe('status reporting', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
    });

    it('should report swarm status', async () => {
      await orchestrator.executeTask('Test task');
      
      const status = orchestrator.getStatus();
      
      expect(status.agents).toBeDefined();
      expect(status.agents.leader).toMatchObject({
        status: expect.any(String),
        directory: '.',
        model: 'opus'
      });
      
      expect(status.mcpServers).toBeDefined();
      expect(status.results).toHaveLength(1);
    });

    it('should track active agents during execution', async () => {
      let statusDuringExecution: any;
      
      mockToolManager.runTool.mockImplementation(async () => {
        statusDuringExecution = orchestrator.getStatus();
        return 'Done';
      });
      
      await orchestrator.executeTask('Test');
      
      expect(statusDuringExecution.agents.leader.status).toBe('active');
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null,
        killed: false
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
    });

    it('should kill all MCP server processes', async () => {
      const processes: any[] = [];
      
      vi.mocked(child_process.spawn).mockImplementation(() => {
        const proc = {
          on: vi.fn(),
          stderr: { on: vi.fn() },
          stdout: { on: vi.fn() },
          kill: vi.fn(),
          exitCode: null
        };
        processes.push(proc);
        return proc as any;
      });
      
      // Re-initialize to capture processes
      orchestrator = new SwarmOrchestrator();
      await orchestrator.initialize();
      
      await orchestrator.shutdown();
      
      processes.forEach(proc => {
        expect(proc.kill).toHaveBeenCalled();
      });
    });

    it('should emit shutdown event', async () => {
      const shutdownListener = vi.fn();
      orchestrator.on('shutdown', shutdownListener);
      
      await orchestrator.shutdown();
      
      expect(shutdownListener).toHaveBeenCalled();
    });

    it('should clear all internal state', async () => {
      await orchestrator.executeTask('Test');
      
      let statusBefore = orchestrator.getStatus();
      expect(statusBefore.results.length).toBeGreaterThan(0);
      
      await orchestrator.shutdown();
      
      const statusAfter = orchestrator.getStatus();
      expect(Object.keys(statusAfter.agents)).toHaveLength(3); // Still shows config
      expect(statusAfter.results).toHaveLength(0); // But results cleared
    });
  });

  describe('error handling', () => {
    it('should throw error when no main agent configured', async () => {
      mockSwarmManager.getMainAgent.mockReturnValue(null);
      
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      await orchestrator.initialize();
      
      await expect(orchestrator.executeTask('Test')).rejects.toThrow('No main agent configured');
    });

    it('should handle MCP server spawn failures', async () => {
      vi.mocked(child_process.spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });
      
      const errorListener = vi.fn();
      orchestrator.on('mcp-error', errorListener);
      
      await orchestrator.initialize();
      
      expect(errorListener).toHaveBeenCalled();
    });

    it('should handle invalid agent names in delegation', async () => {
      mockToolManager.runTool.mockResolvedValue(
        'DELEGATE TO [nonexistent]: Do something'
      );
      
      const results = await orchestrator.executeTask('Test');
      
      // Should only have the main agent result
      expect(results).toHaveLength(1);
      expect(results[0].agentName).toBe('leader');
    });
  });
});