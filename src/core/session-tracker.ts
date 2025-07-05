import * as vscode from 'vscode';
import { StorageUtil } from '../utils/storage';

export interface SessionEvent {
    id: string;
    timestamp: number;
    type: 'command' | 'tool' | 'search' | 'edit' | 'navigate' | 'error';
    action: string;
    details?: any;
    metadata?: {
        duration?: number;
        success?: boolean;
        error?: string;
    };
}

export interface Session {
    id: string;
    startTime: number;
    endTime?: number;
    events: SessionEvent[];
    metadata?: {
        totalCommands?: number;
        totalToolUsage?: number;
        errors?: number;
    };
}

/**
 * Tracks all session interactions for unified recall
 */
export class SessionTracker {
    private static instance: SessionTracker;
    private currentSession: Session | null = null;
    private readonly SESSION_KEY = 'hanzo.sessions';
    private readonly CURRENT_SESSION_KEY = 'hanzo.current_session';
    
    private constructor(private context: vscode.ExtensionContext) {
        this.initializeSession();
    }
    
    static getInstance(context: vscode.ExtensionContext): SessionTracker {
        if (!SessionTracker.instance) {
            SessionTracker.instance = new SessionTracker(context);
        }
        return SessionTracker.instance;
    }
    
    private async initializeSession() {
        // Try to restore current session
        const storedSession = await StorageUtil.retrieveGlobal<Session>(
            this.context,
            this.CURRENT_SESSION_KEY,
            null as any
        );
        
        if (storedSession && !storedSession.endTime) {
            // Resume existing session
            this.currentSession = storedSession;
            console.log(`[SessionTracker] Resumed session ${storedSession.id}`);
        } else {
            // Start new session
            this.startNewSession();
        }
    }
    
    private startNewSession() {
        this.currentSession = {
            id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            startTime: Date.now(),
            events: []
        };
        
        console.log(`[SessionTracker] Started new session ${this.currentSession.id}`);
        this.saveCurrentSession();
    }
    
    /**
     * Track an event in the current session
     */
    async trackEvent(
        type: SessionEvent['type'],
        action: string,
        details?: any,
        metadata?: SessionEvent['metadata']
    ): Promise<void> {
        if (!this.currentSession) {
            this.startNewSession();
        }
        
        const event: SessionEvent = {
            id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            type,
            action,
            details,
            metadata
        };
        
        this.currentSession!.events.push(event);
        
        // Update session metadata
        if (!this.currentSession!.metadata) {
            this.currentSession!.metadata = {};
        }
        
        switch (type) {
            case 'command':
                this.currentSession!.metadata.totalCommands = 
                    (this.currentSession!.metadata.totalCommands || 0) + 1;
                break;
            case 'tool':
                this.currentSession!.metadata.totalToolUsage = 
                    (this.currentSession!.metadata.totalToolUsage || 0) + 1;
                break;
            case 'error':
                this.currentSession!.metadata.errors = 
                    (this.currentSession!.metadata.errors || 0) + 1;
                break;
        }
        
        await this.saveCurrentSession();
    }
    
    /**
     * Track command execution
     */
    async trackCommand(command: string, args?: any): Promise<void> {
        const startTime = Date.now();
        
        return this.trackEvent('command', command, args, {
            duration: Date.now() - startTime
        });
    }
    
    /**
     * Track tool usage
     */
    async trackToolUsage(toolName: string, input?: any, output?: any): Promise<void> {
        return this.trackEvent('tool', toolName, {
            input,
            output: output ? JSON.stringify(output).substring(0, 1000) : undefined // Limit output size
        });
    }
    
    /**
     * Track search operations
     */
    async trackSearch(query: string, type: string, resultCount: number): Promise<void> {
        return this.trackEvent('search', `${type} search`, {
            query,
            resultCount
        });
    }
    
    /**
     * Track file edits
     */
    async trackEdit(filePath: string, changeType: 'create' | 'update' | 'delete'): Promise<void> {
        return this.trackEvent('edit', changeType, {
            filePath
        });
    }
    
    /**
     * Track navigation
     */
    async trackNavigation(from: string, to: string): Promise<void> {
        return this.trackEvent('navigate', 'navigation', {
            from,
            to
        });
    }
    
    /**
     * Track errors
     */
    async trackError(error: Error, context?: string): Promise<void> {
        return this.trackEvent('error', error.name, {
            message: error.message,
            stack: error.stack,
            context
        }, {
            error: error.message
        });
    }
    
