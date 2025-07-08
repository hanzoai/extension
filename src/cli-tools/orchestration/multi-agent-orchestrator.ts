import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { CLIToolManager, CLIToolType } from '../cli-tool-manager';
import { AsyncToolWrapper } from '../platform/async-tool-wrapper';
import { DevLauncher } from '../platform/dev-launcher';
import { execSync } from 'child_process';
import { LocalLLMManager } from '../config/local-llm-config';

export type AgentRole = 'coder' | 'reviewer' | 'critic' | 'architect' | 'tester' | 'documenter' | 'optimizer';

export interface AgentConfig {
    role: AgentRole;
    tool: CLIToolType | 'local-llm';
    model?: string;
    temperature?: number;
    systemPrompt?: string;
    localEndpoint?: string; // For local LLMs
}

export interface WorkflowStep {
    name: string;
    agents: AgentConfig[];
    parallel: boolean;
    combineStrategy?: 'merge' | 'vote' | 'best' | 'sequential';
    outputHandler?: (outputs: Map<string, any>) => any;
}

export interface WorkflowConfig {
    name: string;
    description: string;
    steps: WorkflowStep[];
    finalStep?: WorkflowStep;
}

export interface OrchestratorConfig {
    maxParallelAgents: number;
    defaultTimeout: number;
    workflowPath?: string;
    enableLocalLLMs: boolean;
    localLLMEndpoints?: Record<string, string>;
}

export class MultiAgentOrchestrator extends EventEmitter {
    private config: OrchestratorConfig;
    private cliManager: CLIToolManager;
    private asyncWrapper: AsyncToolWrapper;
    private launcher: DevLauncher;
    private localLLMManager: LocalLLMManager;
    private workflows: Map<string, WorkflowConfig> = new Map();
    private activeJobs: Map<string, { workflow: string; step: number; agents: Map<string, string> }> = new Map();

    constructor(config: Partial<OrchestratorConfig> = {}) {
        super();
        this.config = {
            maxParallelAgents: config.maxParallelAgents || 5,
            defaultTimeout: config.defaultTimeout || 30 * 60 * 1000,
            workflowPath: config.workflowPath || path.join(process.cwd(), '.dev', 'workflows'),
            enableLocalLLMs: config.enableLocalLLMs ?? true,
            localLLMEndpoints: config.localLLMEndpoints || {
                'ollama': 'http://localhost:11434',
                'llm-server': 'http://localhost:8080',
                'text-generation-webui': 'http://localhost:5000'
            }
        };

        this.cliManager = new CLIToolManager();
        this.asyncWrapper = new AsyncToolWrapper();
        this.launcher = new DevLauncher({
            maxInstances: this.config.maxParallelAgents,
            defaultTimeout: this.config.defaultTimeout,
            gitRoot: this.findGitRoot() || process.cwd(),
            workspacePath: process.cwd(),
            enableSync: false
        });
        
        this.localLLMManager = new LocalLLMManager();

        this.loadBuiltInWorkflows();
        this.loadCustomWorkflows();
    }

    async initialize(): Promise<void> {
        await this.cliManager.initialize();
        await this.launcher.initialize();
        this.emit('initialized');
    }

    private loadBuiltInWorkflows(): void {
        // Code Review Workflow
        this.workflows.set('code-review', {
            name: 'code-review',
            description: 'Comprehensive code review with multiple perspectives',
            steps: [
                {
                    name: 'initial-review',
                    agents: [
                        { role: 'reviewer', tool: 'gemini', model: 'gemini-pro' },
                        { role: 'critic', tool: 'codex', model: 'code-davinci-002' },
                        { role: 'architect', tool: 'claude', model: 'claude-3-opus' }
                    ],
                    parallel: true,
                    combineStrategy: 'merge'
                },
                {
                    name: 'synthesize',
                    agents: [
                        { role: 'reviewer', tool: 'claude', model: 'claude-3-opus' }
                    ],
                    parallel: false
                }
            ]
        });

        // Feature Implementation Workflow
        this.workflows.set('implement-feature', {
            name: 'implement-feature',
            description: 'Implement a feature with code, tests, and documentation',
            steps: [
                {
                    name: 'design',
                    agents: [
                        { role: 'architect', tool: 'claude', model: 'claude-3-opus' }
                    ],
                    parallel: false
                },
                {
                    name: 'implement',
                    agents: [
                        { role: 'coder', tool: 'aider' },
                        { role: 'tester', tool: 'codex' },
                        { role: 'documenter', tool: 'gemini' }
                    ],
                    parallel: true,
                    combineStrategy: 'sequential'
                },
                {
                    name: 'review',
                    agents: [
                        { role: 'reviewer', tool: 'claude' },
                        { role: 'critic', tool: 'gemini' }
                    ],
                    parallel: true,
                    combineStrategy: 'vote'
                }
            ]
        });

        // Optimization Workflow
        this.workflows.set('optimize', {
            name: 'optimize',
            description: 'Optimize code for performance',
            steps: [
                {
                    name: 'analyze',
                    agents: [
                        { role: 'optimizer', tool: 'claude', temperature: 0.3 },
                        { role: 'optimizer', tool: 'codex', temperature: 0.3 }
                    ],
                    parallel: true,
                    combineStrategy: 'best'
                },
                {
                    name: 'implement',
                    agents: [
                        { role: 'coder', tool: 'aider' }
                    ],
                    parallel: false
                }
            ]
        });

        // Debug Workflow
        this.workflows.set('debug', {
            name: 'debug',
            description: 'Debug and fix issues',
            steps: [
                {
                    name: 'diagnose',
                    agents: [
                        { role: 'critic', tool: 'claude', temperature: 0.1 },
                        { role: 'tester', tool: 'gemini', temperature: 0.1 },
                        { role: 'coder', tool: 'openhands' }
                    ],
                    parallel: true,
                    combineStrategy: 'merge'
                },
                {
                    name: 'fix',
                    agents: [
                        { role: 'coder', tool: 'aider' }
                    ],
                    parallel: false
                }
            ]
        });
    }

