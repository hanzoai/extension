import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPTool } from '../server';

const execAsync = promisify(exec);

export function createSearchTools(context: vscode.ExtensionContext): MCPTool[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    return [
        {
            name: 'grep',
            description: 'Search for patterns in files using ripgrep',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Pattern to search for (supports regex)'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to search in (default: workspace root)'
                    },
                    fileType: {
                        type: 'string',
                        description: 'File type to search (e.g., "ts", "js")'
                    },
                    ignoreCase: {
                        type: 'boolean',
                        description: 'Case insensitive search (default: false)'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of results (default: 100)'
                    }
                },
                required: ['pattern']
            },
            handler: async (args: { 
                pattern: string; 
                path?: string; 
                fileType?: string; 
                ignoreCase?: boolean;
                maxResults?: number 
            }) => {
                const searchPath = args.path || workspaceRoot;
                const maxResults = args.maxResults || 100;
                
                // Try to use ripgrep first, fall back to VS Code search
                try {
                    let command = `rg "${args.pattern}" "${searchPath}"`;
                    if (args.ignoreCase) command += ' -i';
                    if (args.fileType) command += ` -t ${args.fileType}`;
                    command += ` -m ${maxResults} --no-heading --line-number`;
                    
                    const { stdout } = await execAsync(command);
                    return stdout.trim() || 'No matches found';
                } catch (error) {
                    // Fall back to simple file search
                    const pattern = args.fileType ? `**/*.${args.fileType}` : '**/*';
                    const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
                    const results: string[] = [];
                    
                    // Read files and search for pattern
                    for (const file of files) {
                        try {
                            const content = await vscode.workspace.fs.readFile(file);
                            const text = Buffer.from(content).toString('utf-8');
                            const lines = text.split('\n');
                            
                            lines.forEach((line, index) => {
                                const regex = new RegExp(args.pattern, args.ignoreCase ? 'gi' : 'g');
                                if (regex.test(line)) {
                                    const relativePath = path.relative(workspaceRoot, file.fsPath);
                                    results.push(`${relativePath}:${index + 1}: ${line.trim()}`);
                                }
                            });
                        } catch (e) {
                            // Skip files that can't be read
                        }
                    }
                    
                    return results.length > 0 ? results.slice(0, maxResults).join('\n') : 'No matches found';
                }
            }
        },

        {
            name: 'search',
            description: 'Unified search across files, symbols, and git history',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    type: {
                        type: 'string',
                        enum: ['all', 'text', 'symbol', 'ast', 'git'],
                        description: 'Type of search to perform (default: all)'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to search in'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum results per search type (default: 20)'
                    }
                },
                required: ['query']
            },
            handler: async (args: { 
                query: string; 
                type?: string; 
                path?: string;
                maxResults?: number 
            }) => {
                const searchType = args.type || 'all';
                const maxResults = args.maxResults || 20;
                const results: string[] = [];

                // Text search
                if (searchType === 'all' || searchType === 'text') {
                    const grepTool = createSearchTools(context).find(t => t.name === 'grep')!;
                    try {
                        const textResults = await grepTool.handler({
                            pattern: args.query,
                            path: args.path,
                            maxResults
                        });
                        if (textResults !== 'No matches found') {
                            results.push('=== Text Matches ===\n' + textResults);
                        }
                    } catch (error) {
                        // Ignore errors and continue
                    }
                }

                // Symbol search
                if (searchType === 'all' || searchType === 'symbol') {
                    const symbolTool = createSearchTools(context).find(t => t.name === 'symbols')!;
                    try {
                        const symbolResults = await symbolTool.handler({
                            query: args.query,
                            path: args.path,
                            maxResults
                        });
                        if (symbolResults !== 'No symbols found') {
                            results.push('\n=== Symbol Matches ===\n' + symbolResults);
                        }
                    } catch (error) {
                        // Ignore errors and continue
                    }
                }

                // Git history search
                if (searchType === 'all' || searchType === 'git') {
                    const gitTool = createSearchTools(context).find(t => t.name === 'git_search')!;
                    try {
                        const gitResults = await gitTool.handler({
                            query: args.query,
                            path: args.path,
                            maxResults
                        });
                        if (!gitResults.includes('No results found')) {
                            results.push('\n=== Git History ===\n' + gitResults);
                        }
                    } catch (error) {
                        // Ignore errors and continue
                    }
                }

                return results.length > 0 ? results.join('\n') : 'No results found';
            }
        },

        {
            name: 'symbols',
            description: 'Search for code symbols (functions, classes, etc.)',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Symbol name or pattern to search for'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to search in'
                    },
                    type: {
                        type: 'string',
                        enum: ['all', 'function', 'class', 'method', 'variable', 'interface'],
                        description: 'Type of symbol to search for'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of results (default: 50)'
                    }
                },
                required: ['query']
            },
            handler: async (args: { 
                query: string; 
                path?: string; 
                type?: string;
                maxResults?: number 
            }) => {
                const maxResults = args.maxResults || 50;
                const results: string[] = [];

                // Use VS Code's symbol provider
                const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider',
                    args.query
                );

                if (!symbols || symbols.length === 0) {
                    return 'No symbols found';
                }

                // Filter by path if specified
                let filtered = symbols;
                if (args.path) {
                    const searchPath = path.isAbsolute(args.path) ? 
                        args.path : 
                        path.join(workspaceRoot, args.path);
                    filtered = symbols.filter(s => s.location.uri.fsPath.startsWith(searchPath));
                }

                // Filter by symbol type if specified
                if (args.type && args.type !== 'all') {
                    const typeMap: Record<string, vscode.SymbolKind[]> = {
                        'function': [vscode.SymbolKind.Function],
                        'class': [vscode.SymbolKind.Class],
                        'method': [vscode.SymbolKind.Method],
                        'variable': [vscode.SymbolKind.Variable, vscode.SymbolKind.Constant],
                        'interface': [vscode.SymbolKind.Interface]
                    };
                    const allowedKinds = typeMap[args.type] || [];
                    filtered = filtered.filter(s => allowedKinds.includes(s.kind));
                }

                // Format results
                filtered.slice(0, maxResults).forEach(symbol => {
                    const relativePath = path.relative(workspaceRoot, symbol.location.uri.fsPath);
                    const line = symbol.location.range.start.line + 1;
                    const kindName = vscode.SymbolKind[symbol.kind];
                    results.push(`${relativePath}:${line} [${kindName}] ${symbol.name}`);
                });

                return results.length > 0 ? results.join('\n') : 'No symbols found';
            }
        },

        {
            name: 'git_search',
            description: 'Search in git history',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    type: {
                        type: 'string',
                        enum: ['commits', 'diffs', 'all'],
                        description: 'What to search in (default: all)'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to limit search to'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of results (default: 20)'
                    }
                },
                required: ['query']
            },
            handler: async (args: { 
                query: string; 
                type?: string; 
                path?: string;
                maxResults?: number 
            }) => {
                const searchType = args.type || 'all';
                const maxResults = args.maxResults || 20;
                const results: string[] = [];

                try {
                    // Search in commit messages
                    if (searchType === 'all' || searchType === 'commits') {
                        const commitCmd = `git log --grep="${args.query}" --oneline -n ${maxResults}`;
                        const { stdout: commits } = await execAsync(commitCmd, { cwd: workspaceRoot });
                        if (commits.trim()) {
                            results.push('=== Commit Messages ===\n' + commits.trim());
                        }
                    }

                    // Search in diffs
                    if (searchType === 'all' || searchType === 'diffs') {
                        let diffCmd = `git log -G"${args.query}" --oneline -n ${maxResults}`;
                        if (args.path) {
                            diffCmd += ` -- ${args.path}`;
                        }
                        const { stdout: diffs } = await execAsync(diffCmd, { cwd: workspaceRoot });
                        if (diffs.trim()) {
                            results.push('\n=== Code Changes ===\n' + diffs.trim());
                        }
                    }

                    return results.length > 0 ? results.join('\n') : 'No results found in git history';
                } catch (error: any) {
                    throw new Error(`Git search failed: ${error.message}`);
                }
            }
        },

        {
            name: 'grep_ast',
            description: 'Search for AST patterns in code',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'AST pattern to search for (e.g., "function $NAME")'
                    },
                    language: {
                        type: 'string',
                        description: 'Programming language (e.g., "typescript", "javascript")'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to search in'
                    }
                },
                required: ['pattern']
            },
            handler: async (args: { pattern: string; language?: string; path?: string }) => {
                // This is a simplified version - in production, you'd use a proper AST parser
                // For now, we'll use regex patterns to simulate AST search
                const patterns: Record<string, string> = {
                    'function $NAME': '(function|const|let|var)\\s+(\\w+)\\s*[=:]?\\s*\\(',
                    'class $NAME': 'class\\s+(\\w+)',
                    'interface $NAME': 'interface\\s+(\\w+)',
                    'import $NAME': 'import\\s+.*\\s+from\\s+["\']([^"\']+)["\']'
                };

                const regexPattern = patterns[args.pattern] || args.pattern;
                const grepTool = createSearchTools(context).find(t => t.name === 'grep')!;
                
                return grepTool.handler({
                    pattern: regexPattern,
                    path: args.path,
                    fileType: args.language
                });
            }
        },

        {
            name: 'batch_search',
            description: 'Perform multiple searches in parallel',
            inputSchema: {
                type: 'object',
                properties: {
                    searches: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                query: { type: 'string' },
                                type: { type: 'string' },
                                path: { type: 'string' }
                            },
                            required: ['query']
                        },
                        description: 'Array of search operations to perform'
                    }
                },
                required: ['searches']
            },
            handler: async (args: { searches: Array<{ query: string; type?: string; path?: string }> }) => {
                const searchTool = createSearchTools(context).find(t => t.name === 'search')!;
                
                const results = await Promise.all(
                    args.searches.map(async (search, index) => {
                        try {
                            const result = await searchTool.handler(search);
                            return `\n=== Search ${index + 1}: "${search.query}" ===\n${result}`;
                        } catch (error: any) {
                            return `\n=== Search ${index + 1}: "${search.query}" ===\nError: ${error.message}`;
                        }
                    })
                );

                return results.join('\n');
            }
        }
    ];
}