import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MCPTool } from '../server';

const RULE_FILES = [
    '.cursorrules',
    '.claude_instructions',
    '.claude',
    '.continuerules',
    '.windsurfrules',
    '.aiderignore',
    '.llm_instructions',
    'CONVENTIONS.md',
    'CONTRIBUTING.md',
    'CODE_STYLE.md'
];

export function createRulesTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'rules',
        description: 'Read project rules and conventions',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Project path (default: workspace root)'
                },
                format: {
                    type: 'string',
                    enum: ['full', 'summary', 'list'],
                    description: 'Output format (default: full)'
                }
            }
        },
        handler: async (args: { path?: string; format?: string }) => {
            const searchPath = args.path || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '.';
            const format = args.format || 'full';
            
            const foundRules: Array<{ file: string; content: string }> = [];
            
            // Search for rule files
            for (const ruleFile of RULE_FILES) {
                const filePath = path.join(searchPath, ruleFile);
                
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    foundRules.push({ file: ruleFile, content });
                } catch {
                    // File doesn't exist
                }
            }
            
            // Also search in common locations
            const additionalPaths = ['.github', 'docs', '.vscode'];
            for (const dir of additionalPaths) {
                const dirPath = path.join(searchPath, dir);
                
                try {
                    const files = await fs.readdir(dirPath);
                    for (const file of files) {
                        if (file.toLowerCase().includes('convention') || 
                            file.toLowerCase().includes('style') ||
                            file.toLowerCase().includes('guide')) {
                            try {
                                const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
                                foundRules.push({ file: `${dir}/${file}`, content });
                            } catch {
                                // Skip
                            }
                        }
                    }
                } catch {
                    // Directory doesn't exist
                }
            }
            
            if (foundRules.length === 0) {
                return 'No project rules or conventions found';
            }
            
            switch (format) {
                case 'list':
                    return `Found ${foundRules.length} rule files:\n` +
                           foundRules.map(r => `- ${r.file}`).join('\n');
                
                case 'summary': {
                    let output = `Found ${foundRules.length} rule files:\n\n`;
                    
                    for (const rule of foundRules) {
                        const lines = rule.content.split('\n').filter(l => l.trim());
                        const preview = lines.slice(0, 3).join('\n');
                        output += `=== ${rule.file} ===\n${preview}\n...(${lines.length} lines total)\n\n`;
                    }
                    
                    return output.trim();
                }
                
                case 'full':
                default: {
                    let output = '';
                    
                    for (const rule of foundRules) {
                        output += `=== ${rule.file} ===\n${rule.content}\n\n`;
                    }
                    
                    return output.trim();
                }
            }
        }
    };
}