    private loadCustomWorkflows(): void {
        if (!fs.existsSync(this.config.workflowPath!)) {
            fs.mkdirSync(this.config.workflowPath!, { recursive: true });
            return;
        }

        const files = fs.readdirSync(this.config.workflowPath!);
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(path.join(this.config.workflowPath!, file), 'utf-8');
                    const workflow = JSON.parse(content) as WorkflowConfig;
                    this.workflows.set(workflow.name, workflow);
                    this.emit('workflow:loaded', workflow.name);
                } catch (error) {
                    this.emit('workflow:error', { file, error });
                }
            }
        }
    }

    async runWorkflow(workflowName: string, task: string, options?: any): Promise<string> {
        const workflow = this.workflows.get(workflowName);
        if (!workflow) {
            throw new Error(`Workflow '${workflowName}' not found`);
        }

        const jobId = `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.activeJobs.set(jobId, {
            workflow: workflowName,
            step: 0,
            agents: new Map()
        });

        this.emit('workflow:started', { jobId, workflow: workflowName, task });

        try {
            let previousOutput = task;
            
            for (let i = 0; i < workflow.steps.length; i++) {
                const step = workflow.steps[i];
                this.activeJobs.get(jobId)!.step = i;
                
                const stepOutput = await this.runWorkflowStep(
                    jobId,
                    step,
                    previousOutput,
                    options
                );
                
                previousOutput = stepOutput;
                this.emit('workflow:step:completed', { jobId, step: i, output: stepOutput });
            }

            // Run final step if defined
            if (workflow.finalStep) {
                previousOutput = await this.runWorkflowStep(
                    jobId,
                    workflow.finalStep,
                    previousOutput,
                    options
                );
            }

            this.emit('workflow:completed', { jobId, output: previousOutput });
            return previousOutput;
        } catch (error) {
            this.emit('workflow:failed', { jobId, error });
            throw error;
        } finally {
            this.activeJobs.delete(jobId);
        }
    }

    private async runWorkflowStep(
        jobId: string,
        step: WorkflowStep,
        input: string,
        options?: any
    ): Promise<string> {
        this.emit('workflow:step:started', { jobId, step: step.name });

        if (step.parallel) {
            // Run agents in parallel
            const results = await this.runAgentsInParallel(jobId, step.agents, input, options);
            return this.combineResults(results, step.combineStrategy || 'merge');
        } else {
            // Run agents sequentially
            let output = input;
            for (const agent of step.agents) {
                output = await this.runSingleAgent(jobId, agent, output, options);
            }
            return output;
        }
    }

    private async runAgentsInParallel(
        jobId: string,
        agents: AgentConfig[],
        input: string,
        options?: any
    ): Promise<Map<string, string>> {
        const results = new Map<string, string>();
        const promises: Promise<void>[] = [];

        for (const agent of agents) {
            const promise = this.runSingleAgent(jobId, agent, input, options)
                .then(output => {
                    const key = `${agent.role}-${agent.tool}`;
                    results.set(key, output);
                })
                .catch(error => {
                    this.emit('agent:error', { jobId, agent, error });
                });
            
            promises.push(promise);
        }

        await Promise.all(promises);
        return results;
    }

    private async runSingleAgent(
        jobId: string,
        agent: AgentConfig,
        input: string,
        options?: any
    ): Promise<string> {
        const prompt = this.generateAgentPrompt(agent, input);
        
        if (agent.tool === 'local-llm' && this.config.enableLocalLLMs) {
            return this.runLocalLLM(agent, prompt, options);
        }

        // Use existing CLI tools
        const agentJobId = await this.cliManager.executeToolAsync(
            agent.tool as CLIToolType,
            prompt,
            {
                model: agent.model,
                temperature: agent.temperature,
                ...options
            }
        );

        // Track agent job
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.agents.set(`${agent.role}-${agent.tool}`, agentJobId);
        }

        // Wait for completion
        const result = await this.cliManager.waitForAsyncJob(agentJobId);
        return result?.output || '';
    }

    private generateAgentPrompt(agent: AgentConfig, input: string): string {
        const rolePrompts: Record<AgentRole, string> = {
            coder: `As a skilled programmer, implement the following:\n\n${input}`,
            reviewer: `As a code reviewer, review the following and provide feedback:\n\n${input}`,
            critic: `As a critical analyst, identify issues and improvements in:\n\n${input}`,
            architect: `As a software architect, design the architecture for:\n\n${input}`,
            tester: `As a QA engineer, create tests for:\n\n${input}`,
            documenter: `As a technical writer, document the following:\n\n${input}`,
            optimizer: `As a performance engineer, optimize:\n\n${input}`
        };

        const basePrompt = agent.systemPrompt || rolePrompts[agent.role];
        return basePrompt;
    }

    private async runLocalLLM(
        agent: AgentConfig,
        prompt: string,
        options?: any
    ): Promise<string> {
        try {
            const result = await this.localLLMManager.callLocalLLM(prompt, {
                provider: agent.localEndpoint ? undefined : 'ollama',
                model: agent.model,
                temperature: agent.temperature,
                maxTokens: options?.maxTokens,
                systemPrompt: agent.systemPrompt
            });
            
            return result;
        } catch (error) {
            this.emit('local-llm:error', { agent, error });
            throw error;
        }
    }

    private combineResults(
        results: Map<string, string>,
        strategy: 'merge' | 'vote' | 'best' | 'sequential'
    ): string {
        const outputs = Array.from(results.values());
        
        switch (strategy) {
            case 'merge':
                // Combine all outputs with headers
                return Array.from(results.entries())
                    .map(([key, value]) => `### ${key}\n\n${value}`)
                    .join('\n\n---\n\n');
            
            case 'vote':
                // Find consensus among outputs
                // This is simplified - real implementation would be more sophisticated
                const consensus = this.findConsensus(outputs);
                return consensus || outputs[0];
            
            case 'best':
                // Pick the longest/most detailed output
                return outputs.reduce((best, current) => 
                    current.length > best.length ? current : best
                );
            
            case 'sequential':
                // Use outputs in order as context for next steps
                return outputs.join('\n\n');
            
            default:
                return outputs[0];
        }
    }

    private findConsensus(outputs: string[]): string | null {
        // Simple consensus: find common patterns
        // In practice, this would use more sophisticated NLP
        if (outputs.length < 2) return outputs[0];
        
        // For now, return the output that appears most similar to others
        let bestScore = 0;
        let bestOutput = outputs[0];
        
        for (const output of outputs) {
            let score = 0;
            for (const other of outputs) {
                if (output !== other) {
                    score += this.calculateSimilarity(output, other);
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestOutput = output;
            }
        }
        
        return bestOutput;
    }

    private calculateSimilarity(a: string, b: string): number {
        // Simple similarity based on shared words
        const wordsA = new Set(a.toLowerCase().split(/\s+/));
        const wordsB = new Set(b.toLowerCase().split(/\s+/));
        const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
        return intersection.size / Math.max(wordsA.size, wordsB.size);
    }

    async runCustomAgents(
        task: string,
        agents: AgentConfig[],
        options?: any
    ): Promise<Map<string, string>> {
        const jobId = `custom-${Date.now()}`;
        const results = await this.runAgentsInParallel(jobId, agents, task, options);
        return results;
    }

    getWorkflows(): WorkflowConfig[] {
        return Array.from(this.workflows.values());
    }

    saveWorkflow(workflow: WorkflowConfig): void {
        this.workflows.set(workflow.name, workflow);
        
        const filePath = path.join(this.config.workflowPath!, `${workflow.name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
        
        this.emit('workflow:saved', workflow.name);
    }

    private findGitRoot(): string | null {
        try {
            return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
        } catch {
            return null;
        }
    }

    async dispose(): Promise<void> {
        await this.launcher.dispose();
        this.cliManager.dispose();
        this.asyncWrapper.dispose();
    }
}