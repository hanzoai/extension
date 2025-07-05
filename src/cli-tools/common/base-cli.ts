import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';

export interface CLIToolConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    model?: string;
    apiKeyEnvVar?: string;
    maxTokens?: number;
    temperature?: number;
}

export interface CLIToolResponse {
    success: boolean;
    output?: string;
    error?: string;
    exitCode?: number;
    duration?: number;
}

export abstract class BaseCLITool extends EventEmitter {
    protected config: CLIToolConfig;
    protected process?: ChildProcess;
    protected isInstalled: boolean = false;
    protected output: string[] = [];
    protected startTime?: number;

    constructor(config: CLIToolConfig) {
        super();
        this.config = config;
    }

    abstract install(): Promise<boolean>;
    abstract checkInstallation(): Promise<boolean>;
    abstract generatePrompt(task: string, context?: any): string;
    
    async initialize(): Promise<void> {
        this.isInstalled = await this.checkInstallation();
        if (!this.isInstalled) {
            console.log(`${this.config.name} not installed. Installing...`);
            this.isInstalled = await this.install();
        }
    }

    async execute(task: string, options: SpawnOptions = {}): Promise<CLIToolResponse> {
        if (!this.isInstalled) {
            await this.initialize();
        }

        this.startTime = Date.now();
        this.output = [];

        return new Promise((resolve) => {
            const prompt = this.generatePrompt(task);
            const args = [...(this.config.args || []), prompt];
            
            const env = {
                ...process.env,
                ...this.config.env,
                [this.config.apiKeyEnvVar || 'API_KEY']: this.getApiKey()
            };

            this.process = spawn(this.config.command, args, {
                ...options,
                env
            });

            this.process.stdout?.on('data', (data) => {
                const output = data.toString();
                this.output.push(output);
                this.emit('output', output);
            });

            this.process.stderr?.on('data', (data) => {
                const error = data.toString();
                this.emit('error', error);
            });

            this.process.on('exit', (code) => {
                const duration = Date.now() - this.startTime!;
                resolve({
                    success: code === 0,
                    output: this.output.join(''),
                    exitCode: code || 0,
                    duration
                });
            });

            this.process.on('error', (err) => {
                resolve({
                    success: false,
                    error: err.message,
                    duration: Date.now() - this.startTime!
                });
            });
        });
    }

    async executeWithFile(task: string, filePath: string): Promise<CLIToolResponse> {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const enhancedTask = `${task}\n\nFile: ${filePath}\nContent:\n${fileContent}`;
        return this.execute(enhancedTask);
    }

    async executeInDirectory(task: string, directory: string): Promise<CLIToolResponse> {
        return this.execute(task, { cwd: directory });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
        }
    }

    protected getApiKey(): string {
        // Override in subclasses to get API key from appropriate source
        return process.env[this.config.apiKeyEnvVar || 'API_KEY'] || '';
    }

    protected async runCommand(command: string, args: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, { shell: true });
            let output = '';
            
            proc.stdout?.on('data', (data) => {
                output += data.toString();
            });
            
            proc.on('exit', (code) => {
                if (code === 0) {
                    resolve(output.trim());
                } else {
                    reject(new Error(`Command failed with code ${code}`));
                }
            });
        });
    }

    getConfig(): CLIToolConfig {
        return this.config;
    }

    isReady(): boolean {
        return this.isInstalled;
    }
}