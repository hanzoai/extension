import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from '@hanzo/ui/gui-config';
import { AnswerEngine } from '../src/answer/AnswerEngine.js';
import { Rail } from '../src/answer/Rail.js';

/**
 * A new tab is a place to ask, so the surface opens with the rail collapsed and
 * the composer holding the width.
 *
 * Collapsed is an ICON RAIL, not an absence: the brand and the way back stay on
 * screen, and the labels are always in the markup and hidden in CSS, so widening
 * the rail needs no re-render. Collapse is EXPLICIT — the rail never springs open
 * under the pointer — so the mark itself has to be the way back.
 */

function markup(el: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(GuiProvider, { config: guiConfig, defaultTheme: 'dark' }, el),
  );
}

const railProps = { toggle: () => {}, newThread: () => {}, signIn: () => {} };

describe('the answer rail', () => {
  it('opens collapsed', () => {
    const html = markup(
      React.createElement(AnswerEngine, {
        apiBase: 'https://api.hanzo.ai',
        getToken: async () => null,
        signIn: () => {},
      }),
    );
    expect(html).toContain('ae-root collapsed');
  });

  it('keeps its affordances and its labels while collapsed', () => {
    const shut = markup(React.createElement(Rail, { ...railProps, collapsed: true }));
    // The way back is still clickable...
    expect(shut).toContain('ae-brand');
    expect(shut).toContain('ae-new');
    // ...and the labels stay in the markup for CSS to reveal on expand,
    // so widening the rail needs no re-render.
    expect(shut).toContain('New thread');
  });

  it('makes the mark the way back when collapsed, and the brand when open', () => {
    // While the rail opened on hover the mark had no job and the collapse
    // toggle was hidden, so hover was the only way back — an affordance you
    // cannot see. Collapse is explicit now, so the mark has to carry it.
    const shut = markup(React.createElement(Rail, { ...railProps, collapsed: true }));
    const open = markup(React.createElement(Rail, { ...railProps, collapsed: false }));
    expect(shut).toContain('aria-label="Expand sidebar"');
    expect(open).not.toContain('aria-label="Expand sidebar"');
    expect(open).toContain('aria-label="Hanzo"');
  });

  it('announces which state the toggle will leave', () => {
    const shut = markup(React.createElement(Rail, { ...railProps, collapsed: true }));
    const open = markup(React.createElement(Rail, { ...railProps, collapsed: false }));
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).toContain('aria-label="Expand sidebar"');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-label="Collapse sidebar"');
  });
});
