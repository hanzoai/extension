/**
 * AST-based search tools for code intelligence
 */

import { Tool, ToolResult } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import Parser from 'web-tree-sitter';

// Initialize parsers for different languages
let parsersInitialized = false;
const parsers: Map<string, Parser> = new Map();
const languageMap: Map<string, Parser.Language> = new Map();

async function initializeParsers() {
  if (parsersInitialized) return;
  
  await Parser.init();
  
  // Load language grammars
  const languages = [
    { ext: ['js', 'mjs'], name: 'javascript', wasmPath: 'tree-sitter-javascript.wasm' },
    { ext: ['ts', 'tsx'], name: 'typescript', wasmPath: 'tree-sitter-typescript.wasm' },
    { ext: ['py'], name: 'python', wasmPath: 'tree-sitter-python.wasm' },
    { ext: ['rs'], name: 'rust', wasmPath: 'tree-sitter-rust.wasm' },
    { ext: ['go'], name: 'go', wasmPath: 'tree-sitter-go.wasm' },
  ];
  
  // Note: In production, you'd load the actual WASM files
  // For now, we'll use a simplified approach
  parsersInitialized = true;
}

function getLanguageFromFile(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1);
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'mjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'rb': 'ruby',
    'php': 'php',
  };
  return langMap[ext] || null;
}

