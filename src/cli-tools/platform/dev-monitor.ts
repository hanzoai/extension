import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

export interface DevToolSession {
    id: string;
    toolType: string;
    startTime: Date;
    endTime?: Date;
    status: 'running' | 'completed' | 'failed' | 'paused';
    workingDirectory: string;
    branch: string;
    metrics: SessionMetrics;
    logs: LogEntry[];
}

export interface SessionMetrics {
    commandsExecuted: number;
    filesModified: number;
    linesAdded: number;
    linesRemoved: number;
    tokensUsed: number;
    apiCalls: number;
    errors: number;
    cpuUsage?: number;
    memoryUsage?: number;
}

export interface LogEntry {
    timestamp: Date;
    level: 'info' | 'warn' | 'error' | 'debug';
    source: string;
    message: string;
    data?: any;
}

export interface MonitorConfig {
    logPath: string;
    maxLogSize: number;
    rotateInterval: number;
    metricsInterval: number;
    enablePerfMonitoring: boolean;
}

export class DevMonitor extends EventEmitter {
    private sessions: Map<string, DevToolSession> = new Map();
    private config: MonitorConfig;
    private logStream?: fs.WriteStream;
    private metricsTimer?: NodeJS.Timer;
    private outputChannel: vscode.OutputChannel;
    private statusBar: vscode.StatusBarItem;
    private perfObserver?: PerformanceObserver;

    constructor(config: MonitorConfig) {
        super();
        this.config = config;
        this.outputChannel = vscode.window.createOutputChannel('Hanzo Dev Monitor');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBar.command = 'hanzo-dev.showMonitor';
        
        this.initializeLogging();
        this.startMetricsCollection();
    }

    private initializeLogging(): void {
        // Create log directory if it doesn't exist
        fs.mkdirSync(this.config.logPath, { recursive: true });
        
        // Create log file with rotation
        const logFile = path.join(this.config.logPath, `hanzo-dev-${Date.now()}.log`);
        this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
        
        // Set up log rotation
        setInterval(() => this.rotateLog(), this.config.rotateInterval);
    }

    private rotateLog(): void {
        if (!this.logStream) return;
        
        const stats = fs.statSync(this.logStream.path.toString());
        if (stats.size > this.config.maxLogSize) {
            this.logStream.end();
            const newLogFile = path.join(this.config.logPath, `hanzo-dev-${Date.now()}.log`);
            this.logStream = fs.createWriteStream(newLogFile, { flags: 'a' });
        }
    }

    private startMetricsCollection(): void {
        this.metricsTimer = setInterval(() => {
            this.collectMetrics();
            this.updateStatusBar();
        }, this.config.metricsInterval);
        
        if (this.config.enablePerfMonitoring) {
            this.setupPerformanceMonitoring();
        }
    }

    private setupPerformanceMonitoring(): void {
        try {
            const { PerformanceObserver } = require('perf_hooks');
            this.perfObserver = new PerformanceObserver((items) => {
                for (const entry of items.getEntries()) {
                    this.log('debug', 'performance', `${entry.name}: ${entry.duration}ms`);
                }
            });
            this.perfObserver.observe({ entryTypes: ['measure'] });
        } catch (error) {
            this.log('warn', 'monitor', 'Performance monitoring not available');
        }
    }

