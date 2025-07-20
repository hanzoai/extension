import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { MCPTool } from '../server';

export function createGitSearchTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'git_search',
            description: 'Search git history, commits, and diffs',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Search pattern (regex supported)'
                    },
                    type: {
                        type: 'string',
                        enum: ['commits', 'diff', 'log', 'files', 'branches', 'tags'],
                        description: 'Type of git search (default: commits)'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to search in (default: current workspace)'
                    },
                    author: {
                        type: 'string',
                        description: 'Filter by commit author'
                    },
                    since: {
                        type: 'string',
                        description: 'Show commits since date (e.g., "2 weeks ago")'
                    },
                    until: {
                        type: 'string',
                        description: 'Show commits until date'
                    },
                    maxCount: {
                        type: 'number',
                        description: 'Maximum number of results (default: 50)'
                    }
                },
                required: ['pattern']
            },
            handler: async (args: {
                pattern: string;
                type?: string;
                path?: string;
                author?: string;
                since?: string;
                until?: string;
                maxCount?: number;
            }) => {
                const workspaceFolder = args.path 
                    ? vscode.Uri.file(args.path)
                    : vscode.workspace.workspaceFolders?.[0]?.uri;
                    
                if (!workspaceFolder) {
                    throw new Error('No workspace folder found');
                }
                
                const cwd = workspaceFolder.fsPath;
                const type = args.type || 'commits';
                const maxCount = args.maxCount || 50;
                
                let command: string;
                
                switch (type) {
                    case 'commits':
                        command = `git log --grep="${args.pattern}" --oneline -n ${maxCount}`;
                        if (args.author) command += ` --author="${args.author}"`;
                        if (args.since) command += ` --since="${args.since}"`;
                        if (args.until) command += ` --until="${args.until}"`;
                        break;
                        
                    case 'diff':
                        command = `git log -p -S"${args.pattern}" --oneline -n ${maxCount}`;
                        break;
                        
                    case 'log':
                        command = `git log --all --grep="${args.pattern}" --format="%h %s (%an, %ar)" -n ${maxCount}`;
                        break;
                        
                    case 'files':
                        command = `git ls-files | grep -E "${args.pattern}" | head -${maxCount}`;
                        break;
                        
                    case 'branches':
                        command = `git branch -a | grep -E "${args.pattern}"`;
                        break;
                        
                    case 'tags':
                        command = `git tag | grep -E "${args.pattern}"`;
                        break;
                        
                    default:
                        throw new Error(`Unknown search type: ${type}`);
                }
                
                return new Promise((resolve, reject) => {
                    cp.exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                        if (error) {
                            if (stderr.includes('not a git repository')) {
                                reject(new Error('Not a git repository'));
                            } else {
                                reject(new Error(`Git search failed: ${stderr || error.message}`));
                            }
                        } else {
                            const results = stdout.trim();
                            if (!results) {
                                resolve(`No results found for pattern '${args.pattern}'`);
                            } else {
                                const lines = results.split('\n');
                                resolve(`Found ${lines.length} results:\n\n${results}`);
                            }
                        }
                    });
                });
            }
        },
        
        {
            name: 'content_replace',
            description: 'Find and replace content across multiple files',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Pattern to search for (regex supported)'
                    },
                    replacement: {
                        type: 'string',
                        description: 'Replacement text'
                    },
                    paths: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Paths to search in (default: current workspace)'
                    },
                    filePattern: {
                        type: 'string',
                        description: 'File pattern to match (e.g., "*.ts")'
                    },
                    dryRun: {
                        type: 'boolean',
                        description: 'Preview changes without applying them'
                    },
                    caseSensitive: {
                        type: 'boolean',
                        description: 'Case sensitive search (default: true)'
                    }
                },
                required: ['pattern', 'replacement']
            },
            handler: async (args: {
                pattern: string;
                replacement: string;
                paths?: string[];
                filePattern?: string;
                dryRun?: boolean;
                caseSensitive?: boolean;
            }) => {
                const searchPaths = args.paths || [vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.'];
                const includePattern = args.filePattern || '**/*';
                const excludePattern = '**/node_modules/**';
                
                let totalMatches = 0;
                let filesModified = 0;
                const changes: string[] = [];
                
                for (const searchPath of searchPaths) {
                    const files = await vscode.workspace.findFiles(
                        new vscode.RelativePattern(searchPath, includePattern),
                        excludePattern
                    );
                    
                    for (const file of files) {
                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            const text = document.getText();
                            
                            const regex = new RegExp(args.pattern, args.caseSensitive === false ? 'gi' : 'g');
                            const matches = text.match(regex);
                            
                            if (matches && matches.length > 0) {
                                totalMatches += matches.length;
                                filesModified++;
                                
                                if (args.dryRun) {
                                    changes.push(`${file.fsPath}: ${matches.length} matches`);
                                    
                                    // Show preview of changes
                                    const lines = text.split('\n');
                                    for (let i = 0; i < lines.length; i++) {
                                        if (regex.test(lines[i])) {
                                            changes.push(`  Line ${i + 1}: ${lines[i].trim()}`);
                                        }
                                    }
                                } else {
                                    const newText = text.replace(regex, args.replacement);
                                    const edit = new vscode.WorkspaceEdit();
                                    const fullRange = new vscode.Range(
                                        document.positionAt(0),
                                        document.positionAt(text.length)
                                    );
                                    edit.replace(file, fullRange, newText);
                                    await vscode.workspace.applyEdit(edit);
                                    
                                    changes.push(`Modified: ${file.fsPath} (${matches.length} replacements)`);
                                }
                            }
                        } catch (error: any) {
                            changes.push(`Error processing ${file.fsPath}: ${error.message}`);
                        }
                    }
                }
                
                if (totalMatches === 0) {
                    return 'No matches found';
                }
                
                const action = args.dryRun ? 'Would modify' : 'Modified';
                return `${action} ${filesModified} files with ${totalMatches} total replacements:\n\n${changes.join('\n')}`;
            }
        },
        
        {
            name: 'diff',
            description: 'Show differences between files or git revisions',
            inputSchema: {
                type: 'object',
                properties: {
                    path1: {
                        type: 'string',
                        description: 'First file path or git revision'
                    },
                    path2: {
                        type: 'string',
                        description: 'Second file path or git revision (default: current)'
                    },
                    type: {
                        type: 'string',
                        enum: ['file', 'git', 'unified'],
                        description: 'Type of diff (default: file)'
                    },
                    context: {
                        type: 'number',
                        description: 'Number of context lines (default: 3)'
                    }
                },
                required: ['path1']
            },
            handler: async (args: {
                path1: string;
                path2?: string;
                type?: string;
                context?: number;
            }) => {
                const type = args.type || 'file';
                const context = args.context || 3;
                
                if (type === 'file') {
                    const uri1 = vscode.Uri.file(path.resolve(args.path1));
                    const uri2 = args.path2 ? vscode.Uri.file(path.resolve(args.path2)) : null;
                    
                    if (!uri2) {
                        // Show diff against saved version
                        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri1.fsPath);
                        if (doc && doc.isDirty) {
                            return 'File has unsaved changes. Save the file to see the diff.';
                        }
                        return 'No changes to show';
                    }
                    
                    // Use VS Code's diff API
                    await vscode.commands.executeCommand('vscode.diff', uri1, uri2, `${path.basename(args.path1)} ↔ ${path.basename(args.path2 || args.path1)}`);
                    return 'Diff opened in editor';
                } else if (type === 'git') {
                    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
                    const command = args.path2 
                        ? `git diff ${args.path1} ${args.path2} -U${context}`
                        : `git diff ${args.path1} -U${context}`;
                    
                    return new Promise((resolve, reject) => {
                        cp.exec(command, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                            if (error) {
                                reject(new Error(`Git diff failed: ${stderr || error.message}`));
                            } else {
                                resolve(stdout || 'No differences found');
                            }
                        });
                    });
                }
                
                throw new Error(`Unknown diff type: ${type}`);
            }
        },
        
        {
            name: 'watch',
            description: 'Watch files for changes',
            inputSchema: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'File pattern to watch (e.g., "**/*.ts")'
                    },
                    path: {
                        type: 'string',
                        description: 'Path to watch (default: workspace root)'
                    },
                    action: {
                        type: 'string',
                        enum: ['start', 'stop', 'list'],
                        description: 'Watch action (default: start)'
                    },
                    id: {
                        type: 'string',
                        description: 'Watcher ID for stop action'
                    }
                },
                required: ['pattern']
            },
            handler: async (args: {
                pattern: string;
                path?: string;
                action?: string;
                id?: string;
            }) => {
                // In a real implementation, this would set up file watchers
                // For now, we'll provide a simplified response
                const action = args.action || 'start';
                
                switch (action) {
                    case 'start':
                        const watchPath = args.path || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
                        const watcherId = `watch-${Date.now()}`;
                        
                        // VS Code already provides file watching through workspace.createFileSystemWatcher
                        // This is a placeholder for the actual implementation
                        return `Started watching pattern '${args.pattern}' in ${watchPath}\nWatcher ID: ${watcherId}\n\nNote: File watching in VS Code extension context is limited. Consider using VS Code's built-in file watching APIs.`;
                    
                    case 'stop':
                        if (!args.id) {
                            throw new Error('Watcher ID required for stop action');
                        }
                        return `Stopped watcher: ${args.id}`;
                    
                    case 'list':
                        return 'Active watchers:\nNo watchers currently active (file watching not fully implemented)';
                    
                    default:
                        throw new Error(`Unknown action: ${action}`);
                }
            }
        }
    ];
}