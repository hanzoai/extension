/**
 * @hanzo/dev - Advanced AI Development CLI
 * 
 * A comprehensive development tool that:
 * - Integrates with Claude Code, @hanzo/mcp, and other AI tools
 * - Supports parallel agent execution with YAML configuration
 * - Provides deep MCP integration and tool bridging
 * - Offers a superior development experience
 */

// Core packages
export * from './packages/ai';
export * from './packages/auth';
export * from './packages/codebase';
export * from './packages/commands';
export * from './packages/config';
export * from './packages/execution';
export * from './packages/mcp';

// Terminal UI
export * from './lib/terminal-ui';
export * from './lib/command-registry';

// Agent systems
export * from './lib/agent-loop';
export * from './lib/code-act-agent';
export * from './lib/interactive-agent';
export * from './lib/swarm-runner';
export * from './lib/swarm-coordinator';
export * from './lib/peer-agent-network';

// Tools and services
export * from './lib/editor';
export * from './lib/function-calling';
export * from './lib/mcp-client';

// Configuration
export * from './lib/config';

// Main CLI entry
export { program as cli } from './cli/dev';

// Global instances
import { aiProviderManager } from './packages/ai/providers';
import { authManager } from './packages/auth/manager';
import { codebaseAnalyzer } from './packages/codebase/analyzer';
import { swarmConfigManager } from './packages/config/swarm';
import { parallelExecutor } from './packages/execution/parallel';

// Initialize on import
authManager.loadFromEnvironment();

// Export main API
export const hanzodev = {
  ai: aiProviderManager,
  auth: authManager,
  codebase: codebaseAnalyzer,
  swarm: swarmConfigManager,
  parallel: parallelExecutor,
  
  // High-level methods
  async runSwarm(configPath: string, task: string): Promise<void> {
    const config = await swarmConfigManager.loadConfig(configPath);
    await parallelExecutor.initialize(config);
    
    // Create main task
    const mainTask = {
      id: 'main',
      type: 'completion' as const,
      agentId: config.swarm.main,
      priority: 100,
      payload: {
        messages: [
          { role: 'user' as const, content: task }
        ]
      }
    };
    
    const result = await parallelExecutor.execute(mainTask);
    console.log(result);
  },
  
  async analyzeCodebase(path: string): Promise<any> {
    return codebaseAnalyzer.analyze(path);
  },
  
  async authenticate(provider: string): Promise<void> {
    await authManager.authenticate(provider);
  },
  
  async complete(prompt: string, provider?: string): Promise<string> {
    const response = await aiProviderManager.complete({
      messages: [
        { role: 'user' as const, content: prompt }
      ]
    }, provider);
    
    return response.content;
  }
};

// Make it available globally
if (typeof window !== 'undefined') {
  (window as any).hanzodev = hanzodev;
} else if (typeof global !== 'undefined') {
  (global as any).hanzodev = hanzodev;
}