    startSession(toolType: string, workingDirectory: string, branch: string): string {
        const sessionId = `${toolType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const session: DevToolSession = {
            id: sessionId,
            toolType,
            startTime: new Date(),
            status: 'running',
            workingDirectory,
            branch,
            metrics: {
                commandsExecuted: 0,
                filesModified: 0,
                linesAdded: 0,
                linesRemoved: 0,
                tokensUsed: 0,
                apiCalls: 0,
                errors: 0
            },
            logs: []
        };
        
        this.sessions.set(sessionId, session);
        this.emit('session:started', session);
        this.log('info', 'monitor', `Started ${toolType} session: ${sessionId}`);
        
        return sessionId;
    }

    endSession(sessionId: string, status: 'completed' | 'failed' = 'completed'): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        session.endTime = new Date();
        session.status = status;
        
        this.emit('session:ended', session);
        this.log('info', 'monitor', `Ended session ${sessionId}: ${status}`);
        
        // Archive session after a delay
        setTimeout(() => this.archiveSession(sessionId), 60000);
    }

    private archiveSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        // Save session data to file
        const archivePath = path.join(this.config.logPath, 'sessions', `${sessionId}.json`);
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        fs.writeFileSync(archivePath, JSON.stringify(session, null, 2));
        
        // Remove from active sessions
        this.sessions.delete(sessionId);
    }

    log(level: LogEntry['level'], source: string, message: string, data?: any): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            source,
            message,
            data
        };
        
        // Add to all active sessions
        for (const session of this.sessions.values()) {
            if (session.status === 'running') {
                session.logs.push(entry);
            }
        }
        
        // Write to log file
        if (this.logStream) {
            this.logStream.write(JSON.stringify(entry) + '\n');
        }
        
        // Show in output channel
        const logMessage = `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`;
        this.outputChannel.appendLine(logMessage);
        
        // Show errors in UI
        if (level === 'error') {
            vscode.window.showErrorMessage(`Hanzo Dev: ${message}`);
        }
    }

    incrementMetric(sessionId: string, metric: keyof SessionMetrics, value: number = 1): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        (session.metrics[metric] as number) += value;
        this.emit('metrics:updated', { sessionId, metric, value });
    }

    recordCommand(sessionId: string, command: string, args: string[]): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        this.incrementMetric(sessionId, 'commandsExecuted');
        this.log('info', session.toolType, `Command: ${command} ${args.join(' ')}`);
        
        performance.mark(`cmd-start-${sessionId}`);
    }

    recordCommandComplete(sessionId: string, success: boolean): void {
        performance.mark(`cmd-end-${sessionId}`);
        
        try {
            performance.measure(
                `command-duration-${sessionId}`,
                `cmd-start-${sessionId}`,
                `cmd-end-${sessionId}`
            );
        } catch (error) {
            // Ignore if marks don't exist
        }
        
        if (!success) {
            this.incrementMetric(sessionId, 'errors');
        }
    }

    recordFileChange(sessionId: string, filePath: string, linesAdded: number, linesRemoved: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        this.incrementMetric(sessionId, 'filesModified');
        this.incrementMetric(sessionId, 'linesAdded', linesAdded);
        this.incrementMetric(sessionId, 'linesRemoved', linesRemoved);
        
        this.log('debug', session.toolType, `File modified: ${filePath} (+${linesAdded}/-${linesRemoved})`);
    }

    recordAPICall(sessionId: string, endpoint: string, tokensUsed: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        
        this.incrementMetric(sessionId, 'apiCalls');
        this.incrementMetric(sessionId, 'tokensUsed', tokensUsed);
        
        this.log('debug', session.toolType, `API call: ${endpoint} (${tokensUsed} tokens)`);
    }

    private collectMetrics(): void {
        if (process.platform === 'darwin' || process.platform === 'linux') {
            // Collect system metrics for active sessions
            for (const session of this.sessions.values()) {
                if (session.status === 'running') {
                    // Basic process metrics (would need proper implementation)
                    session.metrics.cpuUsage = process.cpuUsage().user / 1000000;
                    session.metrics.memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
                }
            }
        }
    }

    private updateStatusBar(): void {
        const activeSessions = Array.from(this.sessions.values()).filter(
            s => s.status === 'running'
        );
        
        if (activeSessions.length === 0) {
            this.statusBar.hide();
            return;
        }
        
        const totalCommands = activeSessions.reduce(
            (sum, s) => sum + s.metrics.commandsExecuted, 0
        );
        const totalTokens = activeSessions.reduce(
            (sum, s) => sum + s.metrics.tokensUsed, 0
        );
        
        this.statusBar.text = `$(terminal) Hanzo Dev: ${activeSessions.length} active | ${totalCommands} cmds | ${totalTokens} tokens`;
        this.statusBar.tooltip = activeSessions.map(
            s => `${s.toolType}: ${s.metrics.commandsExecuted} commands`
        ).join('\n');
        this.statusBar.show();
    }

    getSession(sessionId: string): DevToolSession | undefined {
        return this.sessions.get(sessionId);
    }

    getActiveSessions(): DevToolSession[] {
        return Array.from(this.sessions.values()).filter(
            s => s.status === 'running'
        );
    }

    getAllSessions(): DevToolSession[] {
        return Array.from(this.sessions.values());
    }

    pauseSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'running') {
            session.status = 'paused';
            this.emit('session:paused', session);
        }
    }

    resumeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'paused') {
            session.status = 'running';
            this.emit('session:resumed', session);
        }
    }

    showMonitorView(): void {
        this.outputChannel.show();
    }

    dispose(): void {
        if (this.metricsTimer) {
            clearInterval(this.metricsTimer);
        }
        
        if (this.perfObserver) {
            this.perfObserver.disconnect();
        }
        
        if (this.logStream) {
            this.logStream.end();
        }
        
        this.statusBar.dispose();
        this.outputChannel.dispose();
    }
}