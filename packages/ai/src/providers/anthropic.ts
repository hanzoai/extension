/**
 * Anthropic provider
 */

import { ModelInterface } from '../types';

export const anthropic = (config: { apiKey: string; model?: string }): ModelInterface => {
  return {
    name: config.model || 'claude-3-opus-20240229',
    async complete(params) {
      // Implementation would call Anthropic API
      return { content: 'Claude response' };
    },
    async *stream(params) {
      // Implementation would stream from Anthropic
      yield { type: 'content', content: 'Claude' };
      yield { type: 'done' };
    }
  };
};