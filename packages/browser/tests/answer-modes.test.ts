import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer, MODES, SOURCES, type Mode } from '../src/answer/Composer.js';

/**
 * The answer surface offers FOUR modes: Chat, Search, News, Research.
 *
 * There was a fifth, Deep. It was research with the dials up — same system
 * prompt, same models, same plan gate, only wider bounds (6/16/6 at 10c vs
 * 4/12/4 at 5c) — so the tab offered a choice that was really an intensity and
 * hid a 2x price behind an adjective. Cloud collapsed the two into one research
 * mode (hanzoai/cloud apps/answer/mode.go); this is the client half of that.
 *
 * Rendered, not read: the tabs and the source pills are what a user actually
 * gets, so the assertions run against the markup the composer emits.
 */

const props = (mode: Mode) => ({
  value: '',
  onChange: () => {},
  onSubmit: () => {},
  mode,
  setMode: () => {},
  sources: new Set<string>(),
  toggleSource: () => {},
  models: [],
  model: { id: 'auto', name: 'Auto', description: '', tier: '', family: 'auto', context: null },
  setModel: () => {},
  busy: false,
});

const draw = (mode: Mode) => renderToStaticMarkup(React.createElement(Composer, props(mode)));
const labels = (html: string) =>
  [...html.matchAll(/class="ae-mode[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);

describe('answer modes', () => {
  it('names four, in escalating effort, with no Deep', () => {
    expect(MODES.map((m) => m.id)).toEqual(['chat', 'search', 'news', 'research']);
    expect(labels(draw('search'))).toEqual(['Chat', 'Search', 'News', 'Research']);
  });

  it('marks exactly the selected tab, for every mode it offers', () => {
    for (const m of MODES) {
      const on = [...draw(m.id).matchAll(/class="ae-mode on"[^>]*>([^<]+)</g)].map((x) => x[1]);
      expect(on, m.id).toEqual([m.label]);
    }
  });

  it('offers the six sources to ground a web answer, and none to Chat', () => {
    const pills = (html: string) =>
      [...html.matchAll(/class="ae-chip[^"]*"[^>]*>@([^<]+)</g)].map((m) => m[1]);
    expect(pills(draw('search'))).toEqual(SOURCES);
    // Chat goes straight to the model, so there is nothing to source from —
    // the row itself stays (it is the left half of a space-between).
    expect(pills(draw('chat'))).toEqual([]);
    expect(draw('chat')).toContain('class="ae-chips"');
  });

  it('leaves no path back to the retired mode', () => {
    expect(JSON.stringify(MODES)).not.toMatch(/deep/i);
  });
});
