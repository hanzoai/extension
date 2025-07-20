/**
 * Core types for @hanzo/ai
 */

export interface ModelInterface {
  name?: string;
  complete(params: CompletionParams): Promise<CompletionResponse>;
  stream(params: CompletionParams): AsyncIterableIterator<StreamChunk>;
}

export interface CompletionParams {
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResponse {
  content?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCall;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, any>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: any; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ToolResult {
  id: string;
  result?: any;
  error?: string;
}