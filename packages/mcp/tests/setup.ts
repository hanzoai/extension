import { vi } from 'vitest';

// Import tools to ensure they are registered
import '../src/tools/index.js';

// Mock sharp which is used by various dependencies
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    png: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(() => Promise.resolve(Buffer.alloc(100)))
  }))
}));

// Mock @xenova/transformers
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(() => Promise.resolve({
    embed: vi.fn(() => Promise.resolve({
      data: new Float32Array(768).fill(0.1)
    }))
  })),
  env: {
    allowRemoteModels: true,
    localURL: '/models/'
  }
}));

// Mock lancedb
vi.mock('@lancedb/lancedb', () => ({
  connect: vi.fn(() => Promise.resolve({
    tableNames: vi.fn(() => Promise.resolve([])),
    createTable: vi.fn(() => Promise.resolve({
      add: vi.fn(),
      search: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([]))
      })),
      countRows: vi.fn(() => Promise.resolve(0))
    })),
    openTable: vi.fn(() => Promise.resolve({
      add: vi.fn(),
      search: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([]))
      })),
      countRows: vi.fn(() => Promise.resolve(0))
    }))
  }))
}));

// Mock vectordb
vi.mock('vectordb', () => ({
  connect: vi.fn()
}));

// Mock web-tree-sitter
vi.mock('web-tree-sitter', () => ({
  default: {
    init: vi.fn(() => Promise.resolve()),
    Language: {
      load: vi.fn()
    }
  }
}));