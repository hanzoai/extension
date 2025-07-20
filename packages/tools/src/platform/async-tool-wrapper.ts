import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { performance } from 'perf_hooks';

export interface AsyncToolConfig {
    idleTimeout: number; // Time in ms before auto-quit (default: 5 minutes)
    maxRuntime: number; // Maximum runtime in ms (default: 30 minutes)
    checkInterval: number; // How often to check status in ms (default: 1 second)
    outputBufferSize: number; // Max output to keep in memory (default: 10MB)
    persistResults: boolean; // Save results to disk (default: true)
    resultPath: string; // Where to save results
}

export interface AsyncToolJob {
    id: string;
    toolName: string;
    command: string;
    args: string[];
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';
    startTime?: Date;
    endTime?: Date;
    lastActivity?: Date;
    output: string[];
    error: string[];
    result?: any;
    metadata: Record<string, any>;
    process?: ChildProcess;
    idleTimer?: NodeJS.Timeout;
    runtimeTimer?: NodeJS.Timeout;
}

export interface AsyncToolResult {
    jobId: string;
    status: AsyncToolJob['status'];
    output: string;
    error: string;
    result?: any;
    duration?: number;
    metadata: Record<string, any>;
}

export class AsyncToolWrapper extends EventEmitter {
    private jobs: Map<string, AsyncToolJob> = new Map();
    private config: AsyncToolConfig;
    private checkTimer?: NodeJS.Timer;
    private outputStreams: Map<string, fs.WriteStream> = new Map();

    constructor(config: Partial<AsyncToolConfig> = {}) {
        super();
        this.config = {
            idleTimeout: config.idleTimeout || 5 * 60 * 1000, // 5 minutes
            maxRuntime: config.maxRuntime || 30 * 60 * 1000, // 30 minutes
            checkInterval: config.checkInterval || 1000, // 1 second
            outputBufferSize: config.outputBufferSize || 10 * 1024 * 1024, // 10MB
            persistResults: config.persistResults ?? true,
            resultPath: config.resultPath || path.join(process.cwd(), '.hanzo-dev', 'async-results')
        };

        if (this.config.persistResults) {
            fs.mkdirSync(this.config.resultPath, { recursive: true });
        }

        this.startStatusChecker();
    }

    /**
     * Create an async version of any tool/command
     */
    async createAsyncTool(
        toolName: string,
        command: string,
        args: string[] = [],
        metadata: Record<string, any> = {}
    ): Promise<string> {
        const jobId = uuidv4();
        
        const job: AsyncToolJob = {
            id: jobId,
            toolName,
            command,
            args,
            status: 'queued',
            output: [],
            error: [],
            metadata
        };

        this.jobs.set(jobId, job);
        this.emit('job:created', job);

        // Start the job asynchronously
        setImmediate(() => this.startJob(job));

        return jobId;
    }

    /**
     * Create async versions of MCP tools
     */
    async createAsyncMCPTool(toolName: string, args: any, metadata: Record<string, any> = {}): Promise<string> {
        // Convert MCP tool call to async
        const mcpCommand = this.getMCPCommand(toolName);
        const mcpArgs = this.serializeMCPArgs(args);
        
        return this.createAsyncTool(`mcp_${toolName}`, mcpCommand, mcpArgs, {
            ...metadata,
            mcpTool: true,
            originalArgs: args
        });
    }

    private getMCPCommand(toolName: string): string {
        // Map tool names to their executable commands
        const toolMap: Record<string, string> = {
            'search': 'mcp-search',
            'grep': 'mcp-grep',
            'read': 'mcp-read',
            'edit': 'mcp-edit',
            'bash': 'bash',
            'webfetch': 'mcp-webfetch',
            // Add more as needed
        };
        
        return toolMap[toolName.toLowerCase()] || toolName;
    }

    private serializeMCPArgs(args: any): string[] {
        // Convert MCP args to command line arguments
        const result: string[] = [];
        
        for (const [key, value] of Object.entries(args)) {
            if (value !== null && value !== undefined) {
                result.push(`--${key}`);
                if (typeof value === 'boolean') {
                    // Boolean flags don't need values
                } else if (Array.isArray(value)) {
                    result.push(value.join(','));
                } else {
                    result.push(String(value));
                }
            }
        }
        
        return result;
    }

    private async startJob(job: AsyncToolJob): Promise<void> {
        try {
            job.status = 'running';
            job.startTime = new Date();
            job.lastActivity = new Date();
            
            // Create output stream if persisting
            if (this.config.persistResults) {
                const outputPath = path.join(this.config.resultPath, `${job.id}.log`);
                const stream = fs.createWriteStream(outputPath);
                this.outputStreams.set(job.id, stream);
            }

            // Spawn the process
            job.process = spawn(job.command, job.args, {
                shell: true,
                env: {
                    ...process.env,
                    HANZO_DEV_ASYNC: 'true',
                    HANZO_DEV_JOB_ID: job.id
                }
            });

            // Handle stdout
            job.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.handleOutput(job, output, 'stdout');
            });

