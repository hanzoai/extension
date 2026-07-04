import { describe, it, expect } from 'vitest';
import { chooseSubject } from '../src/actions';

// chooseSubject is the capture policy: what the model sees when a command runs.
// It is pure (no @raycast/api), so the whole selection-vs-clipboard decision is
// tested here without mounting Raycast.
describe('chooseSubject (selection → clipboard → none)', () => {
  it('prefers a non-empty selection over the clipboard', () => {
    expect(chooseSubject('selected', 'copied')).toEqual({ text: 'selected', source: 'selection' });
  });

  it('trims the selection', () => {
    expect(chooseSubject('  selected  ', 'copied')).toEqual({ text: 'selected', source: 'selection' });
  });

  it('falls back to the clipboard when the selection is empty/whitespace/null', () => {
    expect(chooseSubject('', 'copied')).toEqual({ text: 'copied', source: 'clipboard' });
    expect(chooseSubject('   ', 'copied')).toEqual({ text: 'copied', source: 'clipboard' });
    expect(chooseSubject(null, 'copied')).toEqual({ text: 'copied', source: 'clipboard' });
  });

  it('trims the clipboard fallback', () => {
    expect(chooseSubject(null, '  copied  ')).toEqual({ text: 'copied', source: 'clipboard' });
  });

  it('yields an empty context when both are empty/null', () => {
    expect(chooseSubject(null, null)).toEqual({});
    expect(chooseSubject('', '')).toEqual({});
    expect(chooseSubject('  ', '   ')).toEqual({});
  });
});
