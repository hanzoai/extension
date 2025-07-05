import { EventEmitter } from 'events';
import * as net from 'net';
import { MCPTool, MCPPrompt } from './server';

interface MCPMessage {
    jsonrpc: '2.0';
    id?: number | string;
    method?: string;
    params?: any;
    result?: any;
    error?: any;
}

export class MCPClient extends EventEmitter {
    private transport: 'stdio' | 'tcp';
    private options?: { port?: number; host?: string };
    private socket?: net.Socket;
    private messageId: number = 0;
    private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
    private buffer: string = '';

    constructor(transport: 'stdio' | 'tcp', options?: { port?: number; host?: string }) {
        super();
        this.transport = transport;
        this.options = options;
    }

    async connect(): Promise<void> {
        if (this.transport === 'stdio') {
            // For stdio transport, we communicate via stdin/stdout
            process.stdin.on('data', this.handleData.bind(this));
            console.log('[MCPClient] Connected via stdio');
        } else {
            // For TCP transport, connect to server
            const port = this.options?.port || 3000;
            const host = this.options?.host || 'localhost';
            
            return new Promise((resolve, reject) => {
                this.socket = net.createConnection({ port, host }, () => {
                    console.log(`[MCPClient] Connected to TCP server at ${host}:${port}`);
                    resolve();
                });

                this.socket.on('data', this.handleData.bind(this));
                this.socket.on('error', reject);
                this.socket.on('close', () => {
                    console.log('[MCPClient] Connection closed');
                    this.emit('close');
                });
            });
        }
    }

    private handleData(data: Buffer) {
        this.buffer += data.toString();
        
        // Process complete messages
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message: MCPMessage = JSON.parse(line);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('[MCPClient] Failed to parse message:', error);
                }
            }
        }
    }

    private handleMessage(message: MCPMessage) {
        if (message.id !== undefined) {
            // Response to a request
            const pending = this.pendingRequests.get(message.id as number);
            if (pending) {
                this.pendingRequests.delete(message.id as number);
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
        } else if (message.method) {
            // Notification or request from server
            this.emit('notification', message);
        }
    }

    private sendMessage(message: MCPMessage): void {
        const data = JSON.stringify(message) + '\n';
        
        if (this.transport === 'stdio') {
            process.stdout.write(data);
        } else if (this.socket) {
            this.socket.write(data);
        }
    }

    private async sendRequest(method: string, params?: any): Promise<any> {
        const id = ++this.messageId;
        
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            
            this.sendMessage({
                jsonrpc: '2.0',
                id,
                method,
                params
            });
            
            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    async registerTool(tool: MCPTool): Promise<void> {
        await this.sendRequest('tools/register', {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        });
        
        // Set up handler for tool calls
        this.on('notification', async (message: MCPMessage) => {
            if (message.method === `tools/call/${tool.name}`) {
                try {
                    const result = await tool.handler(message.params);
                    this.sendMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        result
                    });
                } catch (error: any) {
                    this.sendMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32603,
                            message: error.message
                        }
                    });
                }
            }
        });
    }

    async registerPrompt(prompt: MCPPrompt): Promise<void> {
        await this.sendRequest('prompts/register', {
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments
        });
        
        // Set up handler for prompt calls
        this.on('notification', async (message: MCPMessage) => {
            if (message.method === `prompts/get/${prompt.name}`) {
                try {
                    const result = await prompt.handler(message.params);
                    this.sendMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { content: result }
                    });
                } catch (error: any) {
                    this.sendMessage({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: {
                            code: -32603,
                            message: error.message
                        }
                    });
                }
            }
        });
    }

    async executeCommand(command: string, args: any): Promise<any> {
        return this.sendRequest(command, args);
    }

    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = undefined;
        }
        this.removeAllListeners();
        this.pendingRequests.clear();
    }
}