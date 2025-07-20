import { createParser, ParsedEvent } from 'eventsource-parser';

export interface StreamPart {
  type: 'text' | 'function_call' | 'tool_calls' | 'data' | 'error' | 'done';
  value: any;
}

/**
 * Parses a stream part from a server-sent event
 */
export function parseStreamPart(data: string): StreamPart | null {
  try {
    const parsed = JSON.parse(data);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Creates an event source parser
 */
export function createEventSourceParser(onParse: (event: ParsedEvent) => void) {
  return createParser(onParse);
}