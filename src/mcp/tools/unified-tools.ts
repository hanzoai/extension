import * as vscode from 'vscode';
import { MCPTool } from '../server';

/**
 * Unified Tool Definitions
 * 
 * This consolidates all tools from the Python Hanzo MCP implementation
 * ensuring no duplicates and maintaining feature parity.
 * 
 * Core principle: One tool per orthogonal concept
 */

// Tool mapping to ensure no duplicates
const TOOL_MAPPING = {
    // File Operations (unified)
    'read': ['read_files', 'read_file', 'cat'],
    'write': ['write_file', 'create_file'],
    'edit': ['edit_file', 'modify_file', 'sed'],
    'multi_edit': ['edit_files', 'bulk_edit'],
    
    // Directory Operations
    'directory_tree': ['tree', 'ls_tree', 'dir_tree'],
    'find_files': ['find', 'locate', 'search_files'],
    
    // Search Operations
    'grep': ['search_content', 'grep_files', 'rg'],
    'content_replace': ['replace_content', 'sed_replace'],
    'git_search': ['git_grep', 'search_git'],
    
    // Shell Operations
    'bash': ['run_command', 'shell', 'sh'],
    'run_script': ['execute_script', 'run'],
    
    // Development Tools
    'notebook_read': ['read_notebook', 'jupyter_read'],
    'notebook_edit': ['edit_notebook', 'jupyter_edit'],
    
    // AI/Agent Tools
    'agent': ['dispatch_agent', 'delegate'],
    'think': ['reason', 'analyze'],
    'critic': ['review', 'critique'],
    
    // Project Tools
    'project_analyze': ['analyze_project', 'project_info'],
    'todo_unified': ['todo', 'task_list'],
    
    // Platform Tools
    'mcp': ['mcp_proxy', 'mcp_universal'],
    'hanzo_mcp': ['platform_mcp', 'cloud_mcp'],
};

/**
 * Get canonical tool name from any alias
 */
export function getCanonicalToolName(toolName: string): string {
    for (const [canonical, aliases] of Object.entries(TOOL_MAPPING)) {
        if (toolName === canonical || aliases.includes(toolName)) {
            return canonical;
        }
    }
    return toolName;
}

/**
 * Enhanced file reading with all Python MCP features
 */
export function createUnifiedReadTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'read',
        description: 'Read files with encoding detection, line ranges, and multiple file support',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'File paths to read (single string also accepted)'
                },
                path: {
                    type: 'string',
                    description: 'Single file path (for compatibility)'
                },
                encoding: {
                    type: 'string',
                    default: 'utf-8',
                    description: 'File encoding'
                },
                start_line: {
                    type: 'number',
                    description: 'Starting line number (1-based)'
                },
                end_line: {
                    type: 'number',
                    description: 'Ending line number (inclusive)'
                }
            }
        },
        handler: async (args: any) => {
            const fs = require('fs').promises;
            const path = require('path');
            
            // Handle both paths array and single path
            const paths = args.paths || (args.path ? [args.path] : []);
            if (paths.length === 0) {
                return '❌ No file paths provided';
            }

            const results = [];
            for (const filePath of paths) {
                try {
                    // Resolve path
                    const resolvedPath = path.resolve(filePath);
                    
                    // Check permissions
                    const config = vscode.workspace.getConfiguration('hanzo.mcp');
                    const allowedPaths = config.get<string[]>('allowedPaths', []);
                    if (!isPathAllowed(resolvedPath, allowedPaths)) {
                        results.push(`❌ ${filePath}: Access denied`);
                        continue;
                    }

                    // Read file
                    let content = await fs.readFile(resolvedPath, args.encoding || 'utf-8');
                    
                    // Apply line range if specified
                    if (args.start_line || args.end_line) {
                        const lines = content.split('\n');
                        const start = (args.start_line || 1) - 1;
                        const end = args.end_line || lines.length;
                        content = lines.slice(start, end).join('\n');
                    }

                    results.push(`📄 ${filePath}:\n${content}`);
                } catch (error: any) {
                    results.push(`❌ ${filePath}: ${error.message}`);
                }
            }

            return results.join('\n\n---\n\n');
        }
    };
}

