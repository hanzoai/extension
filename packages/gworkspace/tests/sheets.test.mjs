import { describe, it, expect } from 'vitest';
import { loadGs } from './loadGs.mjs';

const { rangeToText, linesToRows } = loadGs('src/sheets.gs');

describe('rangeToText', () => {
  it('flattens a 2-D range to TSV rows', () => {
    expect(rangeToText([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });
  it('renders null/undefined cells as empty', () => {
    expect(rangeToText([[1, null], [undefined, 4]])).toBe('1\t\n\t4');
  });
  it('empty range → empty string', () => {
    expect(rangeToText([])).toBe('');
  });
});

describe('linesToRows', () => {
  it('one line per cell down a column', () => {
    expect(linesToRows('a\nb\nc')).toEqual([['a'], ['b'], ['c']]);
  });
  it('drops trailing blank lines so a stray newline does not clear a cell', () => {
    expect(linesToRows('a\nb\n\n')).toEqual([['a'], ['b']]);
  });
  it('single line stays a 1x1', () => {
    expect(linesToRows('solo')).toEqual([['solo']]);
  });
});
