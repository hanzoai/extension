// The side-panel assistant: a Lumino ReactWidget wrapping a React chat UI over
// @hanzo/ai. It is deliberately thin — all model shaping lives in hanzo.ts
// (pure) and all live-notebook reading in index.ts (which supplies a
// ContextProvider callback). The panel owns only UI state (prompt text, model
// list, streaming output) and calls into hanzo.ts. This keeps the untestable
// widget layer minimal and the tested logic pure.

import { ReactWidget } from '@jupyterlab/apputils';
import { LabIcon } from '@jupyterlab/ui-components';
import * as React from 'react';
import type { AiClient, Model } from '@hanzo/ai';
import { chatMessages, streamChat } from './hanzo';
import type { HanzoSettings } from './config';

/** The context modes the panel offers: what notebook content to attach. */
export type ContextMode = 'none' | 'cell' | 'selection' | 'notebook';

/**
 * A callback the plugin supplies so the panel can read the CURRENT notebook
 * without importing the notebook widget layer. Returns the assembled context
 * text for a mode, or '' when nothing applies (no active notebook/cell).
 */
export type ContextProvider = (mode: ContextMode) => string;

/** What the panel needs from its host to do its job. */
export interface PanelDeps {
  /** Current resolved settings (key/model/baseUrl). Re-read on each send so a
   * settings change takes effect without rebuilding the widget. */
  getSettings: () => HanzoSettings;
  /** Builds the @hanzo/ai client from current settings. */
  getClient: () => AiClient;
  /** Reads live notebook context for a mode. */
  getContext: ContextProvider;
}

const hanzoIcon = new LabIcon({
  name: 'hanzo:logo',
  svgstr:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">' +
    '<rect x="3" y="3" width="18" height="18" rx="4" fill="#C80000"/>' +
    '<path d="M8 7v10M16 7v10M8 12h8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '</svg>',
});

/** The React component rendered inside the panel. */
function AssistantComponent(deps: PanelDeps): JSX.Element {
  const [models, setModels] = React.useState<string[]>([]);
  const [model, setModel] = React.useState<string>(deps.getSettings().model);
  const [context, setContext] = React.useState<ContextMode>('cell');
  const [prompt, setPrompt] = React.useState('');
  const [output, setOutput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const abortRef = React.useRef<AbortController | null>(null);

  // Load the model catalog once; fall back to the configured model on failure
  // so the picker always has at least the default selectable.
  React.useEffect(() => {
    let live = true;
    deps
      .getClient()
      .models.list()
      .then((list: Model[]) => {
        if (!live) return;
        const ids = list.map((m) => m.id).filter(Boolean);
        setModels(ids.length ? ids : [deps.getSettings().model]);
      })
      .catch(() => {
        if (live) setModels([deps.getSettings().model]);
      });
    return () => {
      live = false;
    };
  }, [deps]);

  const send = React.useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setOutput('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const ctx = deps.getContext(context);
      const messages = chatMessages(text, ctx);
      const settings = { ...deps.getSettings(), model };
      for await (const delta of streamChat(
        messages,
        deps.getClient(),
        settings,
        controller.signal,
      )) {
        setOutput((prev) => prev + delta);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [prompt, busy, deps, context, model]);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  return (
    <div className="hanzo-panel">
      <div className="hanzo-panel-header">
        <hanzoIcon.react tag="span" className="hanzo-panel-logo" />
        <span className="hanzo-panel-title">Hanzo AI</span>
      </div>

      <div className="hanzo-panel-controls">
        <label className="hanzo-field">
          <span>Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="hanzo-field">
          <span>Context</span>
          <select
            value={context}
            onChange={(e) => setContext(e.target.value as ContextMode)}
            disabled={busy}
          >
            <option value="none">None</option>
            <option value="cell">Active cell</option>
            <option value="selection">Selected cells</option>
            <option value="notebook">Whole notebook</option>
          </select>
        </label>
      </div>

      <textarea
        className="hanzo-panel-prompt"
        placeholder="Ask about your notebook, or describe a cell to generate…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        rows={4}
        disabled={busy}
      />

      <div className="hanzo-panel-actions">
        {busy ? (
          <button className="hanzo-btn hanzo-btn-stop" onClick={stop}>
            Stop
          </button>
        ) : (
          <button
            className="hanzo-btn hanzo-btn-send"
            onClick={() => void send()}
            disabled={!prompt.trim()}
          >
            Send
          </button>
        )}
        <span className="hanzo-panel-hint">⌘/Ctrl+Enter</span>
      </div>

      {error ? <div className="hanzo-panel-error">{error}</div> : null}
      {output ? <pre className="hanzo-panel-output">{output}</pre> : null}
    </div>
  );
}

/**
 * HanzoPanel — the ReactWidget the plugin adds to the right sidebar. Wraps
 * {@link AssistantComponent}, giving it the Hanzo id/title/icon so JupyterLab
 * renders a proper sidebar tab.
 */
export class HanzoPanel extends ReactWidget {
  private readonly deps: PanelDeps;

  constructor(deps: PanelDeps) {
    super();
    this.deps = deps;
    this.id = 'hanzo-jupyter-panel';
    this.title.caption = 'Hanzo AI';
    this.title.icon = hanzoIcon;
    this.addClass('hanzo-panel-widget');
  }

  protected render(): JSX.Element {
    return <AssistantComponent {...this.deps} />;
  }
}
