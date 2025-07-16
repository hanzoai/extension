import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';
import { DEFAULT_IGNORED_PATTERNS } from '../constants/ignored-patterns';

// Types
export interface FileNode {
    path: string;
    type: 'file';
    content: string;
}

export interface DirectoryNode {
    path: string;
    type: 'directory';
    children: (FileNode | DirectoryNode)[];
}

interface DirectoryStats {
    size: number;
    fileCount: number;
}

// Constants
const CONFIG = {
    MAX_FILE_SIZE: 1024 * 50, // 50KB
    GITIGNORE_FILE: '.gitignore',
    HANZOIGNORE_FILE: '.hanzoignore'
};

// Utility functions
const formatSize = (size: number): string => {
    const sizeInMB = size / (1024 * 1024);
    return sizeInMB < 0.01 ?
        `${(size / 1024).toFixed(2)} KB` :
        `${sizeInMB.toFixed(2)} MB`;
};

export class FileCollectionService {
    private workspaceRoot: string;
    private ignoreFilter: ReturnType<typeof ignore>;
    private directorySizes: Map<string, DirectoryStats>;
    private ignoreReasons: Map<string, string>;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.ignoreFilter = ignore().add(DEFAULT_IGNORED_PATTERNS);
        this.directorySizes = new Map();
        this.ignoreReasons = new Map();
        
