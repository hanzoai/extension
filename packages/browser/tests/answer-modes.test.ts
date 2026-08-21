import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from '@hanzo/ui/gui-config';
import { Toolbar, MODES, SOURCES, type Mode } from '../src/answer/Toolbar.js';

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
 * gets, so the assertions run against the markup they emit. They are what is
 * left local now that `@hanzo/ui/chat` owns the composer — the field, the Enter
 * rule and the send control are the shell's and are asserted there.
 *
 * Selected by `data-mode` / `data-source` / `data-on`, not by class name: the
 * controls are `@hanzo/ui` buttons whose classes belong to the design system and
 * change with it, while these attributes are this file's own contract.
 */

const props = (mode: Mode) => ({
  mode,
  setMode: () => {},
  sources: new Set<string>(),
  toggleSource: () => {},
});

// The toolbar renders REAL @hanzo/ui, so it mounts the way every consumer must:
// under GuiProvider — outside it, a gui component throws on first paint.
const draw = (mode: Mode) =>
  renderToStaticMarkup(
    React.createElement(
      GuiProvider,
      { config: guiConfig, defaultTheme: 'dark' },
      React.createElement(Toolbar, props(mode)),
    ),
  );

/** The value of `attr` on every element carrying it, in document order. */
const attrs = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((m) => m[1]);

/** The value of `attr` on the elements that are also marked `data-on`. */
const on = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`<[^>]*${attr}="([^"]+)"[^>]*data-on="true"`, 'g'))].map((m) => m[1]);

describe('answer modes', () => {
  it('names four, in escalating effort, with no Deep', () => {
    expect(MODES.map((m) => m.id)).toEqual(['chat', 'search', 'news', 'research']);
    expect(attrs(draw('search'), 'data-mode')).toEqual(['chat', 'search', 'news', 'research']);
  });

  it('marks exactly the selected tab, for every mode it offers', () => {
    for (const m of MODES) {
      expect(on(draw(m.id), 'data-mode'), m.id).toEqual([m.id]);
    }
  });

  it('offers the six sources to ground a web answer, and none to Chat', () => {
    expect(attrs(draw('search'), 'data-source')).toEqual(SOURCES);
    // Chat goes straight to the model, so there is nothing to source from —
    // the row itself stays (dropping it would slide the toolbar left).
    expect(attrs(draw('chat'), 'data-source')).toEqual([]);
    expect(draw('chat')).toContain('data-slot="sources"');
  });

  it('leaves no path back to the retired mode', () => {
    expect(JSON.stringify(MODES)).not.toMatch(/deep/i);
  });
});
