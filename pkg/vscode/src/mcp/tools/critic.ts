import * as vscode from 'vscode';
import { MCPTool } from '../server';

interface CritiqueSession {
    id: string;
    subject: string;
    critiques: Array<{
        timestamp: Date;
        category: string;
        severity: string;
        issue: string;
        suggestion: string;
        context?: string;
    }>;
    summary?: string;
}

export function createCriticTool(context: vscode.ExtensionContext): MCPTool {
    const sessions = new Map<string, CritiqueSession>();
    
    return {
        name: 'critic',
        description: 'Structured critique and review tool for code, ideas, or solutions',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['critique', 'review', 'summarize', 'list'],
                    description: 'Action to perform (default: critique)'
                },
                subject: {
                    type: 'string',
                    description: 'What to critique (code, idea, solution, etc.)'
                },
                content: {
                    type: 'string',
                    description: 'The content to critique'
                },
                category: {
                    type: 'string',
                    enum: ['code', 'architecture', 'performance', 'security', 'usability', 'logic', 'style', 'general'],
                    description: 'Category of critique (default: general)'
                },
                severity: {
                    type: 'string',
                    enum: ['info', 'suggestion', 'warning', 'error', 'critical'],
                    description: 'Severity level (default: suggestion)'
                },
                session_id: {
                    type: 'string',
                    description: 'Session ID for grouped critiques'
                }
            },
            required: ['content']
        },
        handler: async (args: {
            action?: string;
            subject?: string;
            content: string;
            category?: string;
            severity?: string;
            session_id?: string;
        }) => {
            const action = args.action || 'critique';
            const sessionId = args.session_id || `critique-${Date.now()}`;
            
            switch (action) {
                case 'critique':
                case 'review': {
                    let session = sessions.get(sessionId);
                    if (!session) {
                        session = {
                            id: sessionId,
                            subject: args.subject || 'General Review',
                            critiques: []
                        };
                        sessions.set(sessionId, session);
                    }
                    
                    // Analyze the content and generate critiques
                    const critiques = analyzeContent(args.content, args.category || 'general');
                    
                    // Add to session
                    for (const critique of critiques) {
                        session.critiques.push({
                            timestamp: new Date(),
                            category: critique.category,
                            severity: critique.severity || args.severity || 'suggestion',
                            issue: critique.issue,
                            suggestion: critique.suggestion,
                            context: critique.context
                        });
                    }
                    
                    // Save sessions
                    await context.globalState.update('hanzo.critiqueSessions', Array.from(sessions.entries()));
                    
                    // Format response
                    let response = `## Critique Session: ${sessionId}\n\n`;
                    response += `**Subject**: ${session.subject}\n`;
                    response += `**Total Issues**: ${session.critiques.length}\n\n`;
                    
                    // Group by severity
                    const bySeverity = new Map<string, typeof session.critiques>();
                    for (const critique of critiques) {
                        const severity = critique.severity || args.severity || 'suggestion';
                        if (!bySeverity.has(severity)) {
                            bySeverity.set(severity, []);
                        }
                        bySeverity.get(severity)!.push({
                            ...critique,
                            timestamp: new Date(),
                            severity
                        });
                    }
                    
                    // Output by severity
                    const severityOrder = ['critical', 'error', 'warning', 'suggestion', 'info'];
                    for (const severity of severityOrder) {
                        const items = bySeverity.get(severity);
                        if (items && items.length > 0) {
                            response += `### ${severity.toUpperCase()} (${items.length})\n\n`;
                            for (const item of items) {
                                response += `- **${item.category}**: ${item.issue}\n`;
                                response += `  → ${item.suggestion}\n`;
                                if (item.context) {
                                    response += `  Context: ${item.context}\n`;
                                }
                                response += '\n';
                            }
                        }
                    }
                    
                    return response;
                }
                
                case 'summarize': {
                    const session = sessions.get(args.session_id || sessionId);
                    if (!session) {
                        return 'No critique session found';
                    }
                    
                    const summary = generateSummary(session);
                    session.summary = summary;
                    
                    await context.globalState.update('hanzo.critiqueSessions', Array.from(sessions.entries()));
                    
                    return summary;
                }
                
                case 'list': {
                    if (sessions.size === 0) {
                        return 'No critique sessions available';
                    }
                    
                    let response = '## Critique Sessions\n\n';
                    for (const [id, session] of sessions) {
                        response += `- **${id}**: ${session.subject} (${session.critiques.length} issues)\n`;
                    }
                    
                    return response;
                }
                
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        }
    };
    
    function analyzeContent(content: string, category: string): Array<{
        category: string;
        severity?: string;
        issue: string;
        suggestion: string;
        context?: string;
    }> {
        const critiques: Array<{
            category: string;
            severity?: string;
            issue: string;
            suggestion: string;
            context?: string;
        }> = [];
        
        // This is a simplified analysis - in a real implementation,
        // this would use more sophisticated analysis
        
        if (category === 'code' || category === 'general') {
            // Check for common code issues
            const lines = content.split('\n');
            
            // Long lines
            lines.forEach((line, index) => {
                if (line.length > 120) {
                    critiques.push({
                        category: 'style',
                        severity: 'suggestion',
                        issue: `Line ${index + 1} exceeds 120 characters`,
                        suggestion: 'Consider breaking long lines for better readability',
                        context: line.substring(0, 50) + '...'
                    });
                }
            });
            
            // TODO comments
            const todoMatches = content.match(/TODO|FIXME|HACK|XXX/gi);
            if (todoMatches) {
                critiques.push({
                    category: 'code',
                    severity: 'warning',
                    issue: `Found ${todoMatches.length} TODO/FIXME comments`,
                    suggestion: 'Address or create tickets for these items'
                });
            }
            
            // Console logs
            if (content.includes('console.log')) {
                critiques.push({
                    category: 'code',
                    severity: 'warning',
                    issue: 'Console.log statements found',
                    suggestion: 'Remove console.log statements or use proper logging'
                });
            }
            
            // Error handling
            if (content.includes('catch') && !content.includes('console.error') && !content.includes('logger')) {
                critiques.push({
                    category: 'code',
                    severity: 'warning',
                    issue: 'Catch blocks without proper error handling',
                    suggestion: 'Log errors appropriately in catch blocks'
                });
            }
        }
        
        if (category === 'security' || category === 'general') {
            // Check for security issues
            if (content.match(/password|secret|key|token/i) && content.match(/=\s*["'][^"']+["']/)) {
                critiques.push({
                    category: 'security',
                    severity: 'critical',
                    issue: 'Potential hardcoded secrets detected',
                    suggestion: 'Use environment variables or secure key management'
                });
            }
            
            if (content.includes('eval(') || content.includes('Function(')) {
                critiques.push({
                    category: 'security',
                    severity: 'error',
                    issue: 'Use of eval() or Function constructor',
                    suggestion: 'Avoid dynamic code execution for security'
                });
            }
        }
        
        if (category === 'performance' || category === 'general') {
            // Check for performance issues
            if (content.match(/for.*in\s+.*\.map\(/)) {
                critiques.push({
                    category: 'performance',
                    severity: 'suggestion',
                    issue: 'Nested loops with array methods',
                    suggestion: 'Consider optimizing nested iterations'
                });
            }
        }
        
        if (critiques.length === 0) {
            critiques.push({
                category: 'general',
                severity: 'info',
                issue: 'No specific issues found',
                suggestion: 'Code appears to follow basic standards'
            });
        }
        
        return critiques;
    }
    
    function generateSummary(session: CritiqueSession): string {
        const severityCounts = new Map<string, number>();
        const categoryCounts = new Map<string, number>();
        
        for (const critique of session.critiques) {
            severityCounts.set(critique.severity, (severityCounts.get(critique.severity) || 0) + 1);
            categoryCounts.set(critique.category, (categoryCounts.get(critique.category) || 0) + 1);
        }
        
        let summary = `## Critique Summary: ${session.subject}\n\n`;
        summary += `**Total Issues**: ${session.critiques.length}\n\n`;
        
        summary += '### By Severity\n';
        for (const [severity, count] of severityCounts) {
            summary += `- ${severity}: ${count}\n`;
        }
        
        summary += '\n### By Category\n';
        for (const [category, count] of categoryCounts) {
            summary += `- ${category}: ${count}\n`;
        }
        
        // Top recommendations
        summary += '\n### Top Recommendations\n';
        const critical = session.critiques.filter(c => c.severity === 'critical' || c.severity === 'error');
        if (critical.length > 0) {
            summary += '1. **Address critical issues first**:\n';
            for (const c of critical.slice(0, 3)) {
                summary += `   - ${c.issue}\n`;
            }
        } else {
            summary += '1. No critical issues found ✓\n';
        }
        
        return summary;
    }
}