/**
 * Error types for @hanzo/ai
 */

export class HanzoAIError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'HanzoAIError';
  }
}

export class AgentError extends HanzoAIError {
  constructor(message: string, public agentName: string) {
    super(message, 'AGENT_ERROR');
    this.name = 'AgentError';
  }
}

export class NetworkError extends HanzoAIError {
  constructor(message: string, public networkName: string) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

export class ToolError extends HanzoAIError {
  constructor(message: string, public toolName: string) {
    super(message, 'TOOL_ERROR');
    this.name = 'ToolError';
  }
}

export class MCPError extends HanzoAIError {
  constructor(message: string, public serverName?: string) {
    super(message, 'MCP_ERROR');
    this.name = 'MCPError';
  }
}

export class ValidationError extends HanzoAIError {
  constructor(message: string, public field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}