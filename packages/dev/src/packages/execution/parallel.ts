/**
 * Parallel Execution Engine
 * Run multiple agents in parallel with coordination
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
import { SwarmConfig, AgentInstance } from '../config/swarm';
import { MCPClient } from '../mcp/client';
import { AIProviderManager } from '../ai/providers';

export interface Task {
  id: string;
  type: 'completion' | 'tool_call' | 'file_operation' | 'command';
  agentId: string;
  priority: number;
  payload: any;
  dependencies?: string[];
  timeout?: number;
  retries?: number;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  attempts: number;
}

export interface AgentWorker {
  id: string;
  instance: AgentInstance;
  worker: Worker;
  busy: boolean;
  tasksCompleted: number;
  tasksErrored: number;
  averageTime: number;
  mcpClient?: MCPClient;
}

export class ParallelExecutor extends EventEmitter {
  private workers: Map<string, AgentWorker> = new Map();
  private taskQueue: Task[] = [];
  private activeTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, TaskResult> = new Map();
  private maxWorkers: number;
  private config?: SwarmConfig;
  
  constructor(maxWorkers?: number) {
    super();
    this.maxWorkers = maxWorkers || os.cpus().length;
  }
  
  async initialize(config: SwarmConfig): Promise<void> {
    this.config = config;
    this.emit('init:start', { config: config.swarm.name });
    
    // Create workers for each agent instance
    const instances = Object.entries(config.swarm.instances);
    const maxParallel = config.swarm.coordination?.max_parallel || this.maxWorkers;
    
    for (const [name, instance] of instances.slice(0, maxParallel)) {
      await this.createWorker(name, instance);
    }
    
    this.emit('init:complete', { workers: this.workers.size });
  }
  
  private async createWorker(name: string, instance: AgentInstance): Promise<void> {
    const workerPath = path.join(__dirname, 'worker.js');
    
    const worker = new Worker(workerPath, {
      workerData: {
        agentId: name,
        instance,
        config: this.config
      }
    });
    
    const agentWorker: AgentWorker = {
      id: name,
      instance,
      worker,
      busy: false,
      tasksCompleted: 0,
      tasksErrored: 0,
      averageTime: 0
    };
    
    // Set up MCP client if configured
    if (instance.mcps) {
      agentWorker.mcpClient = new MCPClient();
      for (const mcp of instance.mcps) {
        try {
          await agentWorker.mcpClient.connect(mcp);
        } catch (error) {
          this.emit('mcp:error', { agent: name, mcp: mcp.name, error });
        }
      }
    }
    
    // Set up worker event handlers
    worker.on('message', (message) => {
      this.handleWorkerMessage(name, message);
    });
    
    worker.on('error', (error) => {
      this.emit('worker:error', { agent: name, error });
    });
    
    worker.on('exit', (code) => {
      if (code !== 0) {
        this.emit('worker:exit', { agent: name, code });
        this.workers.delete(name);
      }
    });
    
    this.workers.set(name, agentWorker);
  }
  
  private handleWorkerMessage(agentId: string, message: any): void {
    const worker = this.workers.get(agentId);
    if (!worker) return;
    
    switch (message.type) {
      case 'task:complete':
        this.handleTaskComplete(agentId, message.result);
        break;
        
      case 'task:error':
        this.handleTaskError(agentId, message.error);
        break;
        
      case 'tool:call':
        this.handleToolCall(agentId, message.tool);
        break;
        
      case 'log':
        this.emit('worker:log', { agent: agentId, ...message });
        break;
        
      case 'metric':
        this.emit('worker:metric', { agent: agentId, ...message });
        break;
    }
  }
  
  async execute(task: Task): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      // Check dependencies
      if (task.dependencies) {
        const pending = task.dependencies.filter(id => !this.completedTasks.has(id));
        if (pending.length > 0) {
          this.taskQueue.push(task);
          this.emit('task:queued', { task, waiting: pending });
          return;
        }
      }
      
      // Find available worker
      const worker = this.findAvailableWorker(task.agentId);
      if (!worker) {
        this.taskQueue.push(task);
        this.emit('task:queued', { task, reason: 'no-worker' });
        return;
      }
      
      // Execute task
      this.executeOnWorker(worker, task).then(resolve).catch(reject);
    });
  }
  
  private findAvailableWorker(preferredAgentId?: string): AgentWorker | null {
    // Try preferred agent first
    if (preferredAgentId) {
      const preferred = this.workers.get(preferredAgentId);
      if (preferred && !preferred.busy) {
        return preferred;
      }
    }
    
    // Find any available worker
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        return worker;
      }
    }
    
    return null;
  }
  
  private async executeOnWorker(worker: AgentWorker, task: Task): Promise<TaskResult> {
    worker.busy = true;
    this.activeTasks.set(task.id, task);
    this.emit('task:start', { task, agent: worker.id });
    
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const timeout = task.timeout || 300000; // 5 minutes default
      
      const timer = setTimeout(() => {
        worker.busy = false;
        this.activeTasks.delete(task.id);
        
        const result: TaskResult = {
          taskId: task.id,
          agentId: worker.id,
          success: false,
          error: 'Task timeout',
          duration: Date.now() - startTime,
          attempts: 1
        };
        
        this.completedTasks.set(task.id, result);
        reject(new Error('Task timeout'));
      }, timeout);
      
      // Send task to worker
      worker.worker.postMessage({
        type: 'execute',
        task
      });
      
      // Wait for response
      const handler = (message: any) => {
        if (message.type === 'task:complete' && message.taskId === task.id) {
          clearTimeout(timer);
          worker.worker.off('message', handler);
          
          worker.busy = false;
          worker.tasksCompleted++;
          this.activeTasks.delete(task.id);
          
          const result: TaskResult = {
            taskId: task.id,
            agentId: worker.id,
            success: true,
            result: message.result,
            duration: Date.now() - startTime,
            attempts: 1
          };
          
          // Update average time
          worker.averageTime = 
            (worker.averageTime * (worker.tasksCompleted - 1) + result.duration) / 
            worker.tasksCompleted;
          
          this.completedTasks.set(task.id, result);
          this.emit('task:complete', result);
          
          // Process queued tasks
          this.processQueue();
          
          resolve(result);
        } else if (message.type === 'task:error' && message.taskId === task.id) {
          clearTimeout(timer);
          worker.worker.off('message', handler);
          
          worker.busy = false;
          worker.tasksErrored++;
          this.activeTasks.delete(task.id);
          
          const result: TaskResult = {
            taskId: task.id,
            agentId: worker.id,
            success: false,
            error: message.error,
            duration: Date.now() - startTime,
            attempts: 1
          };
          
          this.completedTasks.set(task.id, result);
          this.emit('task:error', result);
          
          // Process queued tasks
          this.processQueue();
          
          reject(new Error(message.error));
        }
      };
      
      worker.worker.on('message', handler);
    });
  }
  
  private processQueue(): void {
    if (this.taskQueue.length === 0) return;
    
    // Sort by priority
    this.taskQueue.sort((a, b) => b.priority - a.priority);
    
    // Try to assign tasks
    const processed: Task[] = [];
    
    for (const task of this.taskQueue) {
      // Check dependencies
      if (task.dependencies) {
        const ready = task.dependencies.every(id => this.completedTasks.has(id));
        if (!ready) continue;
      }
      
      const worker = this.findAvailableWorker(task.agentId);
      if (worker) {
        processed.push(task);
        this.executeOnWorker(worker, task);
      }
    }
    
    // Remove processed tasks
    this.taskQueue = this.taskQueue.filter(t => !processed.includes(t));
  }
  
  private async handleTaskComplete(agentId: string, result: any): void {
    const worker = this.workers.get(agentId);
    if (!worker) return;
    
    worker.busy = false;
    worker.tasksCompleted++;
    
    // Process queue
    this.processQueue();
  }
  
  private async handleTaskError(agentId: string, error: any): void {
    const worker = this.workers.get(agentId);
    if (!worker) return;
    
    worker.busy = false;
    worker.tasksErrored++;
    
    // Process queue
    this.processQueue();
  }
  
  private async handleToolCall(agentId: string, tool: any): Promise<void> {
    const worker = this.workers.get(agentId);
    if (!worker || !worker.mcpClient) return;
    
    try {
      const result = await worker.mcpClient.callTool(tool);
      
      worker.worker.postMessage({
        type: 'tool:result',
        toolCallId: tool.id,
        result
      });
    } catch (error) {
      worker.worker.postMessage({
        type: 'tool:error',
        toolCallId: tool.id,
        error: String(error)
      });
    }
  }
  
  // Batch execution
  async executeBatch(tasks: Task[]): Promise<TaskResult[]> {
    const promises = tasks.map(task => this.execute(task));
    return Promise.all(promises);
  }
  
  // Map-reduce pattern
  async mapReduce<T, R>(
    items: T[],
    mapper: (item: T) => Task,
    reducer: (results: any[]) => R
  ): Promise<R> {
    const tasks = items.map(mapper);
    const results = await this.executeBatch(tasks);
    return reducer(results.map(r => r.result));
  }
  
  // Pipeline execution
  async pipeline(stages: Task[][]): Promise<TaskResult[][]> {
    const results: TaskResult[][] = [];
    
    for (const stage of stages) {
      const stageResults = await this.executeBatch(stage);
      results.push(stageResults);
    }
    
    return results;
  }
  
  // Status and monitoring
  getStatus(): {
    workers: number;
    busy: number;
    queued: number;
    active: number;
    completed: number;
    errors: number;
  } {
    const busy = Array.from(this.workers.values()).filter(w => w.busy).length;
    
    return {
      workers: this.workers.size,
      busy,
      queued: this.taskQueue.length,
      active: this.activeTasks.size,
      completed: this.completedTasks.size,
      errors: Array.from(this.workers.values())
        .reduce((sum, w) => sum + w.tasksErrored, 0)
    };
  }
  
  getWorkerStats(): Map<string, {
    tasksCompleted: number;
    tasksErrored: number;
    averageTime: number;
    busy: boolean;
  }> {
    const stats = new Map();
    
    for (const [id, worker] of this.workers) {
      stats.set(id, {
        tasksCompleted: worker.tasksCompleted,
        tasksErrored: worker.tasksErrored,
        averageTime: worker.averageTime,
        busy: worker.busy
      });
    }
    
    return stats;
  }
  
  // Cleanup
  async shutdown(): Promise<void> {
    this.emit('shutdown:start');
    
    // Wait for active tasks
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    
    while (this.activeTasks.size > 0 && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Terminate workers
    for (const [id, worker] of this.workers) {
      if (worker.mcpClient) {
        await worker.mcpClient.disconnect();
      }
      
      await worker.worker.terminate();
    }
    
    this.workers.clear();
    this.emit('shutdown:complete');
  }
}

// Global instance
export const parallelExecutor = new ParallelExecutor();