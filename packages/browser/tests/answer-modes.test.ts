// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from '@hanzo/ui/gui-config';
import { AnswerEngine } from '../src/answer/AnswerEngine.js';
import { MODES, SOURCES } from '../src/answer/modes.js';

/**
 * The answer surface offers FOUR modes: Chat, Search, News, Research.
 *
 * There was a fifth, Deep. It was research with the dials up — same system
 * prompt, same models, same plan gate, only wider bounds (6/16/6 at 10c vs
 * 4/12/4 at 5c) — so the tab offered a choice that was really an intensity and
 * hid a 2x price behind an adjective. Cloud collapsed the two into one research
 * mode (hanzoai/cloud apps/answer/mode.go); this is the client half of that.
 *
 * The composer draws them: the sources as chips and the mode and the model as
 * words, all in the one line UNDER its frame, and nothing of this surface's
 * inside it. Rendered, not read, and selected by the composer's own `data-slot`
 * contract, never by class names, which belong to the design system.
 */

const draw = () =>
  renderToStaticMarkup(
    React.createElement(
      GuiProvider,
      { config: guiConfig, defaultTheme: 'dark' },
      React.createElement(AnswerEngine, { apiBase: 'https://api.hanzo.ai', getToken: async () => null, signIn: () => {} }),
    ),
  );

/** The markup between the first element carrying `data-slot="<name>"` and its close. */
function part(html: string, name: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector(`[data-slot="${name}"]`)?.outerHTML ?? '';
}

describe('answer modes', () => {
  it('names four, in escalating effort, each with the line its list shows', () => {
    expect(MODES.map((m) => m.id)).toEqual(['chat', 'search', 'news', 'research']);
    for (const m of MODES) expect(m.note, m.id).not.toBe('');
  });

  it('leaves no path back to the retired mode', () => {
    expect(JSON.stringify(MODES)).not.toMatch(/deep/i);
  });

  it('draws the sources, the model and the mode under the frame, and none of them in it', () => {
    const html = draw();
    const frame = part(html, 'composer');
    const foot = part(html, 'composer-foot');
    expect(frame).not.toBe('');
    expect(foot).not.toBe('');

    // Search is the default, so the six sources are offered, as words.
    const chips = [...foot.matchAll(/data-slot="composer-chip"[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ''),
    );
    expect(chips).toEqual(SOURCES.map((s) => `@${s}`));
    expect(foot).toContain('data-slot="mode"');
    expect(foot).toContain('data-slot="model-picker"');
    expect(foot).toMatch(/data-slot="mode"[\s\S]*Search/);

    for (const slot of ['composer-chip', 'mode', 'model-picker']) expect(frame, slot).not.toContain(`data-slot="${slot}"`);
  });
});
