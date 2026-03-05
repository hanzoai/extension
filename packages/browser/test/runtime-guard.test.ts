import { describe, expect, it } from 'vitest';
import {
  InFlightRequestDeduper,
  makeChatRequestKey,
  pickModelForTokenBudget,
  trimMessagesToBudget,
} from '../src/runtime-guard';

describe('runtime-guard', () => {
  it('trims older messages to respect token budget while keeping newest', () => {
    const messages = [
      { role: 'system', content: 'sys '.repeat(200) },
      { role: 'user', content: 'older '.repeat(400) },
      { role: 'assistant', content: 'older answer '.repeat(300) },
      { role: 'user', content: 'latest prompt' },
    ];

    const result = trimMessagesToBudget(messages as any, {
      maxMessages: 24,
      maxInputTokens: 300,
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[result.messages.length - 1].content).toContain('latest prompt');
    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.inputTokens).toBeLessThanOrEqual(300 + 10);
  });

  it('creates deterministic chat request keys', () => {
    const messages = [{ role: 'user', content: 'hello   world' }];
    const k1 = makeChatRequestKey('gpt-4o', messages as any, 0.2, 500);
    const k2 = makeChatRequestKey('gpt-4o', messages as any, 0.2, 500);
    const k3 = makeChatRequestKey('gpt-4o', [{ role: 'user', content: 'hello world!' }] as any, 0.2, 500);

    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('dedupes in-flight requests with the same key', async () => {
    const deduper = new InFlightRequestDeduper<string>();
    let runs = 0;

    const first = deduper.getOrCreate('same', async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return 'ok';
    });
    const second = deduper.getOrCreate('same', async () => {
      runs += 1;
      return 'second';
    });

    const [a, b] = await Promise.all([first.promise, second.promise]);

    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(runs).toBe(1);
  });

  it('routes auto model to smaller model for small prompts', () => {
    const model = pickModelForTokenBudget(
      'auto',
      ['gpt-4o', 'zen-coder-flash', 'zen-max'],
      200,
    );
    expect(model).toBe('zen-coder-flash');
  });
});
