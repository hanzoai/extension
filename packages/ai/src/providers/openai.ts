/**
 * OpenAI provider
 */

import { ModelInterface } from '../types';

export const openai = (config: { apiKey: string; model?: string }): ModelInterface => {
  return {
    name: config.model || 'gpt-4',
    async complete(params) {
      // Implementation would call OpenAI API
      return { content: 'OpenAI response' };
    },
    async *stream(params) {
      // Implementation would stream from OpenAI
      yield { type: 'content', content: 'OpenAI' };
      yield { type: 'done' };
    }
  };
};