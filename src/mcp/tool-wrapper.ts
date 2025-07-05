import { MCPTool } from './server';
import { SessionTracker } from '../core/session-tracker';
import * as vscode from 'vscode';

/**
 * Wraps MCP tools with session tracking
 */
export function wrapToolWithTracking(
    tool: MCPTool,
    context: vscode.ExtensionContext
): MCPTool {
    const tracker = SessionTracker.getInstance(context);
    
    return {
        ...tool,
        handler: async (args: any) => {
            const startTime = Date.now();
            let result: any;
            let error: Error | undefined;
            
            try {
                // Track tool usage start
                await tracker.trackToolUsage(tool.name, args);
                
                // Execute original handler
                result = await tool.handler(args);
                
                // Track successful completion
                await tracker.trackToolUsage(tool.name, args, {
                    success: true,
                    duration: Date.now() - startTime,
                    resultPreview: typeof result === 'string' 
                        ? result.substring(0, 200) 
                        : JSON.stringify(result).substring(0, 200)
                });
                
                return result;
            } catch (err) {
                error = err as Error;
                
                // Track error
                await tracker.trackError(error, `Tool execution failed: ${tool.name}`);
                await tracker.trackToolUsage(tool.name, args, {
                    success: false,
                    duration: Date.now() - startTime,
                    error: error.message
                });
                
                throw err;
            }
        }
    };
}

/**
 * Wrap all tools in a collection with tracking
 */
export function wrapToolsWithTracking(
    tools: MCPTool[],
    context: vscode.ExtensionContext
): MCPTool[] {
    return tools.map(tool => wrapToolWithTracking(tool, context));
}