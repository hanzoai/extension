import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MCPTool } from '../server';

export function createFileSystemTools(context: vscode.ExtensionContext): MCPTool[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    return [
        {
            name: 'read',
            description: 'Read the contents of a file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to read'
                    },
                    offset: {
                        type: 'number',
                        description: 'Line number to start reading from (1-indexed)'
                    },
                    limit: {
                        type: 'number',
                        description: 'Maximum number of lines to read'
                    }
                },
                required: ['path']
            },
            handler: async (args: { path: string; offset?: number; limit?: number }) => {
                const filePath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const lines = content.split('\n');
                    
                    let startLine = (args.offset || 1) - 1;
                    let endLine = args.limit ? startLine + args.limit : lines.length;
                    
                    const selectedLines = lines.slice(startLine, endLine);
                    const result = selectedLines.map((line, index) => 
                        `${startLine + index + 1}: ${line}`
                    ).join('\n');
                    
                    return result;
                } catch (error: any) {
                    throw new Error(`Failed to read file: ${error.message}`);
                }
            }
        },
        
        {
            name: 'write',
            description: 'Write content to a file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to write'
                    },
                    content: {
                        type: 'string',
                        description: 'Content to write to the file'
                    }
                },
                required: ['path', 'content']
            },
            handler: async (args: { path: string; content: string }) => {
                const filePath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                
                try {
                    // Ensure directory exists
                    const dir = path.dirname(filePath);
                    await fs.mkdir(dir, { recursive: true });
                    
                    await fs.writeFile(filePath, args.content, 'utf-8');
                    return `File written successfully: ${filePath}`;
                } catch (error: any) {
                    throw new Error(`Failed to write file: ${error.message}`);
                }
            }
        },
        
        {
            name: 'edit',
            description: 'Edit a file by replacing exact text patterns',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to edit'
                    },
                    pattern: {
                        type: 'string',
                        description: 'Exact text pattern to find'
                    },
                    replacement: {
                        type: 'string',
                        description: 'Text to replace the pattern with'
                    },
                    replaceAll: {
                        type: 'boolean',
                        description: 'Replace all occurrences (default: false)'
                    }
                },
                required: ['path', 'pattern', 'replacement']
            },
            handler: async (args: { path: string; pattern: string; replacement: string; replaceAll?: boolean }) => {
                const filePath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                
                try {
                    let content = await fs.readFile(filePath, 'utf-8');
                    const originalContent = content;
                    
                    if (args.replaceAll) {
                        content = content.split(args.pattern).join(args.replacement);
                    } else {
                        const index = content.indexOf(args.pattern);
                        if (index === -1) {
                            throw new Error('Pattern not found in file');
                        }
                        content = content.substring(0, index) + args.replacement + content.substring(index + args.pattern.length);
                    }
                    
                    if (content === originalContent) {
                        return 'No changes made';
                    }
                    
                    await fs.writeFile(filePath, content, 'utf-8');
                    return `File edited successfully: ${filePath}`;
                } catch (error: any) {
                    throw new Error(`Failed to edit file: ${error.message}`);
                }
            }
        },
        
        {
            name: 'multi_edit',
            description: 'Make multiple edits to a file in one operation',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the file to edit'
                    },
                    edits: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                pattern: { type: 'string' },
                                replacement: { type: 'string' },
                                replaceAll: { type: 'boolean' }
                            },
                            required: ['pattern', 'replacement']
                        },
                        description: 'Array of edit operations to perform'
                    }
                },
                required: ['path', 'edits']
            },
            handler: async (args: { path: string; edits: Array<{ pattern: string; replacement: string; replaceAll?: boolean }> }) => {
                const filePath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                
                try {
                    let content = await fs.readFile(filePath, 'utf-8');
                    let changeCount = 0;
                    
                    for (const edit of args.edits) {
                        if (edit.replaceAll) {
                            const newContent = content.split(edit.pattern).join(edit.replacement);
                            if (newContent !== content) {
                                changeCount++;
                                content = newContent;
                            }
                        } else {
                            const index = content.indexOf(edit.pattern);
                            if (index !== -1) {
                                content = content.substring(0, index) + edit.replacement + content.substring(index + edit.pattern.length);
                                changeCount++;
                            }
                        }
                    }
                    
                    if (changeCount === 0) {
                        return 'No changes made';
                    }
                    
                    await fs.writeFile(filePath, content, 'utf-8');
                    return `File edited successfully with ${changeCount} changes: ${filePath}`;
                } catch (error: any) {
                    throw new Error(`Failed to edit file: ${error.message}`);
                }
            }
        },
        
        {
            name: 'directory_tree',
            description: 'Display directory structure as a tree',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the directory (default: workspace root)'
                    },
                    maxDepth: {
                        type: 'number',
                        description: 'Maximum depth to traverse (default: 3)'
                    },
                    showHidden: {
                        type: 'boolean',
                        description: 'Show hidden files and directories (default: false)'
                    }
                }
            },
            handler: async (args: { path?: string; maxDepth?: number; showHidden?: boolean }) => {
                const startPath = args.path ? 
                    (path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path)) : 
                    workspaceRoot;
                
                const maxDepth = args.maxDepth || 3;
                const showHidden = args.showHidden || false;
                
                async function buildTree(dir: string, prefix: string = '', depth: number = 0): Promise<string> {
                    if (depth > maxDepth) return '';
                    
                    let result = '';
                    const items = await fs.readdir(dir, { withFileTypes: true });
                    const filtered = showHidden ? items : items.filter(item => !item.name.startsWith('.'));
                    const sorted = filtered.sort((a, b) => {
                        if (a.isDirectory() !== b.isDirectory()) {
                            return a.isDirectory() ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });
                    
                    for (let i = 0; i < sorted.length; i++) {
                        const item = sorted[i];
                        const isLast = i === sorted.length - 1;
                        const connector = isLast ? '└── ' : '├── ';
                        const extension = isLast ? '    ' : '│   ';
                        
                        result += prefix + connector + item.name;
                        if (item.isDirectory()) {
                            result += '/\n';
                            if (depth < maxDepth) {
                                result += await buildTree(
                                    path.join(dir, item.name),
                                    prefix + extension,
                                    depth + 1
                                );
                            }
                        } else {
                            result += '\n';
                        }
                    }
                    
                    return result;
                }
                
                try {
                    const tree = await buildTree(startPath);
                    return path.basename(startPath) + '/\n' + tree;
                } catch (error: any) {
                    throw new Error(`Failed to build directory tree: ${error.message}`);
                }
            }
        },
        
        {
            name: 'find_files',
            description: 'Find files matching a pattern',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'File name pattern to search for (supports wildcards)'
                    },
                    path: {
                        type: 'string',
                        description: 'Directory to search in (default: workspace root)'
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of results to return (default: 100)'
                    }
                },
                required: ['pattern']
            },
            handler: async (args: { pattern: string; path?: string; maxResults?: number }) => {
                const searchPath = args.path ?
                    (path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path)) :
                    workspaceRoot;
                
                const maxResults = args.maxResults || 100;
                const results: string[] = [];
                
                // Convert pattern to glob pattern
                const globPattern = args.pattern.includes('*') ? args.pattern : `*${args.pattern}*`;
                
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(searchPath, `**/${globPattern}`),
                    '**/node_modules/**',
                    maxResults
                );
                
                for (const file of files) {
                    results.push(path.relative(workspaceRoot, file.fsPath));
                }
                
                if (results.length === 0) {
                    return 'No files found matching the pattern';
                }
                
                return results.join('\n');
            }
        }
    ];
}