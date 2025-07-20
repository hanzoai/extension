/**
 * MCP Bridge
 * Bridges @hanzo/dev <-> @hanzo/mcp <-> Claude Code
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { MCPClient } from './client';
import { MCPServer } from './server';
import { Tool, Resource, Prompt } from './types';

export interface BridgeConfig {
  name: string;
  upstream?: {
    type: 'claude-code' | 'hanzo-mcp' | 'custom';
    endpoint?: string;
    auth?: any;
  };
  downstream?: {
    servers: MCPServerConfig[];
  };
  transform?: {
    tools?: (tool: Tool) => Tool;
    resources?: (resource: Resource) => Resource;
    prompts?: (prompt: Prompt) => Prompt;
  };
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class MCPBridge extends EventEmitter {
  private config: BridgeConfig;
  private upstreamClient?: MCPClient;
  private downstreamServers: Map<string, MCPServer> = new Map();
  private localServer?: MCPServer;
  private aggregatedTools: Map<string, Tool> = new Map();
  private aggregatedResources: Map<string, Resource> = new Map();
  private aggregatedPrompts: Map<string, Prompt> = new Map();
  
  constructor(config: BridgeConfig) {
    super();
    this.config = config;
  }
  
  async initialize(): Promise<void> {
    this.emit('init:start');
    
    // Connect to upstream (Claude Code or @hanzo/mcp)
    if (this.config.upstream) {
      await this.connectUpstream();
    }
    
    // Start downstream servers
    if (this.config.downstream) {
      await this.startDownstreamServers();
    }
    
    // Start local aggregation server
    await this.startLocalServer();
    
    this.emit('init:complete', {
      upstream: !!this.upstreamClient,
      downstream: this.downstreamServers.size,
      tools: this.aggregatedTools.size,
      resources: this.aggregatedResources.size,
      prompts: this.aggregatedPrompts.size
    });
  }
  
  private async connectUpstream(): Promise<void> {
    if (!this.config.upstream) return;
    
    this.upstreamClient = new MCPClient();
    
    switch (this.config.upstream.type) {
      case 'claude-code':
        await this.connectToClaudeCode();
        break;
        
      case 'hanzo-mcp':
        await this.connectToHanzoMCP();
        break;
        
      case 'custom':
        if (this.config.upstream.endpoint) {
          await this.upstreamClient.connect({
            endpoint: this.config.upstream.endpoint,
            auth: this.config.upstream.auth
          });
        }
        break;
    }
    
    // Subscribe to upstream changes
    if (this.upstreamClient) {
      this.upstreamClient.on('tools:changed', () => this.syncTools());
      this.upstreamClient.on('resources:changed', () => this.syncResources());
      this.upstreamClient.on('prompts:changed', () => this.syncPrompts());
      
      // Initial sync
      await this.syncTools();
      await this.syncResources();
      await this.syncPrompts();
    }
  }
  
  private async connectToClaudeCode(): Promise<void> {
    // Claude Code uses stdio MCP servers
    // We need to find and connect to Claude's MCP runtime
    const claudeConfigPath = this.findClaudeConfigPath();
    if (!claudeConfigPath) {
      throw new Error('Claude Code configuration not found');
    }
    
    // Read Claude's MCP configuration
    const config = await this.readClaudeConfig(claudeConfigPath);
    
    // Connect to Claude's MCP servers
    for (const server of config.mcpServers || []) {
      const downstream = await this.startMCPServer({
        name: `claude-${server.name}`,
        command: server.command,
        args: server.args,
        env: server.env
      });
      
      this.downstreamServers.set(`claude-${server.name}`, downstream);
    }
  }
  
  private async connectToHanzoMCP(): Promise<void> {
    // Connect to @hanzo/mcp server
    const endpoint = this.config.upstream?.endpoint || 'ws://localhost:3030/mcp';
    
    await this.upstreamClient!.connect({
      endpoint,
      auth: this.config.upstream?.auth
    });
  }
  
  private findClaudeConfigPath(): string | null {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    
    const possiblePaths = [
      path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'config.json'),
      path.join(os.homedir(), '.config', 'claude', 'config.json'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'config.json')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    
    return null;
  }
  
  private async readClaudeConfig(path: string): Promise<any> {
    const fs = require('fs').promises;
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content);
  }
  
  private async startDownstreamServers(): Promise<void> {
    if (!this.config.downstream) return;
    
    for (const serverConfig of this.config.downstream.servers) {
      const server = await this.startMCPServer(serverConfig);
      this.downstreamServers.set(serverConfig.name, server);
    }
  }
  
  private async startMCPServer(config: MCPServerConfig): Promise<MCPServer> {
    const server = new MCPServer({
      name: config.name,
      version: '1.0.0'
    });
    
    // Start the server process
    const proc = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Connect to the server
    await server.connectToProcess(proc);
    
    // Subscribe to server capabilities
    server.on('tools:added', (tools) => this.addTools(config.name, tools));
    server.on('resources:added', (resources) => this.addResources(config.name, resources));
    server.on('prompts:added', (prompts) => this.addPrompts(config.name, prompts));
    
    return server;
  }
  
  private async startLocalServer(): Promise<void> {
    this.localServer = new MCPServer({
      name: this.config.name,
      version: '1.0.0',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
        sampling: true
      }
    });
    
    // Register aggregated capabilities
    this.updateLocalServerCapabilities();
    
    // Start server
    await this.localServer.start();
    
    this.emit('server:started', {
      name: this.config.name,
      endpoint: this.localServer.getEndpoint()
    });
  }
  
  private async syncTools(): Promise<void> {
    if (!this.upstreamClient) return;
    
    const tools = await this.upstreamClient.listTools();
    
    for (const tool of tools) {
      const transformed = this.config.transform?.tools?.(tool) || tool;
      this.aggregatedTools.set(`upstream:${tool.name}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private async syncResources(): Promise<void> {
    if (!this.upstreamClient) return;
    
    const resources = await this.upstreamClient.listResources();
    
    for (const resource of resources) {
      const transformed = this.config.transform?.resources?.(resource) || resource;
      this.aggregatedResources.set(`upstream:${resource.uri}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private async syncPrompts(): Promise<void> {
    if (!this.upstreamClient) return;
    
    const prompts = await this.upstreamClient.listPrompts();
    
    for (const prompt of prompts) {
      const transformed = this.config.transform?.prompts?.(prompt) || prompt;
      this.aggregatedPrompts.set(`upstream:${prompt.name}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private addTools(source: string, tools: Tool[]): void {
    for (const tool of tools) {
      const transformed = this.config.transform?.tools?.(tool) || tool;
      this.aggregatedTools.set(`${source}:${tool.name}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private addResources(source: string, resources: Resource[]): void {
    for (const resource of resources) {
      const transformed = this.config.transform?.resources?.(resource) || resource;
      this.aggregatedResources.set(`${source}:${resource.uri}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private addPrompts(source: string, prompts: Prompt[]): void {
    for (const prompt of prompts) {
      const transformed = this.config.transform?.prompts?.(prompt) || prompt;
      this.aggregatedPrompts.set(`${source}:${prompt.name}`, transformed);
    }
    
    this.updateLocalServerCapabilities();
  }
  
  private updateLocalServerCapabilities(): void {
    if (!this.localServer) return;
    
    // Update tools
    this.localServer.setTools(Array.from(this.aggregatedTools.values()));
    
    // Update resources
    this.localServer.setResources(Array.from(this.aggregatedResources.values()));
    
    // Update prompts
    this.localServer.setPrompts(Array.from(this.aggregatedPrompts.values()));
    
    this.emit('capabilities:updated', {
      tools: this.aggregatedTools.size,
      resources: this.aggregatedResources.size,
      prompts: this.aggregatedPrompts.size
    });
  }
  
  // Tool execution routing
  async executeTool(toolName: string, args: any): Promise<any> {
    // Find which source provides this tool
    for (const [key, tool] of this.aggregatedTools) {
      if (tool.name === toolName) {
        const [source] = key.split(':');
        
        if (source === 'upstream' && this.upstreamClient) {
          return this.upstreamClient.callTool({ name: toolName, arguments: args });
        }
        
        const server = this.downstreamServers.get(source);
        if (server) {
          return server.executeTool(toolName, args);
        }
      }
    }
    
    throw new Error(`Tool '${toolName}' not found`);
  }
  
  // Resource access routing
  async readResource(uri: string): Promise<any> {
    // Find which source provides this resource
    for (const [key, resource] of this.aggregatedResources) {
      if (resource.uri === uri) {
        const [source] = key.split(':');
        
        if (source === 'upstream' && this.upstreamClient) {
          return this.upstreamClient.readResource(uri);
        }
        
        const server = this.downstreamServers.get(source);
        if (server) {
          return server.readResource(uri);
        }
      }
    }
    
    throw new Error(`Resource '${uri}' not found`);
  }
  
  // Get bridge status
  getStatus(): {
    name: string;
    upstream: boolean;
    downstream: string[];
    tools: number;
    resources: number;
    prompts: number;
    endpoint?: string;
  } {
    return {
      name: this.config.name,
      upstream: !!this.upstreamClient,
      downstream: Array.from(this.downstreamServers.keys()),
      tools: this.aggregatedTools.size,
      resources: this.aggregatedResources.size,
      prompts: this.aggregatedPrompts.size,
      endpoint: this.localServer?.getEndpoint()
    };
  }
  
  // Cleanup
  async shutdown(): Promise<void> {
    this.emit('shutdown:start');
    
    // Disconnect upstream
    if (this.upstreamClient) {
      await this.upstreamClient.disconnect();
    }
    
    // Stop downstream servers
    for (const server of this.downstreamServers.values()) {
      await server.stop();
    }
    
    // Stop local server
    if (this.localServer) {
      await this.localServer.stop();
    }
    
    this.emit('shutdown:complete');
  }
}

// Create bridges for common integrations
export function createClaudeBridge(name: string): MCPBridge {
  return new MCPBridge({
    name,
    upstream: {
      type: 'claude-code'
    },
    transform: {
      tools: (tool) => ({
        ...tool,
        name: `claude_${tool.name}`
      })
    }
  });
}

export function createHanzoBridge(name: string): MCPBridge {
  return new MCPBridge({
    name,
    upstream: {
      type: 'hanzo-mcp'
    },
    downstream: {
      servers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem']
        },
        {
          name: 'git',
          command: 'npx',
          args: ['@modelcontextprotocol/server-git']
        }
      ]
    }
  });
}