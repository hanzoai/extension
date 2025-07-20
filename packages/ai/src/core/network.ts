/**
 * Network implementation for agent collaboration
 */

import { Agent } from './agent';
import { State } from './state';
import { Router } from './router';
import { ModelInterface } from '../types';
import { Telemetry, SpanKind } from '../telemetry';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'events';

export interface NetworkConfig {
  name: string;
  agents: Agent[];
  defaultModel?: ModelInterface;
  router?: Router | ((context: RouterContext) => Agent | undefined);
  state?: State;
  maxIterations?: number;
  metadata?: Record<string, any>;
}

export interface RouterContext {
  network: Network;
  state: State;
  messages: any[];
  iteration: number;
  history: ExecutionHistory[];
}

export interface ExecutionHistory {
  agent: string;
  input: any;
  output: any;
  timestamp: number;
  duration: number;
}

export interface NetworkRunOptions {
  messages: any[];
  stream?: boolean;
  onIteration?: (context: RouterContext) => void;
  telemetry?: Telemetry;
}

export class Network extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly agents: Map<string, Agent>;
  readonly defaultModel?: ModelInterface;
  readonly router: Router;
  readonly state: State;
  readonly maxIterations: number;
  readonly metadata: Record<string, any>;
  
  private initialized = false;
  
  constructor(config: NetworkConfig) {
    super();
    this.id = nanoid();
    this.name = config.name;
    this.agents = new Map();
    this.defaultModel = config.defaultModel;
    this.state = config.state || new State();
    this.maxIterations = config.maxIterations || 10;
    this.metadata = config.metadata || {};
    
    // Register agents
    for (const agent of config.agents) {
      this.agents.set(agent.name, agent);
    }
    
    // Setup router
    if (typeof config.router === 'function') {
      this.router = new Router({ handler: config.router });
    } else if (config.router) {
      this.router = config.router;
    } else {
      // Default router - just use first agent
      this.router = new Router({
        handler: () => config.agents[0]
      });
    }
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Initialize all agents
    const initPromises = Array.from(this.agents.values()).map(agent => 
      agent.initialize()
    );
    
    await Promise.all(initPromises);
    
    this.initialized = true;
    this.emit('initialized');
  }
  
  async run(options: NetworkRunOptions): Promise<any> {
    await this.initialize();
    
    const telemetry = options.telemetry || new Telemetry();
    const history: ExecutionHistory[] = [];
    let messages = [...options.messages];
    
    return telemetry.trace(
      `network.${this.name}`,
      async (span) => {
        const networkStartTime = Date.now();
        const agentExecutions = new Map<string, number>();
        
        // Add network metadata to span
        span.setAttributes({
          'network.name': this.name,
          'network.id': this.id,
          'network.agents.count': this.agents.size,
          'network.maxIterations': this.maxIterations,
          'network.messages.initial': messages.length
        });
        
        try {
          for (let iteration = 0; iteration < this.maxIterations; iteration++) {
            // Build router context
            const context: RouterContext = {
              network: this,
              state: this.state,
              messages,
              iteration,
              history
            };
            
            // Call iteration callback if provided
            if (options.onIteration) {
              options.onIteration(context);
            }
            
            // Get next agent from router with telemetry
            const nextAgent = await telemetry.trace(
              `router.${this.name}`,
              async () => this.router.route(context),
              {
                kind: SpanKind.INTERNAL,
                attributes: { 'router.iteration': iteration }
              }
            );
            
            if (!nextAgent) {
              // No more agents to run
              this.emit('complete', { history, state: this.state });
              telemetry.recordEvent({
                name: 'network.complete',
                attributes: {
                  'network.name': this.name,
                  'network.iterations': iteration,
                  'network.reason': 'no_next_agent'
                }
              });
              break;
            }
            
            // Track agent executions
            agentExecutions.set(
              nextAgent.name,
              (agentExecutions.get(nextAgent.name) || 0) + 1
            );
            
            this.emit('agent:start', { agent: nextAgent.name, iteration });
            
            // Run agent
            const startTime = Date.now();
            
            try {
              const agentContext = {
                network: this,
                state: this.state,
                telemetry
              };
              
              const result = await nextAgent.run({
                messages,
                model: this.defaultModel,
                context: agentContext,
                stream: options.stream
              });
              
              const duration = Date.now() - startTime;
              
              // Add to history
              const historyEntry: ExecutionHistory = {
                agent: nextAgent.name,
                input: messages[messages.length - 1],
                output: result,
                timestamp: Date.now(),
                duration
              };
              
              history.push(historyEntry);
              
              // Update messages
              if (result.content) {
                messages.push({
                  role: 'assistant',
                  content: result.content,
                  metadata: {
                    agent: nextAgent.name
                  }
                });
              }
              
              this.emit('agent:complete', { 
                agent: nextAgent.name, 
                iteration,
                result,
                duration 
              });
              
              // Check for completion
              if (this.state.kv.get('complete') === true) {
                this.emit('complete', { history, state: this.state });
                telemetry.recordEvent({
                  name: 'network.complete',
                  attributes: {
                    'network.name': this.name,
                    'network.iterations': iteration + 1,
                    'network.reason': 'state_complete'
                  }
                });
                break;
              }
              
            } catch (error) {
              this.emit('agent:error', { 
                agent: nextAgent.name, 
                iteration,
                error 
              });
              throw error;
            }
          }
          
          const networkDuration = Date.now() - networkStartTime;
          
          // Record network execution metrics
          if (telemetry && 'recordNetworkExecution' in telemetry) {
            (telemetry as any).recordNetworkExecution(
              this.name,
              history.length,
              networkDuration,
              agentExecutions
            );
          }
          
          // Return final result
          return {
            messages,
            history,
            state: this.state.toJSON(),
            iterations: history.length
          };
        } catch (error) {
          const networkDuration = Date.now() - networkStartTime;
          
          // Record failed network execution
          telemetry.recordEvent({
            name: 'network.error',
            attributes: {
              'network.name': this.name,
              'network.duration': networkDuration,
              'network.iterations': history.length,
              'error.message': error instanceof Error ? error.message : String(error)
            }
          });
          
          throw error;
        }
      },
      {
        kind: SpanKind.SERVER,
        attributes: {
          'network.type': 'agent_network'
        }
      }
    );
  }
  
  async *stream(options: NetworkRunOptions): AsyncIterableIterator<any> {
    await this.initialize();
    
    const telemetry = options.telemetry || new Telemetry();
    const history: ExecutionHistory[] = [];
    let messages = [...options.messages];
    
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // Build router context
      const context: RouterContext = {
        network: this,
        state: this.state,
        messages,
        iteration,
        history
      };
      
      // Get next agent from router
      const nextAgent = await this.router.route(context);
      
      if (!nextAgent) {
        // No more agents to run
        yield { type: 'complete', history, state: this.state.toJSON() };
        break;
      }
      
      yield { type: 'agent:start', agent: nextAgent.name, iteration };
      
      // Run agent
      const startTime = Date.now();
      const agentContext = {
        network: this,
        state: this.state,
        telemetry
      };
      
      // Stream from agent
      const stream = await nextAgent.run({
        messages,
        model: this.defaultModel,
        context: agentContext,
        stream: true
      });
      
      let content = '';
      
      for await (const chunk of stream) {
        yield { ...chunk, agent: nextAgent.name };
        
        if (chunk.type === 'content') {
          content += chunk.content;
        }
      }
      
      const duration = Date.now() - startTime;
      
      // Add to history
      const historyEntry: ExecutionHistory = {
        agent: nextAgent.name,
        input: messages[messages.length - 1],
        output: { content },
        timestamp: Date.now(),
        duration
      };
      
      history.push(historyEntry);
      
      // Update messages
      if (content) {
        messages.push({
          role: 'assistant',
          content,
          metadata: {
            agent: nextAgent.name
          }
        });
      }
      
      yield { 
        type: 'agent:complete',
        agent: nextAgent.name,
        iteration,
        duration
      };
      
      // Check for completion
      if (this.state.kv.get('complete') === true) {
        yield { type: 'complete', history, state: this.state.toJSON() };
        break;
      }
    }
  }
  
  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }
  
  addAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
    this.emit('agent:added', { agent: agent.name });
  }
  
  removeAgent(name: string): void {
    if (this.agents.delete(name)) {
      this.emit('agent:removed', { agent: name });
    }
  }
  
  reset(): void {
    this.state.reset();
    this.emit('reset');
  }
  
  getMetrics(): {
    totalIterations: number;
    agentExecutions: Map<string, number>;
    averageDuration: number;
    errors: number;
  } {
    // This would be populated from telemetry in a real implementation
    return {
      totalIterations: 0,
      agentExecutions: new Map(),
      averageDuration: 0,
      errors: 0
    };
  }
}

export function createNetwork(config: NetworkConfig): Network {
  return new Network(config);
}