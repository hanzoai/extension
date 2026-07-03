/**
 * Behavioral contract for the ONE cross-browser evaluate rule.
 *
 * wrapEvaluable's output is an *expression*: both consumers evaluate it and
 * await the result (CDP `awaitPromise: true`; executeScript resolves returned
 * promises). So the honest test is to do exactly that — evaluate the wrapped
 * string with indirect eval and await it — not to string-match the wrapper.
 */

import { describe, it, expect } from 'vitest';
import { pickEvaluable, wrapEvaluable } from '../src/shared/evaluable.js';

// Indirect eval = global scope, mirrors how the page evaluates the expression.
async function run(code: string): Promise<any> {
  // eslint-disable-next-line no-eval
  return await (0, eval)(wrapEvaluable(code));
}

describe('wrapEvaluable behavior', () => {
  it('bare expression returns its value directly', async () => {
    expect(wrapEvaluable('1 + 1')).toBe('1 + 1');
    expect(await run('1 + 1')).toBe(2);
  });

  it('statement body evaluates instead of throwing SyntaxError', async () => {
    // The pre-shared Firefox wrap produced `return (const a = 1; a + 1);`.
    expect(await run('const a = 1; a + 1')).toBe(2);
  });

  it('auto-returns the trailing expression of a multi-statement body', async () => {
    expect(await run('const x = { n: 41 }; x.n + 1')).toBe(42);
  });

  it('respects an explicit return', async () => {
    expect(await run('const a = 7; return a * 3')).toBe(21);
  });

  it('newline-separated statements work like semicolon-separated ones', async () => {
    expect(await run('const a = 2\na * 5')).toBe(10);
  });

  it('single statement with trailing semicolon runs for effect', async () => {
    (globalThis as any).__evaluable_probe = 0;
    expect(await run('globalThis.__evaluable_probe = 9;')).toBe(9);
    expect((globalThis as any).__evaluable_probe).toBe(9);
    delete (globalThis as any).__evaluable_probe;
  });

  it('await works at the top level of a statement body', async () => {
    expect(await run('const v = await Promise.resolve(5); v + 1')).toBe(6);
  });

  it('ready-made IIFEs pass through untouched', async () => {
    const iife = '(async () => 5)()';
    expect(wrapEvaluable(iife)).toBe(iife);
    expect(await run(iife)).toBe(5);
  });

  it('arrow and function expressions pass through untouched', () => {
    expect(wrapEvaluable('() => 5')).toBe('() => 5');
    expect(wrapEvaluable('function f() { return 5 }')).toBe('function f() { return 5 }');
  });

  it('throw statements reject so callers see the page-side error', async () => {
    await expect(run('throw new Error("boom")')).rejects.toThrow('boom');
  });

  it('declaration tails are not auto-returned', async () => {
    expect(await run('const a = 1; const b = 2;')).toBeUndefined();
  });

  it('empty / whitespace input evaluates to undefined', async () => {
    expect(wrapEvaluable('')).toBe('undefined');
    expect(await run('   ')).toBeUndefined();
  });
});

describe('pickEvaluable param aliases', () => {
  it('accepts expression (CDP), code (MCP/SDK), and legacy aliases', () => {
    expect(pickEvaluable({ expression: 'a' })).toBe('a');
    expect(pickEvaluable({ code: 'b' })).toBe('b');
    expect(pickEvaluable({ script: 'c' })).toBe('c');
    expect(pickEvaluable({ function: 'd' })).toBe('d');
    expect(pickEvaluable({ js: 'e' })).toBe('e');
  });

  it('prefers expression over the aliases', () => {
    expect(pickEvaluable({ expression: 'a', code: 'b', js: 'e' })).toBe('a');
  });

  it('returns empty string for missing params', () => {
    expect(pickEvaluable({})).toBe('');
    expect(pickEvaluable(undefined)).toBe('');
    expect(pickEvaluable(null)).toBe('');
  });
});
