/**
 * Router implementation for agent networks
 */

import { Agent } from './agent';
import { Network } from './network';
import { State } from './state';

export interface RouterConfig {
  handler: (context: RouterContext) => Agent | undefined | Promise<Agent | undefined>;
  metadata?: Record<string, any>;
}

export interface RouterContext {
  network: Network;
  state: State;
  messages: any[];
  iteration: number;
  history: any[];
}

export class Router {
  private handler: RouterConfig['handler'];
  readonly metadata: Record<string, any>;
  
  constructor(config: RouterConfig) {
    this.handler = config.handler;
    this.metadata = config.metadata || {};
  }
  
  async route(context: RouterContext): Promise<Agent | undefined> {
    return Promise.resolve(this.handler(context));
  }
}

export function createRouter(config: RouterConfig): Router {
  return new Router(config);
}