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
 * screen, and the labels are always in the markup and hidden in CSS. That is
 * load-bearing rather than stylistic — the rail opens on hover, which is a CSS
 * state, so markup branched on `collapsed` in JS could never be revealed by
 * hovering and the rail would widen to show nothing.
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
    // ...and the labels are present for CSS to reveal on hover.
    expect(shut).toContain('New thread');
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