/**
 * Enhanced project analysis matching Python MCP features
 */
export function createUnifiedProjectAnalyzeTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'project_analyze',
        description: 'Analyze project structure, dependencies, and frameworks',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Project root path (defaults to workspace root)'
                },
                include_dependencies: {
                    type: 'boolean',
                    default: true,
                    description: 'Include dependency analysis'
                },
                include_structure: {
                    type: 'boolean',
                    default: true,
                    description: 'Include project structure'
                },
                max_depth: {
                    type: 'number',
                    default: 5,
                    description: 'Maximum directory depth for structure analysis'
                }
            }
        },
        handler: async (args: any) => {
            const projectPath = args.path || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!projectPath) {
                return '❌ No project path specified';
            }

            const fs = require('fs').promises;
            const path = require('path');
            
            let output = `# Project Analysis: ${path.basename(projectPath)}\n\n`;

            // Detect project type
            const projectType = await detectProjectType(projectPath);
            output += `## Project Type: ${projectType}\n\n`;

            // Analyze structure
            if (args.include_structure !== false) {
                output += `## Structure\n\`\`\`\n`;
                output += await generateTreeStructure(projectPath, args.max_depth || 5);
                output += `\n\`\`\`\n\n`;
            }

            // Analyze dependencies
            if (args.include_dependencies !== false) {
                output += `## Dependencies\n`;
                const deps = await analyzeDependencies(projectPath, projectType);
                output += deps + '\n\n';
            }

            // Framework detection
            output += `## Frameworks & Tools\n`;
            const frameworks = await detectFrameworks(projectPath);
            frameworks.forEach(f => output += `- ${f}\n`);

            return output;
        }
    };
}

/**
 * Unix command aliasing for modes
 */
export function createUnixAliasTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'alias',
        description: 'Create command aliases for use in modes',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Alias name'
                },
                command: {
                    type: 'string',
                    description: 'Command to alias'
                },
                description: {
                    type: 'string',
                    description: 'What this command does'
                }
            },
            required: ['name', 'command']
        },
        handler: async (args: any) => {
            const aliases = context.globalState.get<any>('command-aliases', {});
            aliases[args.name] = {
                command: args.command,
                description: args.description || `Alias for: ${args.command}`
            };
            
            await context.globalState.update('command-aliases', aliases);
            
            return `✅ Created alias '${args.name}' → '${args.command}'
            
This can now be used in modes:
\`\`\`javascript
mode: {
    tools: ['${args.name}']
}
\`\`\``;
        }
    };
}

// Helper functions

function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
    if (allowedPaths.length === 0) {
        // No restrictions if empty
        return true;
    }
    
    const normalizedPath = filePath.toLowerCase();
    return allowedPaths.some(allowed => 
        normalizedPath.startsWith(allowed.toLowerCase())
    );
}

async function detectProjectType(projectPath: string): Promise<string> {
    const fs = require('fs').promises;
    const path = require('path');
    
    // Check for common project files
    const checks = [
        { file: 'package.json', type: 'Node.js/JavaScript' },
        { file: 'pyproject.toml', type: 'Python (Poetry)' },
        { file: 'setup.py', type: 'Python' },
        { file: 'requirements.txt', type: 'Python' },
        { file: 'Cargo.toml', type: 'Rust' },
        { file: 'go.mod', type: 'Go' },
        { file: 'pom.xml', type: 'Java (Maven)' },
        { file: 'build.gradle', type: 'Java (Gradle)' },
        { file: 'Gemfile', type: 'Ruby' },
        { file: 'composer.json', type: 'PHP' },
        { file: '*.csproj', type: 'C#/.NET' },
        { file: 'CMakeLists.txt', type: 'C/C++ (CMake)' }
    ];

    for (const check of checks) {
        try {
            if (check.file.includes('*')) {
                // Pattern matching
                const files = await fs.readdir(projectPath);
                const pattern = check.file.replace('*', '.*');
                if (files.some((f: string) => f.match(pattern))) {
                    return check.type;
                }
            } else {
                await fs.access(path.join(projectPath, check.file));
                return check.type;
            }
        } catch {
            // File doesn't exist, continue
        }
    }

    return 'Unknown';
}