        // Log default ignore patterns
        console.log('[Hanzo] Default ignore patterns:', DEFAULT_IGNORED_PATTERNS);
    }

    public async initializeIgnorePatterns(): Promise<void> {
        try {
            // Read .gitignore patterns
            const gitignorePath = path.join(this.workspaceRoot, CONFIG.GITIGNORE_FILE);
            const gitignoreContent = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
            const gitignorePatterns = Buffer.from(gitignoreContent).toString('utf8').split('\n');
            const validGitignorePatterns = gitignorePatterns.filter(pattern => pattern && !pattern.startsWith('#'));
            
            // Process negated patterns first, then regular patterns
            const negatedPatterns: string[] = [];
            const regularPatterns: string[] = [];
            
            validGitignorePatterns.forEach(pattern => {
                if (pattern.startsWith('!')) {
                    negatedPatterns.push(pattern);
                } else {
                    regularPatterns.push(pattern);
                }
            });
            
            // Add regular patterns first
            if (regularPatterns.length > 0) {
                this.ignoreFilter.add(regularPatterns);
            }
            
            // Then add negated patterns to override
            if (negatedPatterns.length > 0) {
                this.ignoreFilter.add(negatedPatterns);
            }
            
            console.log('[Hanzo] Added .gitignore patterns:', validGitignorePatterns);
        } catch (error) {
            console.info('No .gitignore file found or unable to read it');
        }
        
        try {
            // Read .hanzoignore patterns
            const hanzoignorePath = path.join(this.workspaceRoot, CONFIG.HANZOIGNORE_FILE);
            const hanzoignoreContent = await vscode.workspace.fs.readFile(vscode.Uri.file(hanzoignorePath));
            const hanzoignorePatterns = Buffer.from(hanzoignoreContent).toString('utf8').split('\n');
            const validHanzoignorePatterns = hanzoignorePatterns.filter(pattern => pattern && !pattern.startsWith('#'));
            
            // Process negated patterns first, then regular patterns
            const negatedPatterns: string[] = [];
            const regularPatterns: string[] = [];
            
            validHanzoignorePatterns.forEach(pattern => {
                if (pattern.startsWith('!')) {
                    negatedPatterns.push(pattern);
                } else {
                    regularPatterns.push(pattern);
                }
            });
            
            // Add regular patterns first
            if (regularPatterns.length > 0) {
                this.ignoreFilter.add(regularPatterns);
            }
            
            // Then add negated patterns to override
            if (negatedPatterns.length > 0) {
                this.ignoreFilter.add(negatedPatterns);
            }
            
            console.log('[Hanzo] Added .hanzoignore patterns:', validHanzoignorePatterns);
        } catch (error) {
            console.info('No .hanzoignore file found or unable to read it');
        }
    }

    /**
     * Reads a .gitignore file from the specified directory and adds its patterns to the ignore filter
     * with proper scoping to that directory.
     * @param dirPath The absolute path to the directory containing the .gitignore file
     */
    private async readNestedGitignore(dirPath: string): Promise<void> {
        try {
            const gitignorePath = path.join(dirPath, CONFIG.GITIGNORE_FILE);
            const gitignoreContent = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
            const gitignorePatterns = Buffer.from(gitignoreContent).toString('utf8').split('\n');
            const validGitignorePatterns = gitignorePatterns.filter(pattern => pattern && !pattern.startsWith('#'));
            
            if (validGitignorePatterns.length > 0) {
                // Get the relative path to create a properly scoped ignore filter
                const relativeDirPath = path.relative(this.workspaceRoot, dirPath).replace(/\\/g, '/');
                const scopedPath = relativeDirPath ? `${relativeDirPath}/` : '';
                
                // Process patterns and add them to the ignore filter
                const negatedPatterns: string[] = [];
                const regularPatterns: string[] = [];
                
                validGitignorePatterns.forEach(pattern => {
                    // Handle negated patterns (patterns starting with !)
                    if (pattern.startsWith('!')) {
                        // For negated patterns, we need to scope them to the directory
                        const negatedPattern = pattern.substring(1);
                        if (negatedPattern.startsWith('/')) {
                            // Anchored negated pattern
                            negatedPatterns.push(`!${scopedPath}${negatedPattern.substring(1)}`);
                        } else {
                            // Non-anchored negated pattern - should apply to all subdirectories
                            // Add both direct match and **/ prefix for subdirectories
                            negatedPatterns.push(`!${scopedPath}${negatedPattern}`);
                            negatedPatterns.push(`!${scopedPath}**/${negatedPattern}`);
                        }
                    } else {
                        // For regular patterns, collect them to add later with scoping
                        // Handle patterns that start with / (anchored to the directory)
                        if (pattern.startsWith('/')) {
                            // Remove the leading / as we're already scoping it to the directory
                            regularPatterns.push(`${scopedPath}${pattern.substring(1)}`);
                        } else {
                            // For patterns that should match anywhere in the subtree
                            // Add both direct match and **/ prefix for subdirectories
                            regularPatterns.push(`${scopedPath}${pattern}`);
                            regularPatterns.push(`${scopedPath}**/${pattern}`);
                        }
                    }
                });
                
                // Add regular patterns first
                if (regularPatterns.length > 0) {
                    this.ignoreFilter.add(regularPatterns);
                }
                
                // Then add negated patterns to override
                if (negatedPatterns.length > 0) {
                    this.ignoreFilter.add(negatedPatterns);
                }
                
                console.log(`[Hanzo] Added nested .gitignore patterns from ${relativeDirPath || 'root'}:`, regularPatterns.concat(negatedPatterns));
            }
        } catch (error) {
            // No .gitignore file in this directory or unable to read it - this is normal
        }
    }

    private shouldIgnorePath(relativePath: string): boolean {
        if (!relativePath) {
            return false;
        }
        
        const isIgnored = this.ignoreFilter.ignores(relativePath);
        if (isIgnored) {
            // Try to determine which pattern caused the ignore
            let reason = 'Default ignore pattern';
            if (DEFAULT_IGNORED_PATTERNS.some(pattern => {
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                return regex.test(relativePath);
            })) {
                reason = 'Matched default ignore pattern';
            } else {
                reason = 'Matched .gitignore or .hanzoignore pattern';
            }
            this.ignoreReasons.set(relativePath, reason);
            console.log(`[Hanzo] Ignoring ${relativePath} - ${reason}`);
        } else {
            console.log(`[Hanzo] Including ${relativePath}`);
        }
        
        return isIgnored;
    }

    private async *scanDirectoryGenerator(dirPath: string): AsyncGenerator<FileNode | DirectoryNode> {
        const relativePath = path.relative(this.workspaceRoot, dirPath).replace(/\\/g, '/');
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }
        
        // Check for and process nested .gitignore files
        await this.readNestedGitignore(dirPath);
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
            const dirStats: DirectoryStats = { size: 0, fileCount: 0 };
            const children: (FileNode | DirectoryNode)[] = [];
            
            for (const [name, type] of entries) {
                const fullPath = path.join(dirPath, name);
                const entryRelativePath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');
                
                if (this.shouldIgnorePath(entryRelativePath)) {
                    continue;
                }
                
                if (type === vscode.FileType.Directory) {
                    const subDirNode: DirectoryNode = {
                        path: entryRelativePath,
                        type: 'directory',
                        children: []
                    };
                    
                    for await (const child of this.scanDirectoryGenerator(fullPath)) {
                        subDirNode.children.push(child);
                        if ('content' in child) {
                            dirStats.size += Buffer.from(child.content).length;
                            dirStats.fileCount++;
                        }
                    }
                    
                    // Always include directories that have passed ignore checks
                    children.push(subDirNode);
                    yield subDirNode;
                    
                } else {
                    try {
                        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                        if (stat.size <= CONFIG.MAX_FILE_SIZE) {
                            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                            const fileContent = Buffer.from(content).toString('utf8');
                            
                            const fileNode: FileNode = {
                                path: entryRelativePath,
                                type: 'file',
                                content: fileContent
                            };
                            
                            children.push(fileNode);
                            dirStats.size += stat.size;
                            dirStats.fileCount++;
                            yield fileNode;
                        }
                    } catch (error) {
                        console.error(`Error reading file ${entryRelativePath}:`, error);
                    }
                }
            }
            
            if (dirStats.size > 0) {
                this.directorySizes.set(relativePath || '.', dirStats);
            }
            
        } catch (error) {
            console.error(`Error scanning directory ${dirPath}:`, error);
        }
    }

    public async collectFiles(): Promise<(FileNode | DirectoryNode)[]> {
        console.log('\n[Hanzo] Starting file collection...');
        await this.initializeIgnorePatterns();
        
        const result: (FileNode | DirectoryNode)[] = [];
        for await (const node of this.scanDirectoryGenerator(this.workspaceRoot)) {
            result.push(node);
        }
        
        // Print summary after collection
        console.log('\n[Hanzo] File Collection Summary:');
        console.log('----------------------------------------');
        console.log('Included Files:');
        
        // Helper function to print file tree
        const printNode = (node: FileNode | DirectoryNode, indent = '') => {
            console.log(`${indent}✓ ${node.path}`);
            if (node.type === 'directory' && node.children) {
                node.children.forEach(child => printNode(child, indent + '  '));
            }
        };
        
        // Print all nodes in tree structure
        result.forEach(node => printNode(node));
        
        console.log('\nIgnored Files/Patterns:');
        this.ignoreReasons.forEach((reason, path) => {
            console.log(`✗ ${path} - ${reason}`);
        });
        
        console.log('----------------------------------------\n');
        return result;
    }

    public getDirectorySizeReport(): string {
        const sortedDirs = Array.from(this.directorySizes.entries())
            .filter(([, stats]) => stats.size > 0)
            .sort(([, a], [, b]) => b.size - a.size)
            .map(([dir, stats]) => {
                const fileStr = `${stats.fileCount} file${stats.fileCount === 1 ? '' : 's'}`;
                return `  ${dir || '.'}: ${formatSize(stats.size)} (${fileStr})`;
            });
        
        return sortedDirs.length === 0
            ? '[Hanzo] No directories with processable content found.'
            : '[Hanzo] Directory sizes (excluding ignored files):\n' + sortedDirs.join('\n');
    }

    public getTotalSize(): number {
        return Array.from(this.directorySizes.values())
            .reduce((total, stats) => total + stats.size, 0);
    }
}