import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// sketch-bridge.js is CommonJS (CocoaScript runtime). Its pure exports —
// collectTextLayers and noteFrame — operate on plain layer/frame shapes, so we
// exercise them here without the sketch/dom runtime. readSelection/applyLayerEdits/
// insertNote call require('sketch/dom') and belong to the Sketch host.
const require = createRequire(import.meta.url);
const bridge = require('../src/sketch-bridge.cjs') as {
  collectTextLayers: (layers: unknown[]) => Array<{ id: string; name: string; text: string }>;
  noteFrame: (
    layers: Array<{ frame: { x: number; y: number; width: number; height: number } }>,
  ) => { x: number; y: number; width: number; height: number };
};

describe('collectTextLayers', () => {
  it('flattens Text layers in document order', () => {
    const layers = [
      { type: 'Text', id: 'a', name: 'One', text: 'first' },
      { type: 'Text', id: 'b', name: 'Two', text: 'second' },
    ];
    expect(bridge.collectTextLayers(layers)).toEqual([
      { id: 'a', name: 'One', text: 'first' },
      { id: 'b', name: 'Two', text: 'second' },
    ]);
  });

  it('recurses into groups/artboards, skipping non-text container layers themselves', () => {
    const layers = [
      {
        type: 'Group',
        id: 'g',
        layers: [
          { type: 'Text', id: 'a', name: 'Nested', text: 'deep' },
          { type: 'Shape', id: 's', layers: [] },
        ],
      },
      { type: 'Text', id: 'b', name: 'Top', text: 'top' },
    ];
    expect(bridge.collectTextLayers(layers).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('defaults missing name/text to empty strings', () => {
    const layers = [{ type: 'Text', id: 'a' }];
    expect(bridge.collectTextLayers(layers)).toEqual([{ id: 'a', name: '', text: '' }]);
  });

  it('is empty for no layers', () => {
    expect(bridge.collectTextLayers([])).toEqual([]);
    expect(bridge.collectTextLayers(undefined as unknown as unknown[])).toEqual([]);
  });
});

describe('noteFrame', () => {
  it('places the note below the union of selected frames, min-width 360', () => {
    const frame = bridge.noteFrame([
      { frame: { x: 100, y: 50, width: 200, height: 40 } },
      { frame: { x: 120, y: 200, width: 80, height: 30 } },
    ]);
    expect(frame.x).toBe(100); // leftmost
    expect(frame.y).toBe(200 + 30 + 24); // below the lowest bottom, +24 gap
    expect(frame.width).toBe(360); // union width 200 < 360 → clamped
  });

  it('widens to the union width when it exceeds 360', () => {
    const frame = bridge.noteFrame([{ frame: { x: 0, y: 0, width: 500, height: 40 } }]);
    expect(frame.width).toBe(500);
  });

  it('falls back to a default frame for an empty selection', () => {
    expect(bridge.noteFrame([])).toEqual({ x: 0, y: 0, width: 360, height: 200 });
  });
});
