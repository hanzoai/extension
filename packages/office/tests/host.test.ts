import { describe, it, expect } from 'vitest';
import { excelValuesToText, splitLines } from '../src/host';

describe('excelValuesToText', () => {
  it('flattens a 2-D range to TSV rows', () => {
    expect(excelValuesToText([['a', 'b'], ['c', 'd']])).toBe('a\tb\nc\td');
  });
  it('renders null/undefined cells as empty', () => {
    expect(excelValuesToText([[1, null], [undefined, 4]])).toBe('1\t\n\t4');
  });
  it('empty range → empty string', () => {
    expect(excelValuesToText([])).toBe('');
  });
});

describe('splitLines', () => {
  it('one line per cell down a column', () => {
    expect(splitLines('a\nb\nc')).toEqual([['a'], ['b'], ['c']]);
  });
  it('drops trailing blank lines so a stray newline does not clear a cell', () => {
    expect(splitLines('a\nb\n\n')).toEqual([['a'], ['b']]);
  });
  it('single line stays a 1x1', () => {
    expect(splitLines('solo')).toEqual([['solo']]);
  });
});
