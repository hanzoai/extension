/**
 * State management for agent networks
 */

import { EventEmitter } from 'events';
import { z } from 'zod';

export interface StateConfig {
  schema?: z.ZodSchema;
  initial?: Record<string, any>;
  persistent?: boolean;
}

export interface StateChange {
  key: string;
  oldValue: any;
  newValue: any;
  timestamp: number;
}

export class State extends EventEmitter {
  readonly kv: Map<string, any>;
  readonly history: StateChange[];
  readonly schema?: z.ZodSchema;
  private readonly persistent: boolean;
  
  constructor(config: StateConfig = {}) {
    super();
    this.kv = new Map();
    this.history = [];
    this.schema = config.schema;
    this.persistent = config.persistent || false;
    
    // Initialize with initial values
    if (config.initial) {
      for (const [key, value] of Object.entries(config.initial)) {
        this.set(key, value);
      }
    }
    
    // Load from persistence if enabled
    if (this.persistent) {
      this.load();
    }
  }
  
  set(key: string, value: any): void {
    // Validate against schema if provided
    if (this.schema) {
      const result = this.schema.safeParse({ ...this.toJSON(), [key]: value });
      if (!result.success) {
        throw new Error(`State validation failed: ${result.error.message}`);
      }
    }
    
    const oldValue = this.kv.get(key);
    this.kv.set(key, value);
    
    // Record change
    const change: StateChange = {
      key,
      oldValue,
      newValue: value,
      timestamp: Date.now()
    };
    
    this.history.push(change);
    
    // Emit change event
    this.emit('change', change);
    this.emit(`change:${key}`, { oldValue, newValue: value });
    
    // Persist if enabled
    if (this.persistent) {
      this.save();
    }
  }
  
  get(key: string): any {
    return this.kv.get(key);
  }
  
  has(key: string): boolean {
    return this.kv.has(key);
  }
  
  delete(key: string): boolean {
    const oldValue = this.kv.get(key);
    const deleted = this.kv.delete(key);
    
    if (deleted) {
      const change: StateChange = {
        key,
        oldValue,
        newValue: undefined,
        timestamp: Date.now()
      };
      
      this.history.push(change);
      this.emit('change', change);
      this.emit(`change:${key}`, { oldValue, newValue: undefined });
      
      if (this.persistent) {
        this.save();
      }
    }
    
    return deleted;
  }
  
  clear(): void {
    const oldState = this.toJSON();
    this.kv.clear();
    
    // Record all deletions
    for (const key of Object.keys(oldState)) {
      const change: StateChange = {
        key,
        oldValue: oldState[key],
        newValue: undefined,
        timestamp: Date.now()
      };
      this.history.push(change);
    }
    
    this.emit('clear', { oldState });
    
    if (this.persistent) {
      this.save();
    }
  }
  
  reset(): void {
    this.clear();
    this.history.length = 0;
    this.emit('reset');
  }
  
  toJSON(): Record<string, any> {
    const obj: Record<string, any> = {};
    for (const [key, value] of this.kv) {
      obj[key] = value;
    }
    return obj;
  }
  
  fromJSON(data: Record<string, any>): void {
    this.clear();
    for (const [key, value] of Object.entries(data)) {
      this.set(key, value);
    }
  }
  
  getHistory(key?: string): StateChange[] {
    if (key) {
      return this.history.filter(change => change.key === key);
    }
    return [...this.history];
  }
  
  rollback(steps: number = 1): void {
    if (steps > this.history.length) {
      throw new Error('Cannot rollback more steps than history length');
    }
    
    // Get changes to rollback
    const changesToRollback = this.history.slice(-steps);
    
    // Apply rollback
    for (const change of changesToRollback.reverse()) {
      if (change.oldValue === undefined) {
        this.kv.delete(change.key);
      } else {
        this.kv.set(change.key, change.oldValue);
      }
    }
    
    // Remove rolled back changes from history
    this.history.length = this.history.length - steps;
    
    this.emit('rollback', { steps, changes: changesToRollback });
    
    if (this.persistent) {
      this.save();
    }
  }
  
  // Persistence methods
  private save(): void {
    // Only available in browser environments
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const data = {
        state: this.toJSON(),
        history: this.history
      };
      (globalThis as any).localStorage.setItem('hanzo-ai-state', JSON.stringify(data));
    }
  }
  
  private load(): void {
    // Only available in browser environments
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      const stored = (globalThis as any).localStorage.getItem('hanzo-ai-state');
      if (stored) {
        try {
          const data = JSON.parse(stored);
          this.fromJSON(data.state);
          this.history.push(...(data.history || []));
        } catch (error) {
          console.error('Failed to load state from storage:', error);
        }
      }
    }
  }
  
  // Computed properties
  compute<T>(key: string, fn: (state: Record<string, any>) => T): T {
    const state = this.toJSON();
    const result = fn(state);
    
    // Cache computed value
    this.set(`_computed_${key}`, result);
    
    return result;
  }
  
  watch(key: string, callback: (value: any) => void): () => void {
    const handler = ({ newValue }: any) => callback(newValue);
    this.on(`change:${key}`, handler);
    
    // Return unsubscribe function
    return () => {
      this.off(`change:${key}`, handler);
    };
  }
  
  // State machine helpers
  transition(from: string, to: string, stateKey: string = 'state'): boolean {
    const current = this.get(stateKey);
    
    if (current === from) {
      this.set(stateKey, to);
      this.emit('transition', { from, to, stateKey });
      return true;
    }
    
    return false;
  }
  
  inState(state: string, stateKey: string = 'state'): boolean {
    return this.get(stateKey) === state;
  }
}

export function createState(config?: StateConfig): State {
  return new State(config);
}