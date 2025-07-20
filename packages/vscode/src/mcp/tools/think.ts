import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { MCPTool } from '../server';

interface ThoughtEntry {
    id: string;
    timestamp: Date;
    category: string;
    content: string;
    metadata?: Record<string, any>;
}

export function createThinkTool(context: vscode.ExtensionContext): MCPTool {
    const THOUGHTS_FILE = path.join(os.homedir(), '.hanzo', 'thoughts.jsonl');
    
    async function saveThought(thought: ThoughtEntry) {
        await fs.mkdir(path.dirname(THOUGHTS_FILE), { recursive: true });
        await fs.appendFile(THOUGHTS_FILE, JSON.stringify(thought) + '\n');
    }
    
    return {
        name: 'think',
        description: 'Structured thinking and reasoning space',
        inputSchema: {
            type: 'object',
            properties: {
                thought: {
                    type: 'string',
                    description: 'Your thought process or reasoning'
                },
                category: {
                    type: 'string',
                    enum: ['analysis', 'planning', 'debugging', 'design', 'reflection', 'hypothesis'],
                    description: 'Type of thinking'
                },
                metadata: {
                    type: 'object',
                    description: 'Additional context or data'
                }
            },
            required: ['thought']
        },
        handler: async (args: { thought: string; category?: string; metadata?: any }) => {
            const entry: ThoughtEntry = {
                id: Date.now().toString(),
                timestamp: new Date(),
                category: args.category || 'analysis',
                content: args.thought,
                metadata: args.metadata
            };
            
            // Save to file for persistence
            await saveThought(entry);
            
            // Also store recent thoughts in memory
            const recentThoughts = context.globalState.get<ThoughtEntry[]>('recentThoughts', []);
            recentThoughts.push(entry);
            
            // Keep only last 100 thoughts in memory
            if (recentThoughts.length > 100) {
                recentThoughts.shift();
            }
            
            await context.globalState.update('recentThoughts', recentThoughts);
            
            // Return structured response
            return `Thought recorded (${entry.category}):
${entry.content}

This thought has been saved for future reference. Use this space to:
- Break down complex problems
- Plan implementation approaches
- Debug issues systematically
- Design system architectures
- Reflect on decisions made
- Form and test hypotheses`;
        }
    };
}

export function createCriticTool(context: vscode.ExtensionContext): MCPTool {
    return {
        name: 'critic',
        description: 'Critical analysis and code review',
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Code to review'
                },
                file: {
                    type: 'string',
                    description: 'File path to review'
                },
                aspect: {
                    type: 'string',
                    enum: ['security', 'performance', 'readability', 'correctness', 'all'],
                    description: 'Aspect to focus on (default: all)'
                }
            }
        },
        handler: async (args: { code?: string; file?: string; aspect?: string }) => {
            let codeToReview = args.code;
            
            if (args.file) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(args.file));
                    codeToReview = Buffer.from(content).toString('utf-8');
                } catch (error: any) {
                    return `Error reading file: ${error.message}`;
                }
            }
            
            if (!codeToReview) {
                return 'Error: No code provided for review';
            }
            
            const aspect = args.aspect || 'all';
            
            // Perform basic analysis
            const analysis = {
                lineCount: codeToReview.split('\n').length,
                hasConsoleLog: /console\.(log|error|warn)/.test(codeToReview),
                hasTodo: /TODO|FIXME|HACK/.test(codeToReview),
                hasHardcodedValues: /["'](?:password|secret|key|token)["']\s*[:=]\s*["'][^"']+["']/.test(codeToReview),
                hasLongLines: codeToReview.split('\n').some(line => line.length > 120),
                complexity: estimateComplexity(codeToReview)
            };
            
            let review = '## Code Review\n\n';
            
            if (aspect === 'all' || aspect === 'security') {
                review += '### Security\n';
                if (analysis.hasHardcodedValues) {
                    review += '⚠️ Potential hardcoded secrets detected\n';
                }
                if (codeToReview.includes('eval(') || codeToReview.includes('exec(')) {
                    review += '⚠️ Dangerous eval/exec usage detected\n';
                }
                review += '\n';
            }
            
            if (aspect === 'all' || aspect === 'performance') {
                review += '### Performance\n';
                if (codeToReview.includes('forEach') && codeToReview.includes('await')) {
                    review += '⚠️ Potential async performance issue with forEach\n';
                }
                if (analysis.complexity > 10) {
                    review += `⚠️ High complexity detected (score: ${analysis.complexity})\n`;
                }
                review += '\n';
            }
            
            if (aspect === 'all' || aspect === 'readability') {
                review += '### Readability\n';
                if (analysis.hasLongLines) {
                    review += '⚠️ Lines exceeding 120 characters found\n';
                }
                if (analysis.hasTodo) {
                    review += 'ℹ️ TODO/FIXME comments found\n';
                }
                if (analysis.hasConsoleLog) {
                    review += 'ℹ️ Console logging statements found\n';
                }
                review += '\n';
            }
            
            review += `### Summary\n`;
            review += `- Lines of code: ${analysis.lineCount}\n`;
            review += `- Complexity score: ${analysis.complexity}/10\n`;
            
            return review;
        }
    };
}

function estimateComplexity(code: string): number {
    // Simple complexity estimation
    let score = 1;
    
    // Count control structures
    score += (code.match(/if\s*\(/g) || []).length * 0.5;
    score += (code.match(/for\s*\(/g) || []).length * 0.7;
    score += (code.match(/while\s*\(/g) || []).length * 0.7;
    score += (code.match(/catch\s*\(/g) || []).length * 0.3;
    
    // Count nesting
    const lines = code.split('\n');
    let maxNesting = 0;
    let currentNesting = 0;
    
    for (const line of lines) {
        currentNesting += (line.match(/{/g) || []).length;
        currentNesting -= (line.match(/}/g) || []).length;
        maxNesting = Math.max(maxNesting, currentNesting);
    }
    
    score += maxNesting * 0.5;
    
    return Math.min(10, Math.round(score));
}