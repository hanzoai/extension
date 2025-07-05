import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { wrapToolsWithTracking } from '../tool-wrapper';
import { createFileSystemTools } from './filesystem';
import { createShellTools } from './shell';
import { createSearchTools } from './search';
import { createJupyterTools } from './jupyter';
import { createAgentTools } from './agent';
import { createTodoTools } from './todo';
import { createEditorTools } from './editor';
import { createDatabaseTools } from './database';
import { createLLMTools } from './llm';
import { createVectorTools } from './vector';
import { createMCPManagementTools } from './mcp-management';
import { createSystemTools } from './system';
import { createPaletteTools } from './config/palette';
import { createProcessTool } from './process';
import { createConfigTool } from './config/config';
import { createRulesTool } from './rules';
import { createThinkTool, createCriticTool } from './think';
import { createUnifiedTodoTool } from './todo-unified';
import { createUnifiedSearchTool } from './unified-search';
import { createWebFetchTool } from './web-fetch';
import { createZenTool } from './zen';
import { createBashTools } from './bash';
import { createGitSearchTools } from './git-search';
import { BatchTools } from './batch';
import { AITools } from './ai-tools';
import { createModeTool } from './mode';
import { createMCPRunnerTools } from './mcp-runner';
import { createBrowserTools } from './browser';
import { createMCPUniversalProxyTools } from './mcp-universal-proxy';
import { createHanzoPlatformMCPTools, registerUnixAliasTools } from './hanzo-platform-mcp';
import { createUnifiedReadTool, createUnifiedProjectAnalyzeTool, createUnixAliasTool, getCanonicalToolName } from './unified-tools';
import { DevToolManager, createDevTools } from './dev-tool';
// import { createASTAnalyzerTool } from './ast-analyzer';
// import { createTreeSitterAnalyzerTool } from './treesitter-analyzer';

