import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import WebSocket from 'ws';

export interface SyncConfig {
    platformUrl: string;
    apiKey: string;
    projectId: string;
    syncInterval: number;
    enableBidirectional: boolean;
}

export interface DevToolContext {
    toolId: string;
    sessionId: string;
    workingDirectory: string;
    branch: string;
    files: string[];
    lastActivity: Date;
    metadata: Record<string, any>;
}

export interface SyncEvent {
    type: 'file_change' | 'command' | 'output' | 'error' | 'status';
    timestamp: Date;
    toolId: string;
    data: any;
}

export class PlatformSyncService extends EventEmitter {
    private config: SyncConfig;
    private ws?: WebSocket;
    private contexts: Map<string, DevToolContext> = new Map();
    private syncQueue: SyncEvent[] = [];
    private connected: boolean = false;
    private syncTimer?: NodeJS.Timer;
    private fileWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

    constructor(config: SyncConfig) {
        super();
        this.config = config;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const wsUrl = `${this.config.platformUrl.replace('http', 'ws')}/sync`;
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'X-Project-ID': this.config.projectId
                }
            });

            this.ws.on('open', () => {
                this.connected = true;
                this.emit('connected');
                this.startSync();
                resolve();
            });

            this.ws.on('message', (data) => {
                this.handlePlatformMessage(JSON.parse(data.toString()));
            });

            this.ws.on('error', (error) => {
                this.emit('error', error);
                reject(error);
            });

            this.ws.on('close', () => {
                this.connected = false;
                this.emit('disconnected');
                this.stopSync();
                // Auto-reconnect after 5 seconds
                setTimeout(() => this.connect(), 5000);
            });
        });
    }

    registerDevTool(toolId: string, context: Omit<DevToolContext, 'toolId'>): void {
        const fullContext: DevToolContext = {
            toolId,
            ...context
        };
        
        this.contexts.set(toolId, fullContext);
        
        // Set up file watching for bi-directional sync
        if (this.config.enableBidirectional) {
            this.setupFileWatching(toolId, context.workingDirectory);
        }
        
        // Send registration event
        this.queueEvent({
            type: 'status',
            timestamp: new Date(),
            toolId,
            data: { status: 'registered', context: fullContext }
        });
    }

    private setupFileWatching(toolId: string, directory: string): void {
        const pattern = new vscode.RelativePattern(directory, '**/*');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        
        watcher.onDidChange((uri) => {
            this.handleFileChange(toolId, uri, 'changed');
        });
        
        watcher.onDidCreate((uri) => {
            this.handleFileChange(toolId, uri, 'created');
        });
        
        watcher.onDidDelete((uri) => {
            this.handleFileChange(toolId, uri, 'deleted');
        });
        
        this.fileWatchers.set(toolId, watcher);
    }

    private handleFileChange(toolId: string, uri: vscode.Uri, changeType: string): void {
        const context = this.contexts.get(toolId);
        if (!context) return;
        
        const relativePath = path.relative(context.workingDirectory, uri.fsPath);
        
        // Don't sync hidden files or node_modules
        if (relativePath.includes('node_modules') || relativePath.startsWith('.')) {
            return;
        }
        
        this.queueEvent({
            type: 'file_change',
            timestamp: new Date(),
            toolId,
            data: {
                path: relativePath,
                changeType,
                content: changeType !== 'deleted' ? fs.readFileSync(uri.fsPath, 'utf-8') : null,
                hash: changeType !== 'deleted' ? this.hashFile(uri.fsPath) : null
            }
        });
    }

    private hashFile(filePath: string): string {
        const content = fs.readFileSync(filePath);
        return createHash('sha256').update(content).digest('hex');
    }

    logCommand(toolId: string, command: string, args: string[]): void {
        this.queueEvent({
            type: 'command',
            timestamp: new Date(),
            toolId,
            data: { command, args }
        });
    }

    logOutput(toolId: string, output: string): void {
        this.queueEvent({
            type: 'output',
            timestamp: new Date(),
            toolId,
            data: { output }
        });
    }

    logError(toolId: string, error: string): void {
        this.queueEvent({
            type: 'error',
            timestamp: new Date(),
            toolId,
            data: { error }
        });
    }

    updateStatus(toolId: string, status: string, metadata?: any): void {
        const context = this.contexts.get(toolId);
        if (context) {
            context.lastActivity = new Date();
            if (metadata) {
                context.metadata = { ...context.metadata, ...metadata };
            }
        }
        
        this.queueEvent({
            type: 'status',
            timestamp: new Date(),
            toolId,
            data: { status, metadata }
        });
    }

    private queueEvent(event: SyncEvent): void {
        this.syncQueue.push(event);
        
        // If connected, sync immediately
        if (this.connected) {
            this.syncEvents();
        }
    }

    private startSync(): void {
        // Sync queued events immediately
        this.syncEvents();
        
        // Set up periodic sync
        this.syncTimer = setInterval(() => {
            this.syncEvents();
            this.syncContexts();
        }, this.config.syncInterval);
    }

    private stopSync(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = undefined;
        }
    }

    private syncEvents(): void {
        if (!this.connected || !this.ws || this.syncQueue.length === 0) {
            return;
        }
        
        const events = [...this.syncQueue];
        this.syncQueue = [];
        
        this.ws.send(JSON.stringify({
            type: 'sync_events',
            events
        }));
    }

    private syncContexts(): void {
        if (!this.connected || !this.ws) {
            return;
        }
        
        const contexts = Array.from(this.contexts.values());
        
        this.ws.send(JSON.stringify({
            type: 'sync_contexts',
            contexts
        }));
    }

    private handlePlatformMessage(message: any): void {
        switch (message.type) {
            case 'file_update':
                this.handleRemoteFileUpdate(message);
                break;
            case 'command_request':
                this.emit('command_request', message);
                break;
            case 'context_update':
                this.handleContextUpdate(message);
                break;
        }
    }

    private handleRemoteFileUpdate(message: any): void {
        if (!this.config.enableBidirectional) return;
        
        const { toolId, filePath, content } = message.data;
        const context = this.contexts.get(toolId);
        
        if (!context) return;
        
        const fullPath = path.join(context.workingDirectory, filePath);
        
        // Create directory if it doesn't exist
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        
        // Write the file
        fs.writeFileSync(fullPath, content);
        
        this.emit('file_synced', { toolId, filePath, fullPath });
    }

    private handleContextUpdate(message: any): void {
        const { toolId, updates } = message.data;
        const context = this.contexts.get(toolId);
        
        if (!context) return;
        
        Object.assign(context, updates);
        this.emit('context_updated', { toolId, updates });
    }

    getContext(toolId: string): DevToolContext | undefined {
        return this.contexts.get(toolId);
    }

    getAllContexts(): DevToolContext[] {
        return Array.from(this.contexts.values());
    }

    async disconnect(): Promise<void> {
        this.stopSync();
        
        // Clean up file watchers
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
        
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
        
        this.connected = false;
    }
}