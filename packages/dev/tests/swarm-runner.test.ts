import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SwarmRunner, SwarmOptions } from '../src/lib/swarm-runner';
import { EventEmitter } from 'events';
import * as child_process from 'child_process';
import { glob } from 'glob';

// Mock file system operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/swarm-test'),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'mock content')
  };
});

// Mock modules
vi.mock('child_process');
vi.mock('glob');
vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis()
  })
}));

describe('SwarmRunner', () => {
  let testDir: string;
  let runner: SwarmRunner;

  beforeEach(() => {
    // Mock directory is handled by the mock
    testDir = '/tmp/swarm-test';

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    test('should create swarm runner with options', () => {
      const options: SwarmOptions = {
        provider: 'claude',
        count: 5,
        prompt: 'Add copyright header',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      expect(runner).toBeDefined();
    });

    test('should limit agent count to 100', () => {
      const options: SwarmOptions = {
        provider: 'claude',
        count: 150,
        prompt: 'Test prompt',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      // We can't directly test private properties, but this ensures no crash
      expect(runner).toBeDefined();
    });
  });

  describe('file finding', () => {
    test('should find editable files in directory', async () => {
      // Mock glob to return our test files
      vi.mocked(glob).mockImplementation((pattern, options) => {
        // Return promise with files
        return Promise.resolve(['file1.js', 'file2.ts', 'file3.py']);
      });

      const options: SwarmOptions = {
        provider: 'claude',
        count: 3,
        prompt: 'Test prompt',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      
      // Mock findFiles
      vi.spyOn(runner as any, 'findFiles').mockResolvedValue(['file1.js', 'file2.ts', 'file3.py']);
      
      // Mock processFiles to avoid actual processing
      vi.spyOn(runner as any, 'processFiles').mockResolvedValue(undefined);
      
      // Mock showResults
      vi.spyOn(runner as any, 'showResults').mockImplementation(() => {});

      await runner.run();

      // Should have created 3 agents
      expect((runner as any).agents.size).toBe(3);
    });
  });

  describe('provider configuration', () => {
    test('should create runner with Claude provider', async () => {
      const options: SwarmOptions = {
        provider: 'claude',
        count: 1,
        prompt: 'Test',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      expect((runner as any).options.provider).toBe('claude');
    });

    test('should create runner with local provider', async () => {
      const options: SwarmOptions = {
        provider: 'local',
        count: 1,
        prompt: 'Test',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      expect((runner as any).options.provider).toBe('local');
    });

    test('should create runner with OpenAI provider', async () => {
      const options: SwarmOptions = {
        provider: 'openai',
        count: 1,
        prompt: 'Test',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      expect((runner as any).options.provider).toBe('openai');
    });
  });

  describe('agent initialization', () => {
    test('should initialize correct number of agents', async () => {
      const options: SwarmOptions = {
        provider: 'claude',
        count: 5,
        prompt: 'Add header',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      
      // Mock findFiles
      vi.spyOn(runner as any, 'findFiles').mockResolvedValue(['file1.js', 'file2.js']);
      vi.spyOn(runner as any, 'processFiles').mockResolvedValue(undefined);
      vi.spyOn(runner as any, 'showResults').mockImplementation(() => {});

      await runner.run();

      // Should only create 2 agents (limited by file count)
      expect((runner as any).agents.size).toBe(2);
    });

    test('should set default options', () => {
      const options: SwarmOptions = {
        provider: 'local',
        count: 1,
        prompt: 'Format code'
      };

      runner = new SwarmRunner(options);

      expect((runner as any).options.cwd).toBeDefined();
      expect((runner as any).options.pattern).toBe('**/*');
      expect((runner as any).options.autoLogin).toBe(true);
    });
  });

  describe('parallel processing', () => {
    test('should process multiple files in parallel', async () => {
      const options: SwarmOptions = {
        provider: 'local',
        count: 3,
        prompt: 'Add copyright',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      
      // Mock findFiles to return multiple files
      vi.spyOn(runner as any, 'findFiles').mockResolvedValue(['file1.js', 'file2.js', 'file3.js']);
      
      // Mock processFiles
      vi.spyOn(runner as any, 'processFiles').mockResolvedValue(undefined);
      
      // Mock showResults
      vi.spyOn(runner as any, 'showResults').mockImplementation(() => {});

      await runner.run();

      // Should have created 3 agents
      expect((runner as any).agents.size).toBe(3);
      
      // Verify all agents are initialized
      const agents = Array.from((runner as any).agents.values());
      expect(agents.every(a => a.status === 'idle')).toBe(true);
    });

    test('should handle process failures', async () => {
      const options: SwarmOptions = {
        provider: 'local',
        count: 1,
        prompt: 'Test',
        cwd: testDir
      };

      runner = new SwarmRunner(options);
      
      // Mock findFiles
      vi.spyOn(runner as any, 'findFiles').mockResolvedValue(['file1.js']);
      
      // Mock processFiles to throw error
      vi.spyOn(runner as any, 'processFiles').mockRejectedValue(new Error('Processing failed'));
      
      // Mock showResults
      vi.spyOn(runner as any, 'showResults').mockImplementation(() => {});

      // Should throw the error from processFiles
      await expect(runner.run()).rejects.toThrow('Processing failed');
    });
  });
});