import { vi } from 'vitest';

// Set up global test environment
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.HANZO_TEST = 'true';
  
  // Mock console to reduce noise
  global.console.log = vi.fn();
  global.console.error = vi.fn();
  global.console.warn = vi.fn();
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});

afterAll(() => {
  // Restore console
  vi.restoreAllMocks();
});

// Global timeout for async operations
export const TEST_TIMEOUT = 5000;

// Mock spawn globally to prevent real process spawning
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() }
  }),
  exec: vi.fn((cmd, callback) => {
    if (callback) callback(null, '', '');
  }),
  execSync: vi.fn(() => '')
}));

// Mock WebSocket globally
vi.mock('ws', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
    send: vi.fn()
  })),
  WebSocket: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
    send: vi.fn()
  }))
}));