    /**
     * Get current session
     */
    getCurrentSession(): Session | null {
        return this.currentSession;
    }
    
    /**
     * Get all sessions
     */
    async getAllSessions(): Promise<Session[]> {
        const sessions = await StorageUtil.retrieveGlobal<Session[]>(
            this.context,
            this.SESSION_KEY,
            []
        );
        
        // Include current session if active
        if (this.currentSession && !this.currentSession.endTime) {
            return [this.currentSession, ...sessions];
        }
        
        return sessions;
    }
    
    /**
     * Search sessions for specific events
     */
    async searchSessions(
        query: string,
        options?: {
            type?: SessionEvent['type'];
            startDate?: Date;
            endDate?: Date;
            limit?: number;
        }
    ): Promise<SessionEvent[]> {
        const sessions = await this.getAllSessions();
        const results: SessionEvent[] = [];
        
        for (const session of sessions) {
            // Filter by date range
            if (options?.startDate && session.startTime < options.startDate.getTime()) {
                continue;
            }
            if (options?.endDate && session.startTime > options.endDate.getTime()) {
                continue;
            }
            
            // Search events
            for (const event of session.events) {
                // Filter by type
                if (options?.type && event.type !== options.type) {
                    continue;
                }
                
                // Search in event data
                const eventStr = JSON.stringify(event).toLowerCase();
                if (eventStr.includes(query.toLowerCase())) {
                    results.push(event);
                    
                    if (options?.limit && results.length >= options.limit) {
                        return results;
                    }
                }
            }
        }
        
        return results;
    }
    
    /**
     * Get session statistics
     */
    async getStatistics(sessionId?: string): Promise<any> {
        let sessions: Session[];
        
        if (sessionId) {
            const session = sessionId === this.currentSession?.id 
                ? this.currentSession 
                : (await this.getAllSessions()).find(s => s.id === sessionId);
            
            sessions = session ? [session] : [];
        } else {
            sessions = await this.getAllSessions();
        }
        
        const stats = {
            totalSessions: sessions.length,
            totalEvents: 0,
            eventTypes: {} as Record<string, number>,
            commandUsage: {} as Record<string, number>,
            toolUsage: {} as Record<string, number>,
            errors: 0,
            averageSessionDuration: 0,
            totalDuration: 0
        };
        
        for (const session of sessions) {
            stats.totalEvents += session.events.length;
            
            if (session.endTime) {
                stats.totalDuration += session.endTime - session.startTime;
            }
            
            for (const event of session.events) {
                // Count by type
                stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;
                
                // Count specific actions
                if (event.type === 'command') {
                    stats.commandUsage[event.action] = (stats.commandUsage[event.action] || 0) + 1;
                } else if (event.type === 'tool') {
                    stats.toolUsage[event.action] = (stats.toolUsage[event.action] || 0) + 1;
                } else if (event.type === 'error') {
                    stats.errors++;
                }
            }
        }
        
        if (sessions.filter(s => s.endTime).length > 0) {
            stats.averageSessionDuration = stats.totalDuration / sessions.filter(s => s.endTime).length;
        }
        
        return stats;
    }
    
    /**
     * End current session
     */
    async endSession(): Promise<void> {
        if (!this.currentSession) {
            return;
        }
        
        this.currentSession.endTime = Date.now();
        
        // Save to session history
        const sessions = await StorageUtil.retrieveGlobal<Session[]>(
            this.context,
            this.SESSION_KEY,
            []
        );
        
        sessions.unshift(this.currentSession);
        
        // Keep only last 100 sessions
        if (sessions.length > 100) {
            sessions.splice(100);
        }
        
        await StorageUtil.storeGlobal(this.context, this.SESSION_KEY, sessions);
        await StorageUtil.clearGlobal(this.context, this.CURRENT_SESSION_KEY);
        
        console.log(`[SessionTracker] Ended session ${this.currentSession.id}`);
        this.currentSession = null;
    }
    
    /**
     * Save current session state
     */
    private async saveCurrentSession(): Promise<void> {
        if (this.currentSession) {
            await StorageUtil.storeGlobal(
                this.context,
                this.CURRENT_SESSION_KEY,
                this.currentSession
            );
        }
    }
    
    /**
     * Export sessions to file
     */
    async exportSessions(outputPath: string): Promise<void> {
        const sessions = await this.getAllSessions();
        const data = {
            exportDate: new Date().toISOString(),
            sessions,
            statistics: await this.getStatistics()
        };
        
        const fs = require('fs').promises;
        await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    }
}