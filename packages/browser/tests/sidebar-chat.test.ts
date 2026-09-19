// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GuiProvider } from '@hanzo/gui';
import guiConfig from '@hanzo/ui/gui-config';
import { Chat, type ChatProps } from '../src/Chat.js';

/**
 * The sidebar's chat, mounted with the props `sidebar.ts` hands it.
 *
 * The draft lives in Chat, not in the sidebar. When the sidebar stopped
 * passing one and Chat still read it from props, the controlled Composer got
 * `undefined`, threw on `value.trim()` during the first render, and every
 * signed-in sidebar was blank. Nothing type-checks sidebar.ts, so this mounts
 * the real component the way the sidebar does.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What sidebar.ts's paint() passes, less the callbacks a test replaces. */
const sidebar = (over: Partial<ChatProps> = {}): ChatProps => ({
  turns: [],
  onSend: () => {},
  onStop: () => {},
  onRetry: () => {},
  busy: false,
  models: [{ id: 'auto', label: 'Auto', family: 'Router', description: 'Routes to the best model', modality: 'chat' }],
  model: 'auto',
  onModel: () => {},
  rag: true,
  onRag: () => {},
  tab: true,
  onTab: () => {},
  status: 'Ready',
  signedIn: true,
  onSignIn: () => {},
  onSignUp: () => {},
  ...over,
});

let root: Root | undefined;

function mount(props: ChatProps): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      React.createElement(GuiProvider, { config: guiConfig, defaultTheme: 'dark' }, React.createElement(Chat, props)),
    );
  });
  return host;
}

/** Type the way a person does: React reads a field's value off its input event. */
function type(field: HTMLTextAreaElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe('the sidebar chat', () => {
  it('draws the composer for a signed-in user', () => {
    const host = mount(sidebar());
    expect(host.querySelector('[data-slot="composer"]')).not.toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('[data-slot="composer-field"]')!.value).toBe('');
  });

  it('hands the trimmed draft to onSend and empties the box', () => {
    const onSend = vi.fn();
    const host = mount(sidebar({ onSend }));
    const field = host.querySelector<HTMLTextAreaElement>('[data-slot="composer-field"]')!;

    type(field, '  Say pong.  ');
    expect(field.value).toBe('  Say pong.  ');
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Say pong.');
    expect(field.value).toBe('');
  });
});