export const astSearchTool: Tool = {
  name: 'ast_search',
  description: 'Search code using Abstract Syntax Tree patterns',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'AST pattern to search for (e.g., "function_declaration", "class_definition")'
      },
      path: {
        type: 'string',
        description: 'Directory or file to search',
        default: '.'
      },
      language: {
        type: 'string',
        description: 'Programming language (auto-detected if not specified)'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results',
        default: 50
      },
      includeContext: {
        type: 'boolean',
        description: 'Include surrounding context',
        default: true
      }
    },
    required: ['pattern']
  },
  handler: async (args) => {
    try {
      await initializeParsers();
      
      const results: string[] = [];
      const searchPath = args.path || '.';
      
      // Get files to search
      let files: string[] = [];
      const stat = await fs.stat(searchPath).catch(() => null);
      
      if (stat && stat.isFile()) {
        files = [searchPath];
      } else {
        // Search for source files
        const patterns = ['**/*.js', '**/*.ts', '**/*.tsx', '**/*.py', '**/*.rs', '**/*.go'];
        for (const pattern of patterns) {
          const matched = await glob(path.join(searchPath, pattern), {
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
            maxDepth: 10
          });
          files.push(...matched);
        }
      }
      
      // Search each file
      for (const file of files.slice(0, args.maxResults || 50)) {
        const content = await fs.readFile(file, 'utf-8');
        const language = args.language || getLanguageFromFile(file);
        
        if (!language) continue;
        
        // Simple pattern matching for now
        // In a full implementation, you'd use tree-sitter queries
        const matches = searchASTPattern(content, args.pattern, language);
        
        if (matches.length > 0) {
          results.push(`\n=== ${file} ===`);
          for (const match of matches) {
            results.push(match);
          }
        }
      }
      
      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No AST patterns found'
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: results.join('\n')
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error in AST search: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Simplified AST pattern matching
function searchASTPattern(content: string, pattern: string, language: string): string[] {
  const matches: string[] = [];
  const lines = content.split('\n');
  
  // Simple heuristic matching for common patterns
  const patterns: Record<string, RegExp[]> = {
    'function_declaration': [
      /function\s+(\w+)\s*\(/,  // JS function
      /def\s+(\w+)\s*\(/,        // Python def
      /fn\s+(\w+)\s*\(/,         // Rust fn
      /func\s+(\w+)\s*\(/,       // Go func
    ],
    'class_definition': [
      /class\s+(\w+)/,           // JS/Python/Java class
      /struct\s+(\w+)/,          // Rust/Go struct
      /interface\s+(\w+)/,       // TypeScript interface
    ],
    'method_call': [
      /(\w+)\s*\.\s*(\w+)\s*\(/,  // Object method call
      /(\w+)::\s*(\w+)\s*\(/,      // Rust/C++ static method
    ],
    'import_statement': [
      /import\s+.+\s+from\s+['"]/,  // ES6 import
      /import\s+['"]/,               // CommonJS import
      /require\s*\(['"]/,            // CommonJS require
      /use\s+\w+/,                   // Rust use
      /import\s+\w+/,                // Python/Go import
    ],
    'variable_declaration': [
      /(let|const|var)\s+(\w+)/,    // JS variable
      /(\w+)\s*:=\s*/,               // Go short variable
      /let\s+(mut\s+)?(\w+)/,        // Rust let
    ]
  };
  
  const searchPatterns = patterns[pattern] || [new RegExp(pattern, 'g')];
  
  lines.forEach((line, index) => {
    for (const regex of searchPatterns) {
      if (regex.test(line)) {
        const context = [];
        
        // Add context lines
        if (index > 0) context.push(`${index}: ${lines[index - 1]}`);
        context.push(`${index + 1}: ${line} <-- MATCH`);
        if (index < lines.length - 1) context.push(`${index + 2}: ${lines[index + 1]}`);
        
        matches.push(context.join('\n'));
        break;
      }
    }
  });
  
  return matches;
}

export const findSymbolTool: Tool = {
  name: 'find_symbol',
  description: 'Find symbol definitions (functions, classes, variables)',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to find'
      },
      type: {
        type: 'string',
        description: 'Symbol type: function, class, variable, method, or all',
        default: 'all'
      },
      path: {
        type: 'string',
        description: 'Directory to search',
        default: '.'
      },
      exact: {
        type: 'boolean',
        description: 'Exact match only',
        default: false
      }
    },
    required: ['symbol']
  },
  handler: async (args) => {
    try {
      const results: string[] = [];
      const searchPath = args.path || '.';
      
      // Get source files
      const patterns = ['**/*.js', '**/*.ts', '**/*.tsx', '**/*.py', '**/*.rs', '**/*.go'];
      let files: string[] = [];
      
      for (const pattern of patterns) {
        const matched = await glob(path.join(searchPath, pattern), {
          ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
          maxDepth: 10
        });
        files.push(...matched);
      }
      
      // Search for symbol
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const matches = findSymbolInFile(content, args.symbol, args.type || 'all', args.exact || false);
        
        if (matches.length > 0) {
          results.push(`\n=== ${file} ===`);
          results.push(...matches);
        }
      }
      
      if (results.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `Symbol '${args.symbol}' not found`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: results.join('\n')
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error finding symbol: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

function findSymbolInFile(content: string, symbol: string, type: string, exact: boolean): string[] {
  const matches: string[] = [];
  const lines = content.split('\n');
  
  const patterns: Record<string, RegExp[]> = {
    'function': [
      new RegExp(`function\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*\\(`, 'i'),
      new RegExp(`${exact ? symbol : `\\w*${symbol}\\w*`}\\s*[:=]\\s*function\\s*\\(`, 'i'),
      new RegExp(`${exact ? symbol : `\\w*${symbol}\\w*`}\\s*[:=]\\s*\\([^)]*\\)\\s*=>`, 'i'),
      new RegExp(`def\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*\\(`, 'i'),
      new RegExp(`fn\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*\\(`, 'i'),
      new RegExp(`func\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*\\(`, 'i'),
    ],
    'class': [
      new RegExp(`class\\s+${exact ? symbol : `\\w*${symbol}\\w*`}`, 'i'),
      new RegExp(`struct\\s+${exact ? symbol : `\\w*${symbol}\\w*`}`, 'i'),
      new RegExp(`interface\\s+${exact ? symbol : `\\w*${symbol}\\w*`}`, 'i'),
      new RegExp(`type\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*=`, 'i'),
    ],
    'variable': [
      new RegExp(`(let|const|var)\\s+${exact ? symbol : `\\w*${symbol}\\w*`}\\s*[:=]`, 'i'),
      new RegExp(`${exact ? symbol : `\\w*${symbol}\\w*`}\\s*:=`, 'i'),
    ],
    'method': [
      new RegExp(`\\.\\s*${exact ? symbol : `\\w*${symbol}\\w*`}\\s*\\(`, 'i'),
      new RegExp(`${exact ? symbol : `\\w*${symbol}\\w*`}\\s*:\\s*function\\s*\\(`, 'i'),
    ]
  };
  
  const searchPatterns = type === 'all' 
    ? Object.values(patterns).flat()
    : patterns[type] || [];
  
  lines.forEach((line, index) => {
    for (const pattern of searchPatterns) {
      if (pattern.test(line)) {
        const context = [];
        
        // Add context
        if (index > 0) context.push(`${index}: ${lines[index - 1]}`);
        context.push(`${index + 1}: ${line} <-- MATCH`);
        if (index < lines.length - 1) context.push(`${index + 2}: ${lines[index + 1]}`);
        
        matches.push(context.join('\n'));
        break;
      }
    }
  });
  
  return matches;
}

export const analyzeDependenciesTool: Tool = {
  name: 'analyze_dependencies',
  description: 'Analyze import dependencies in code',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File or directory to analyze',
        default: '.'
      },
      showExternal: {
        type: 'boolean',
        description: 'Show external dependencies',
        default: true
      },
      showInternal: {
        type: 'boolean',
        description: 'Show internal dependencies',
        default: true
      }
    }
  },
  handler: async (args) => {
    try {
      const results: string[] = [];
      const searchPath = args.path || '.';
      
      // Get files to analyze
      let files: string[] = [];
      const stat = await fs.stat(searchPath).catch(() => null);
      
      if (stat && stat.isFile()) {
        files = [searchPath];
      } else {
        const patterns = ['**/*.js', '**/*.ts', '**/*.tsx', '**/*.py', '**/*.go'];
        for (const pattern of patterns) {
          const matched = await glob(path.join(searchPath, pattern), {
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
            maxDepth: 10
          });
          files.push(...matched);
        }
      }
      
      const dependencies = new Map<string, Set<string>>();
      
      // Analyze each file
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        const deps = extractDependencies(content, file);
        
        if (deps.length > 0) {
          dependencies.set(file, new Set(deps));
        }
      }
      
      // Format results
      results.push('=== Dependency Analysis ===\n');
      
      for (const [file, deps] of dependencies) {
        results.push(`${file}:`);
        
        const external = Array.from(deps).filter(d => !d.startsWith('.'));
        const internal = Array.from(deps).filter(d => d.startsWith('.'));
        
        if (args.showExternal !== false && external.length > 0) {
          results.push('  External:');
          external.forEach(dep => results.push(`    - ${dep}`));
        }
        
        if (args.showInternal !== false && internal.length > 0) {
          results.push('  Internal:');
          internal.forEach(dep => results.push(`    - ${dep}`));
        }
        
        results.push('');
      }
      
      return {
        content: [{
          type: 'text',
          text: results.join('\n')
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error analyzing dependencies: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

function extractDependencies(content: string, filePath: string): string[] {
  const deps: string[] = [];
  const lines = content.split('\n');
  
  const importPatterns = [
    // ES6 imports
    /import\s+.*\s+from\s+['"](.*)['"]/,
    /import\s+['"](.*)['"]/,
    // CommonJS
    /require\s*\(['"](.*)['"]\)/,
    // Python
    /from\s+(\S+)\s+import/,
    /import\s+(\S+)/,
    // Go
    /import\s+"(.*)"/,
    // Rust
    /use\s+(\S+);/,
  ];
  
  lines.forEach(line => {
    for (const pattern of importPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        deps.push(match[1]);
      }
    }
  });
  
  return [...new Set(deps)];
}

// Export all AST tools
export const astTools = [
  astSearchTool,
  findSymbolTool,
  analyzeDependenciesTool
];