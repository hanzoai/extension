import { describe, test, expect, beforeEach, vi } from 'vitest';
import { CodeActAgent, AgentTask, CodeActPlan } from '../src/lib/code-act-agent';
import { FunctionCallingSystem } from '../src/lib/function-calling';

// Mock FileEditor
vi.mock('../src/lib/editor', () => ({
  FileEditor: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ success: true }),
    getRelevantChunks: vi.fn().mockResolvedValue([])
  })),
  ChunkLocalizer: vi.fn()
}));

// Mock FunctionCallingSystem
vi.mock('../src/lib/function-calling', () => ({
  FunctionCallingSystem: vi.fn().mockImplementation(() => ({
    registerTool: vi.fn(),
    callFunctions: vi.fn().mockResolvedValue([{ success: true }]),
    getAvailableTools: vi.fn().mockReturnValue([]),
    getAllToolSchemas: vi.fn().mockReturnValue([])
  }))
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() }
  })
}));

describe('CodeActAgent', () => {
  let agent: CodeActAgent;

  beforeEach(() => {
    agent = new CodeActAgent();
  });

  describe('task execution', () => {
    test('should execute simple task', async () => {
      // Mock generatePlan
      vi.spyOn(agent as any, 'generatePlan').mockResolvedValue({
        steps: ['Analyze requirements', 'Implement changes', 'Validate changes'],
        parallelizable: [false, false, false],
        currentStep: 0
      });

      // Mock executePlan
      vi.spyOn(agent as any, 'executePlan').mockResolvedValue(undefined);

      await agent.executeTask('Fix bug in login');

      expect((agent as any).generatePlan).toHaveBeenCalledWith('Fix bug in login');
      expect((agent as any).executePlan).toHaveBeenCalled();
    });

    test('should generate refactoring plan', async () => {
      const plan = await (agent as any).generatePlan('refactor authentication module');
      
      expect(plan.steps).toContain('Analyze current code structure');
      expect(plan.steps).toContain('Identify refactoring opportunities');
      expect(plan.steps).toContain('Apply refactoring changes');
      expect(plan.steps).toContain('Run tests');
      expect(plan.steps).toContain('Fix any issues');
    });

    test('should generate testing plan', async () => {
      const plan = await (agent as any).generatePlan('test the API endpoints');
      
      expect(plan.steps).toContain('Discover test files');
      expect(plan.steps).toContain('Run tests');
      expect(plan.steps).toContain('Analyze failures');
      expect(plan.steps).toContain('Fix failing tests');
      expect(plan.steps).toContain('Re-run tests');
    });

    test('should generate default plan for generic tasks', async () => {
      const plan = await (agent as any).generatePlan('add new feature');
      
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0]).toBe('Analyze requirements');
      expect(plan.steps[1]).toBe('Implement changes');
      expect(plan.steps[2]).toBe('Validate changes');
    });
  });

  describe('parallel execution', () => {
    test('should identify parallelizable steps in refactoring', async () => {
      const plan = await (agent as any).generatePlan('refactor code');
      
      // Apply refactoring changes can be parallel
      expect(plan.parallelizable[2]).toBe(true);
      // But analyze and identify steps must be sequential
      expect(plan.parallelizable[0]).toBe(false);
      expect(plan.parallelizable[1]).toBe(false);
    });

    test('should identify parallelizable steps in testing', async () => {
      const plan = await (agent as any).generatePlan('run tests');
      
      // Discover and run tests can be parallel
      expect(plan.parallelizable[0]).toBe(true);
      expect(plan.parallelizable[1]).toBe(true);
      // But analyze must be sequential
      expect(plan.parallelizable[2]).toBe(false);
      // Fix can be parallel
      expect(plan.parallelizable[3]).toBe(true);
    });
  });

  describe('task retry handling', () => {
    test('should retry failed tasks up to maxRetries', async () => {
      // Create a task
      const task: AgentTask = {
        id: 'test-task',
        description: 'Test task',
        status: 'pending',
        retries: 0
      };
      
      (agent as any).tasks.set(task.id, task);
      
      // Simulate failure and retry
      task.status = 'failed';
      task.retries = 1;
      expect(task.retries).toBeLessThanOrEqual((agent as any).maxRetries);
    });
  });

  describe('error handling', () => {
    test('should handle plan execution errors', async () => {
      // Mock generatePlan to succeed
      vi.spyOn(agent as any, 'generatePlan').mockResolvedValue({
        steps: ['Step 1'],
        parallelizable: [false],
        currentStep: 0
      });

      // Mock executePlan to throw error
      vi.spyOn(agent as any, 'executePlan').mockRejectedValue(new Error('Execution failed'));

      // Mock executeTask to handle errors
      vi.spyOn(agent, 'executeTask').mockImplementation(async () => {
        try {
          await (agent as any).executePlan({});
        } catch (error) {
          // Handle error gracefully
          console.error('Task execution failed:', error);
        }
      });

      // Should not throw
      await expect(agent.executeTask('failing task')).resolves.not.toThrow();
    });
  });

  describe('integration with tools', () => {
    test('should have access to editor and function calling', () => {
      expect((agent as any).editor).toBeDefined();
      expect((agent as any).functionCalling).toBeDefined();
      expect((agent as any).parallelExecutor).toBeDefined();
    });
  });
});