            // Handle stderr
            job.process.stderr?.on('data', (data) => {
                const error = data.toString();
                this.handleOutput(job, error, 'stderr');
            });

            // Handle process exit
            job.process.on('exit', (code, signal) => {
                this.handleJobComplete(job, code, signal);
            });

            // Handle process error
            job.process.on('error', (error) => {
                job.status = 'failed';
                job.error.push(error.message);
                this.handleJobComplete(job, 1);
            });

            // Set up idle timeout
            this.resetIdleTimer(job);

            // Set up max runtime timeout
            job.runtimeTimer = setTimeout(() => {
                if (job.status === 'running') {
                    this.cancelJob(job.id, 'Max runtime exceeded');
                }
            }, this.config.maxRuntime);

            this.emit('job:started', job);
        } catch (error) {
            job.status = 'failed';
            job.error.push(error.message);
            this.emit('job:failed', job);
        }
    }

    private handleOutput(job: AsyncToolJob, data: string, type: 'stdout' | 'stderr'): void {
        job.lastActivity = new Date();
        
        // Add to appropriate buffer
        const buffer = type === 'stdout' ? job.output : job.error;
        buffer.push(data);

        // Trim buffer if too large
        const totalSize = buffer.reduce((sum, str) => sum + str.length, 0);
        if (totalSize > this.config.outputBufferSize) {
            // Remove oldest entries until under limit
            while (buffer.length > 0 && 
                   buffer.reduce((sum, str) => sum + str.length, 0) > this.config.outputBufferSize) {
                buffer.shift();
            }
        }

        // Write to file if persisting
        const stream = this.outputStreams.get(job.id);
        if (stream) {
            stream.write(`[${type}] ${new Date().toISOString()} ${data}`);
        }

        // Reset idle timer
        this.resetIdleTimer(job);

        // Emit output event
        this.emit('job:output', {
            jobId: job.id,
            type,
            data
        });

        // Check for completion patterns
        this.checkForCompletion(job, data);
    }

    private checkForCompletion(job: AsyncToolJob, output: string): void {
        // Look for common completion patterns
        const completionPatterns = [
            /task completed/i,
            /finished successfully/i,
            /done\./i,
            /completed in \d+/i,
            /\[done\]/i
        ];

        if (completionPatterns.some(pattern => pattern.test(output))) {
            // Mark as idle instead of immediately completing
            job.status = 'idle';
            this.emit('job:idle', job);
        }
    }

    private resetIdleTimer(job: AsyncToolJob): void {
        // Clear existing timer
        if (job.idleTimer) {
            clearTimeout(job.idleTimer);
        }

        // Set new timer
        job.idleTimer = setTimeout(() => {
            if (job.status === 'running' || job.status === 'idle') {
                this.handleIdleTimeout(job);
            }
        }, this.config.idleTimeout);
    }

    private handleIdleTimeout(job: AsyncToolJob): void {
        if (job.status === 'idle') {
            // If already idle, complete the job
            this.completeJob(job.id);
        } else {
            // Mark as idle
            job.status = 'idle';
            this.emit('job:idle', job);
            
            // Give it one more idle period before completing
            this.resetIdleTimer(job);
        }
    }

    private handleJobComplete(job: AsyncToolJob, code?: number | null, signal?: string | null): void {
        job.endTime = new Date();
        job.status = code === 0 ? 'completed' : 'failed';
        
        if (job.idleTimer) {
            clearTimeout(job.idleTimer);
        }
        
        if (job.runtimeTimer) {
            clearTimeout(job.runtimeTimer);
        }

        // Close output stream
        const stream = this.outputStreams.get(job.id);
        if (stream) {
            stream.end();
            this.outputStreams.delete(job.id);
        }

        // Parse result if possible
        try {
            const output = job.output.join('');
            if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
                job.result = JSON.parse(output);
            }
        } catch (error) {
            // Not JSON, keep as string
        }

        // Save result if persisting
        if (this.config.persistResults) {
            this.saveJobResult(job);
        }

        this.emit('job:completed', job);
    }

    private saveJobResult(job: AsyncToolJob): void {
        const resultPath = path.join(this.config.resultPath, `${job.id}.json`);
        const result: AsyncToolResult = {
            jobId: job.id,
            status: job.status,
            output: job.output.join(''),
            error: job.error.join(''),
            result: job.result,
            duration: job.startTime && job.endTime ? 
                job.endTime.getTime() - job.startTime.getTime() : undefined,
            metadata: job.metadata
        };
        
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    }

    /**
     * Query the status of an async job
     */
    async queryJob(jobId: string): Promise<AsyncToolResult | null> {
        const job = this.jobs.get(jobId);
        
        if (!job) {
            // Try to load from disk
            if (this.config.persistResults) {
                const resultPath = path.join(this.config.resultPath, `${jobId}.json`);
                if (fs.existsSync(resultPath)) {
                    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
                }
            }
            return null;
        }

        return {
            jobId: job.id,
            status: job.status,
            output: job.output.join(''),
            error: job.error.join(''),
            result: job.result,
            duration: job.startTime ? 
                (job.endTime ? job.endTime.getTime() : Date.now()) - job.startTime.getTime() : undefined,
            metadata: job.metadata
        };
    }

    /**
     * Wait for a job to complete
     */
    async waitForJob(jobId: string, timeout?: number): Promise<AsyncToolResult | null> {
        const startTime = Date.now();
        const maxWait = timeout || this.config.maxRuntime;

        while (Date.now() - startTime < maxWait) {
            const result = await this.queryJob(jobId);
            
            if (!result) {
                throw new Error(`Job ${jobId} not found`);
            }

            if (['completed', 'failed', 'cancelled'].includes(result.status)) {
                return result;
            }

            // Wait before checking again
            await new Promise(resolve => setTimeout(resolve, this.config.checkInterval));
        }

        throw new Error(`Timeout waiting for job ${jobId}`);
    }

    /**
     * Keep a job alive (prevent idle timeout)
     */
    keepAlive(jobId: string): void {
        const job = this.jobs.get(jobId);
        if (job && (job.status === 'running' || job.status === 'idle')) {
            job.lastActivity = new Date();
            this.resetIdleTimer(job);
            
            if (job.status === 'idle') {
                job.status = 'running';
                this.emit('job:resumed', job);
            }
        }
    }

    /**
     * Send input to a running job
     */
    sendInput(jobId: string, input: string): boolean {
        const job = this.jobs.get(jobId);
        
        if (!job || !job.process || job.status !== 'running') {
            return false;
        }

        job.process.stdin?.write(input + '\n');
        job.lastActivity = new Date();
        this.resetIdleTimer(job);
        
        return true;
    }

    /**
     * Complete a job manually
     */
    completeJob(jobId: string, result?: any): void {
        const job = this.jobs.get(jobId);
        
        if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) {
            return;
        }

        if (result) {
            job.result = result;
        }

        if (job.process && !job.process.killed) {
            job.process.kill('SIGTERM');
        } else {
            this.handleJobComplete(job, 0);
        }
    }

    /**
     * Cancel a running job
     */
    cancelJob(jobId: string, reason?: string): void {
        const job = this.jobs.get(jobId);
        
        if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) {
            return;
        }

        job.status = 'cancelled';
        if (reason) {
            job.error.push(`Cancelled: ${reason}`);
        }

        if (job.process && !job.process.killed) {
            job.process.kill('SIGKILL');
        }

        this.handleJobComplete(job, -1);
    }

    /**
     * Get all active jobs
     */
    getActiveJobs(): AsyncToolJob[] {
        return Array.from(this.jobs.values()).filter(
            job => ['running', 'idle', 'queued'].includes(job.status)
        );
    }

    /**
     * Get all jobs
     */
    getAllJobs(): AsyncToolJob[] {
        return Array.from(this.jobs.values());
    }

    /**
     * Clean up completed jobs
     */
    cleanupCompletedJobs(olderThan?: number): number {
        const cutoff = Date.now() - (olderThan || 24 * 60 * 60 * 1000); // Default 24 hours
        let cleaned = 0;

        for (const [jobId, job] of this.jobs) {
            if (['completed', 'failed', 'cancelled'].includes(job.status) &&
                job.endTime && job.endTime.getTime() < cutoff) {
                this.jobs.delete(jobId);
                cleaned++;
            }
        }

        return cleaned;
    }

    private startStatusChecker(): void {
        this.checkTimer = setInterval(() => {
            // Emit status for monitoring
            const stats = {
                total: this.jobs.size,
                running: 0,
                idle: 0,
                completed: 0,
                failed: 0
            };

            for (const job of this.jobs.values()) {
                stats[job.status]++;
            }

            this.emit('status', stats);
        }, 10000); // Every 10 seconds
    }

    dispose(): void {
        // Cancel all running jobs
        for (const job of this.getActiveJobs()) {
            this.cancelJob(job.id, 'System shutdown');
        }

        // Clear timers
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }

        // Close all streams
        for (const stream of this.outputStreams.values()) {
            stream.end();
        }

        this.removeAllListeners();
    }
}