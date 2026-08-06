import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from '@hanzo/ui/gui-config';
import { AnswerEngine } from '../src/answer/AnswerEngine.js';
import { Rail } from '../src/answer/Rail.js';

/**
 * A new tab is a place to ask, so the answer surface opens collapsed: the
 * composer gets the width and the rail expands only when asked for. Rendered,
 * not read — the collapsed class is what actually lays the page out.
 */

function markup(el: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(GuiProvider, { config: guiConfig, defaultTheme: 'dark' }, el),
  );
}

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

  it('drops its labels when collapsed and shows them when open', () => {
    const props = { toggle: () => {}, newThread: () => {}, signIn: () => {} };
    const open = markup(React.createElement(Rail, { ...props, collapsed: false }));
    const shut = markup(React.createElement(Rail, { ...props, collapsed: true }));
    expect(open).toContain('New thread');
    expect(shut).not.toContain('New thread');
  });
});
