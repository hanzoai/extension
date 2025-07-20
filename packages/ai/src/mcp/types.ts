/**
 * MCP types for @hanzo/ai
 */

export interface MCPServer {
  name: string;
  transport: MCPTransport;
  metadata?: Record<string, any>;
}

export interface MCPTransport {
  type: 'stdio' | 'http' | 'websocket';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any; // JSON Schema
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: any[];
}