async function generateTreeStructure(dirPath: string, maxDepth: number, currentDepth: number = 0): Promise<string> {
    if (currentDepth >= maxDepth) return '';
    
    const fs = require('fs').promises;
    const path = require('path');
    
    const indent = '  '.repeat(currentDepth);
    let output = '';
    
    try {
        const items = await fs.readdir(dirPath);
        const filtered = items.filter((item: string) => 
            !item.startsWith('.') && 
            !['node_modules', '__pycache__', 'dist', 'build', '.git'].includes(item)
        );

        for (const item of filtered) {
            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);
            
            if (stats.isDirectory()) {
                output += `${indent}${item}/\n`;
                output += await generateTreeStructure(itemPath, maxDepth, currentDepth + 1);
            } else {
                output += `${indent}${item}\n`;
            }
        }
    } catch (error) {
        // Ignore errors
    }
    
    return output;
}

async function analyzeDependencies(projectPath: string, projectType: string): Promise<string> {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
        switch (projectType) {
            case 'Node.js/JavaScript': {
                const packageJson = JSON.parse(
                    await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
                );
                const deps = Object.keys(packageJson.dependencies || {});
                const devDeps = Object.keys(packageJson.devDependencies || {});
                return `- Dependencies: ${deps.length} (${deps.slice(0, 5).join(', ')}${deps.length > 5 ? '...' : ''})\n` +
                       `- Dev Dependencies: ${devDeps.length}`;
            }
            
            case 'Python':
            case 'Python (Poetry)': {
                // Try to read requirements.txt or pyproject.toml
                try {
                    const requirements = await fs.readFile(
                        path.join(projectPath, 'requirements.txt'), 'utf-8'
                    );
                    const lines = requirements.split('\n').filter((l: string) => l && !l.startsWith('#'));
                    return `- Dependencies: ${lines.length} packages`;
                } catch {
                    return '- Dependencies: Unable to analyze';
                }
            }
            
            default:
                return '- Dependencies: Analysis not implemented for this project type';
        }
    } catch (error) {
        return '- Dependencies: Unable to analyze';
    }
}

async function detectFrameworks(projectPath: string): Promise<string[]> {
    const fs = require('fs').promises;
    const path = require('path');
    const frameworks: string[] = [];
    
    // Check package.json for JS frameworks
    try {
        const packageJson = JSON.parse(
            await fs.readFile(path.join(projectPath, 'package.json'), 'utf-8')
        );
        const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies
        };
        
        const frameworkChecks = [
            { dep: 'react', name: 'React' },
            { dep: 'vue', name: 'Vue.js' },
            { dep: '@angular/core', name: 'Angular' },
            { dep: 'next', name: 'Next.js' },
            { dep: 'express', name: 'Express.js' },
            { dep: 'fastify', name: 'Fastify' },
            { dep: 'jest', name: 'Jest (testing)' },
            { dep: 'mocha', name: 'Mocha (testing)' },
            { dep: 'typescript', name: 'TypeScript' }
        ];
        
        frameworkChecks.forEach(check => {
            if (allDeps[check.dep]) {
                frameworks.push(check.name);
            }
        });
    } catch {
        // Not a Node.js project
    }
    
    // Check for Python frameworks
    try {
        const files = await fs.readdir(projectPath);
        if (files.includes('manage.py')) frameworks.push('Django');
        if (files.includes('app.py') || files.includes('application.py')) {
            // Could be Flask or FastAPI
            try {
                const content = await fs.readFile(
                    path.join(projectPath, files.includes('app.py') ? 'app.py' : 'application.py'),
                    'utf-8'
                );
                if (content.includes('flask')) frameworks.push('Flask');
                if (content.includes('fastapi')) frameworks.push('FastAPI');
            } catch {}
        }
    } catch {}
    
    return frameworks.length > 0 ? frameworks : ['No frameworks detected'];
}