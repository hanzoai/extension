import { nanoid } from 'nanoid';

/**
 * Creates a unique completion ID
 */
export function createCompletionId(): string {
  return `cmpl-${nanoid()}`;
}