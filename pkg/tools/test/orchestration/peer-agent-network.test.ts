import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PeerAgentNetwork } from '../../../cli-tools/orchestration/peer-agent-network';
import { AgentSwarmConfig } from '../../../cli-tools/config/agent-swarm-config';
import * as child_process from 'child_process';
import * as fs from 'fs';

vi.mock('child_process');
vi.mock('fs');
vi.mock('../../../cli-tools/config/agent-swarm-config');

describe('PeerAgentNetwork', () => {
  let network: PeerAgentNetwork;
  let mockConfig: AgentSwarmConfig;
  
  const mockLocalLLMEndpoint = 'http://localhost:8080';
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    mockConfig = {
      version: 1,
      swarm: {
        name: 'Test Peer Network',
        main: 'orchestrator',
        instances: {
          orchestrator: {
            description: 'Main orchestrator',
            directory: '.',
            model: 'zen',
            prompt: 'You are the orchestrator',
            expose_as_mcp: true,
            mcp_port: 10000,
            connect_to_agents: ['developer', 'reviewer']
          },
          developer: {
            description: 'Developer agent',
            directory: './src',
            model: 'sonnet',
            prompt: 'You are a developer',
            expose_as_mcp: true,
            mcp_port: 10001,
            connect_to_agents: ['orchestrator', 'reviewer']
          },
          reviewer: {
            description: 'Code reviewer',
            directory: '.',
            model: 'haiku',
            prompt: 'You are a reviewer',
            expose_as_mcp: true,
            mcp_port: 10002,
            connect_to_agents: ['orchestrator', 'developer']
          }
        },
        shared_mcps: {
          github: { enabled: true, token: 'test-token' },
          linear: { enabled: true, apiKey: 'test-key' }
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with config and local LLM endpoint', async () => {
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      
      expect(network).toBeDefined();
      expect(network instanceof EventEmitter).toBe(true);
    });

    it('should start all peer agents', async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
      
      // Should spawn MCP server for each agent
      expect(child_process.spawn).toHaveBeenCalledTimes(3);
      
      // Verify each agent spawn
      const spawnCalls = vi.mocked(child_process.spawn).mock.calls;
      
      // Check orchestrator
      expect(spawnCalls[0][1]).toContain('--agent-name');
      expect(spawnCalls[0][1]).toContain('orchestrator');
      expect(spawnCalls[0][1]).toContain('--port');
      expect(spawnCalls[0][1]).toContain('10000');
    });

    it('should handle initialization errors', async () => {
      vi.mocked(child_process.spawn).mockImplementation(() => {
        throw new Error('Spawn failed');
      });
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      
      await expect(network.initialize()).rejects.toThrow();
    });
  });

  describe('task execution', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
    });

    it('should execute task with orchestrator', async () => {
      const mockOrchestratorCall = vi.fn().mockResolvedValue({
        status: 'success',
        result: 'Task completed',
        agents_used: ['developer', 'reviewer'],
        cost_analysis: {
          local_calls: 5,
          api_calls: 2,
          estimated_savings: 0.85
        }
      });
      
      // Mock the orchestrator execution
      network['callAgent'] = mockOrchestratorCall;
      
      const result = await network.executeTask('Build a feature');
      
      expect(mockOrchestratorCall).toHaveBeenCalledWith(
        'orchestrator',
        'Build a feature',
        expect.objectContaining({
          initial_task: true,
          use_local_llm: true
        })
      );
      
      expect(result).toMatchObject({
        status: 'success',
        result: 'Task completed'
      });
    });

    it('should handle critic review when enabled', async () => {
      const mockOrchestratorCall = vi.fn().mockResolvedValue({
        status: 'success',
        result: 'Feature built'
      });
      
      const mockCriticCall = vi.fn().mockResolvedValue({
        status: 'success',
        result: 'Review: Code looks good with minor suggestions'
      });
      
      network['callAgent'] = vi.fn()
        .mockImplementationOnce(mockOrchestratorCall)
        .mockImplementationOnce(mockCriticCall);
      
      const result = await network.executeTask('Build a feature', { includeCritic: true });
      
      expect(network['callAgent']).toHaveBeenCalledTimes(2);
      expect(result.critic_review).toBeDefined();
    });

    it('should track recursion depth', async () => {
      let callCount = 0;
      network['callAgent'] = vi.fn().mockImplementation(async (agent, task, context) => {
        callCount++;
        if (callCount > 5) {
          return {
            status: 'error',
            error: 'Maximum recursion depth reached'
          };
        }
        
        // Simulate recursive calls
        if (context.recursion_depth < 3) {
          await network['callAgent']('developer', 'subtask', {
            recursion_depth: context.recursion_depth + 1
          });
        }
        
        return { status: 'success', result: 'Done' };
      });
      
      const result = await network.executeTask('Complex task');
      
      expect(callCount).toBeGreaterThan(1);
      expect(result.status).toBe('success');
    });
  });

  describe('agent management', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345,
        exitCode: null
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
    });

    it('should get peer status', () => {
      const status = network.getStatus();
      
      expect(status.peers).toHaveLength(3);
      expect(status.peers.map(p => p.name)).toContain('orchestrator');
      expect(status.peers.map(p => p.name)).toContain('developer');
      expect(status.peers.map(p => p.name)).toContain('reviewer');
      
      status.peers.forEach(peer => {
        expect(peer.status).toBe('running');
        expect(peer.port).toBeGreaterThanOrEqual(10000);
        expect(peer.model).toBeDefined();
      });
    });

    it('should handle agent failures', async () => {
      // Simulate agent crash
      const peers = network['peers'];
      const developerPeer = peers.get('developer');
      
      if (developerPeer) {
        // Trigger error event
        const errorCallback = vi.mocked(developerPeer.process.on).mock.calls
          .find(call => call[0] === 'error')?.[1];
        
        if (errorCallback) {
          errorCallback(new Error('Agent crashed'));
        }
      }
      
      const status = network.getStatus();
      const devStatus = status.peers.find(p => p.name === 'developer');
      
      expect(devStatus?.error).toBeDefined();
    });

    it('should restart failed agents', async () => {
      const mockNewProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 54321
      };
      
      // Mock spawn to return new process on restart
      vi.mocked(child_process.spawn)
        .mockClear()
        .mockReturnValue(mockNewProcess as any);
      
      await network.restartAgent('developer');
      
      expect(child_process.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--agent-name', 'developer']),
        expect.any(Object)
      );
    });
  });

  describe('cost optimization', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
    });

    it('should track cost metrics', async () => {
      network['callAgent'] = vi.fn()
        .mockResolvedValueOnce({
          status: 'success',
          result: 'Done',
          cost_metrics: {
            local_llm_calls: 5,
            api_llm_calls: 2,
            tokens_saved: 15000
          }
        });
      
      await network.executeTask('Optimize code');
      
      const metrics = network.getCostMetrics();
      
      expect(metrics.total_local_calls).toBe(5);
      expect(metrics.total_api_calls).toBe(2);
      expect(metrics.estimated_savings).toBeGreaterThan(0);
    });

    it('should prefer local LLM for orchestration', async () => {
      let orchestratorCalls = 0;
      let apiCalls = 0;
      
      network['callAgent'] = vi.fn().mockImplementation(async (agent, task, context) => {
        if (agent === 'orchestrator') {
          orchestratorCalls++;
          expect(context.use_local_llm).toBe(true);
        } else {
          apiCalls++;
        }
        
        return { status: 'success', result: 'Done' };
      });
      
      await network.executeTask('Complex workflow');
      
      expect(orchestratorCalls).toBeGreaterThan(0);
    });
  });

  describe('peer communication', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
    });

    it('should handle agent-to-agent communication', async () => {
      const communicationLog: any[] = [];
      
      network['callAgent'] = vi.fn().mockImplementation(async (agent, task, context) => {
        communicationLog.push({ from: context.caller || 'user', to: agent, task });
        
        if (agent === 'developer' && !context.delegated) {
          // Developer calls reviewer
          await network['callAgent']('reviewer', 'Review my code', {
            caller: 'developer',
            delegated: true
          });
        }
        
        return { status: 'success', result: `${agent} completed: ${task}` };
      });
      
      await network.executeTask('Implement feature');
      
      // Check communication flow
      expect(communicationLog).toContainEqual(
        expect.objectContaining({
          from: 'user',
          to: 'orchestrator'
        })
      );
      
      expect(communicationLog).toContainEqual(
        expect.objectContaining({
          from: 'developer',
          to: 'reviewer'
        })
      );
    });

    it('should maintain full mesh connectivity', () => {
      const peers = network['peers'];
      
      // Every agent should be able to reach every other agent
      peers.forEach((peer, name) => {
        const config = mockConfig.swarm.instances[name];
        
        if (config.connect_to_agents) {
          expect(config.connect_to_agents.length).toBeGreaterThan(0);
          
          // Verify bidirectional connections
          config.connect_to_agents.forEach(targetAgent => {
            const targetConfig = mockConfig.swarm.instances[targetAgent];
            expect(targetConfig.connect_to_agents).toContain(name);
          });
        }
      });
    });
  });

  describe('shutdown', () => {
    beforeEach(async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345,
        killed: false
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      await network.initialize();
    });

    it('should shutdown all agents cleanly', async () => {
      const peers = network['peers'];
      const killMocks: any[] = [];
      
      peers.forEach(peer => {
        killMocks.push(peer.process.kill);
      });
      
      await network.shutdown();
      
      killMocks.forEach(killMock => {
        expect(killMock).toHaveBeenCalled();
      });
      
      expect(network.getStatus().peers).toHaveLength(0);
    });

    it('should emit shutdown event', async () => {
      const shutdownListener = vi.fn();
      network.on('shutdown', shutdownListener);
      
      await network.shutdown();
      
      expect(shutdownListener).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle missing orchestrator', async () => {
      const badConfig = {
        ...mockConfig,
        swarm: {
          ...mockConfig.swarm,
          instances: {
            developer: mockConfig.swarm.instances.developer
          }
        }
      };
      
      network = new PeerAgentNetwork(badConfig, mockLocalLLMEndpoint);
      
      await expect(network.executeTask('Test')).rejects.toThrow('orchestrator not found');
    });

    it('should handle network errors', async () => {
      const mockProcess = {
        on: vi.fn(),
        stderr: { 
          on: vi.fn((event, cb) => {
            if (event === 'data') {
              setTimeout(() => cb('Network error: Connection refused'), 100);
            }
          })
        },
        stdout: { on: vi.fn() },
        kill: vi.fn(),
        pid: 12345
      };
      
      vi.mocked(child_process.spawn).mockReturnValue(mockProcess as any);
      
      network = new PeerAgentNetwork(mockConfig, mockLocalLLMEndpoint);
      const errorListener = vi.fn();
      network.on('peer-error', errorListener);
      
      await network.initialize();
      
      // Wait for error to be emitted
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(errorListener).toHaveBeenCalled();
    });
  });
});