export class MCPTools {
    private context: vscode.ExtensionContext;
    private tools: Map<string, MCPTool> = new Map();
    private enabledTools: Set<string> = new Set();
    private batchTools: BatchTools;
    private aiTools: AITools;
    private devToolManager: DevToolManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.batchTools = new BatchTools(context);
        this.aiTools = new AITools(context);
        this.devToolManager = new DevToolManager();
        this.loadEnabledTools();
    }

    async initialize() {
        console.log('[MCPTools] Initializing tools');
        
        // Register tool handlers for batch tool
        const toolHandlers = new Map<string, (args: any) => Promise<any>>();
        
        // Create all tools - unified without duplicates
        const allTools = [
            // File System (unified)
            createUnifiedReadTool(this.context),  // Replaces read from filesystem
            ...createFileSystemTools(this.context).filter(t => t.name !== 'read'),
            
            // Shell & Process
            ...createShellTools(this.context),
            ...createBashTools(this.context),
            createProcessTool(this.context),
            
            // Search (unified)
            ...createSearchTools(this.context),
            ...createGitSearchTools(this.context),
            createUnifiedSearchTool(this.context),
            
            // Development Tools
            ...createJupyterTools(this.context),
            ...createEditorTools(this.context),
            createUnifiedProjectAnalyzeTool(this.context),
            
            // AI & Agents
            ...createAgentTools(this.context),
            ...this.aiTools.getTools(),
            createThinkTool(this.context),
            createCriticTool(this.context),
            createZenTool(this.context),
            
            // Task Management
            ...createTodoTools(this.context),
            createUnifiedTodoTool(this.context),
            
            // Database & Storage
            ...createDatabaseTools(this.context),
            ...createVectorTools(this.context),
            
            // LLM & Platform
            ...createLLMTools(this.context),
            ...createHanzoPlatformMCPTools(this.context),
            
            // MCP Management
            ...createMCPManagementTools(this.context),
            ...createMCPRunnerTools(this.context),
            ...createMCPUniversalProxyTools(this.context),
            
            // Browser & Web
            ...createBrowserTools(this.context),
            createWebFetchTool(this.context),
            
            // Configuration & System
            ...createSystemTools(this.context),
            ...createPaletteTools(this.context),
            createConfigTool(this.context),
            createRulesTool(this.context),
            createModeTool(this.context),
            createUnixAliasTool(this.context),
            
            // Batch operations
            ...this.batchTools.getTools(),
            
            // Dev tools for agent spawning
            ...createDevTools(this.devToolManager),
            
            // Dynamic Unix aliases
            ...registerUnixAliasTools(this.context)
            // createASTAnalyzerTool(this.context),
            // createTreeSitterAnalyzerTool(this.context)
        ];
        
        // Wrap tools with session tracking
        const wrappedTools = wrapToolsWithTracking(allTools, this.context);
        
        // Register wrapped tools
        this.registerTools(wrappedTools);
        
        // Register tool handlers with batch tool
        for (const [name, tool] of this.tools) {
            this.batchTools.registerToolHandler(name, tool.handler);
        }
        
        console.log(`[MCPTools] Registered ${this.tools.size} tools`);
    }

    private registerTools(tools: MCPTool[]) {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
            
            // Check if tool is enabled
            if (this.isToolEnabled(tool.name)) {
                this.enabledTools.add(tool.name);
            }
        }
    }

    private loadEnabledTools() {
        // Load enabled tools from configuration
        const config = vscode.workspace.getConfiguration('hanzo.mcp');
        const enabled = config.get<string[]>('enabledTools', []);
        const disabled = config.get<string[]>('disabledTools', []);
        
        // Default enabled tools if not configured
        if (enabled.length === 0) {
            this.enabledTools = new Set([
                // File System
                'read', 'write', 'edit', 'multi_edit',
                'directory_tree', 'find_files',
                // Search
                'grep', 'search', 'symbols', 'unified_search',
                'git_search', 'content_replace', 'diff',
                // Shell
                'run_command', 'open', 'process',
                'bash', 'run_background', 'processes', 'pkill', 'logs',
                'npx', 'uvx',
                // Development
                'todo_read', 'todo_write', 'todo_unified',
                'think', 'critic',
                // Configuration
                'config', 'rules', 'palette', 'mode',
                // Database & AI
                'graph_db', 'vector_index', 'vector_search', 
                'vector_similar', 'document_store',
                // AI/LLM
                'zen', 'llm', 'consensus', 'llm_manage', 'agent',
                // Utility
                'batch', 'web_fetch', 'batch_search',
                // MCP
                'mcp',
                // Browser
                'browser', 'browser_close',
                // Dev tools
                'dev_spawn', 'dev_list', 'dev_status', 'dev_stop', 'dev_merge', 'dev_batch'
            ]);
        } else {
            this.enabledTools = new Set(enabled);
        }
        
        // Remove disabled tools
        for (const tool of disabled) {
            this.enabledTools.delete(tool);
        }
    }

    private isToolEnabled(toolName: string): boolean {
        const config = vscode.workspace.getConfiguration('hanzo.mcp');
        
        // Check category-level settings
        if (toolName.startsWith('write') || toolName === 'edit' || toolName === 'multi_edit') {
            if (config.get<boolean>('disableWriteTools', false)) {
                return false;
            }
        }
        
        if (toolName.includes('search') || toolName === 'grep' || toolName === 'symbols') {
            if (config.get<boolean>('disableSearchTools', false)) {
                return false;
            }
        }
        
        // Don't allow individual tool management tools (they're in config now)
        if (toolName === 'tool_enable' || toolName === 'tool_disable' || toolName === 'tool_list') {
            return false;
        }
        
        return this.enabledTools.has(toolName);
    }

    getAllTools(): MCPTool[] {
        const enabledTools: MCPTool[] = [];
        
        for (const [name, tool] of this.tools) {
            if (this.isToolEnabled(name)) {
                enabledTools.push(tool);
            }
        }
        
        return enabledTools;
    }

    getTool(name: string): MCPTool | undefined {
        if (this.isToolEnabled(name)) {
            return this.tools.get(name);
        }
        return undefined;
    }

    enableTool(name: string) {
        this.enabledTools.add(name);
        this.saveEnabledTools();
    }

    disableTool(name: string) {
        this.enabledTools.delete(name);
        this.saveEnabledTools();
    }

    private saveEnabledTools() {
        const config = vscode.workspace.getConfiguration('hanzo.mcp');
        config.update('enabledTools', Array.from(this.enabledTools), true);
    }

    getToolStats() {
        return {
            total: this.tools.size,
            enabled: this.enabledTools.size,
            disabled: this.tools.size - this.enabledTools.size,
            categories: {
                filesystem: this.countToolsInCategory(['read', 'write', 'edit', 'multi_edit', 'directory_tree']),
                search: this.countToolsInCategory(['grep', 'search', 'symbols', 'find_files']),
                shell: this.countToolsInCategory(['run_command', 'bash', 'open']),
                ai: this.countToolsInCategory(['agent', 'llm', 'consensus']),
                development: this.countToolsInCategory(['todo_read', 'todo_write', 'notebook_read', 'notebook_edit'])
            }
        };
    }

    private countToolsInCategory(toolNames: string[]): number {
        return toolNames.filter(name => this.enabledTools.has(name)).length;
    }
}