// The JupyterLab 4 plugin. This is the ONLY module that touches the live widget
// layer: it reads settings from the registry, tracks the active notebook,
// registers the side panel + the five cell commands + the cell-toolbar button,
// and adapts live cells into the pure {@link CellData} shapes hanzo.ts/notebook.ts
// consume. Everything model-facing is delegated to those pure modules — this
// file is the imperative shell around a functional core.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import type { Cell } from '@jupyterlab/cells';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { LabIcon } from '@jupyterlab/ui-components';
import type { AiClient } from '@hanzo/ai';

import { PLUGIN_ID, CommandIds, resolveSettings, type HanzoSettings } from './config';
import { HanzoPanel, type ContextMode } from './panel';
import { createHanzoClient, runAction, type ActionId, actionReturnsCode } from './hanzo';
import {
  cellContext,
  notebookContext,
  stripFences,
  type CellData,
  type CellOutput,
  type CellType,
  type NotebookData,
} from './notebook';

// ── Live cell → pure CellData adaptation ─────────────────────────────────────

/**
 * outputToPure reduces one nbformat output (from CodeCellModel.outputs.toJSON)
 * to the pure {@link CellOutput}. Handles the four textual output kinds; binary
 * MIME (images) reduces to empty text and is dropped downstream.
 */
function outputToPure(o: {
  output_type?: string;
  text?: unknown;
  ename?: unknown;
  evalue?: unknown;
  traceback?: unknown;
  data?: Record<string, unknown>;
}): CellOutput | null {
  const joinText = (v: unknown): string =>
    Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : '';
  switch (o.output_type) {
    case 'stream':
      return { kind: 'stream', text: joinText(o.text) };
    case 'error':
      return {
        kind: 'error',
        ename: typeof o.ename === 'string' ? o.ename : undefined,
        evalue: typeof o.evalue === 'string' ? o.evalue : undefined,
        text: Array.isArray(o.traceback) ? o.traceback.join('\n') : '',
      };
    case 'execute_result':
    case 'display_data': {
      const text = joinText(o.data?.['text/plain']);
      return {
        kind: o.output_type === 'execute_result' ? 'execute_result' : 'display_data',
        text,
      };
    }
    default:
      return null;
  }
}

/** cellToPure adapts a live JupyterLab Cell into the pure {@link CellData}. */
function cellToPure(cell: Cell): CellData {
  const model = cell.model;
  const type = model.type as CellType;
  const source = model.sharedModel.getSource();
  if (type !== 'code') return { type, source };
  // CodeCellModel exposes outputs.toJSON(); guard for non-code models.
  const outModel = (model as { outputs?: { toJSON(): unknown[] } }).outputs;
  const outputs: CellOutput[] = outModel
    ? outModel
        .toJSON()
        .map((o) => outputToPure(o as Parameters<typeof outputToPure>[0]))
        .filter((o): o is CellOutput => o !== null)
    : [];
  const execCount = (model as { sharedModel: { execution_count?: number | null } })
    .sharedModel.execution_count;
  return { type, source, outputs, executionCount: execCount ?? null };
}

/** notebookToPure adapts the active NotebookPanel's cells into {@link NotebookData}. */
function notebookToPure(cells: readonly Cell[]): NotebookData {
  return { cells: cells.map(cellToPure) };
}

// ── The plugin ───────────────────────────────────────────────────────────────

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Hanzo AI for JupyterLab — an in-notebook AI assistant.',
  autoStart: true,
  requires: [INotebookTracker, ISettingRegistry],
  optional: [ICommandPalette],
  activate,
};

async function activate(
  app: JupyterFrontEnd,
  tracker: INotebookTracker,
  settingRegistry: ISettingRegistry,
  palette: ICommandPalette | null,
): Promise<void> {
  const { commands, shell } = app;

  // ── Settings: resolve now and on every change (live re-read). ──────────────
  let settings: HanzoSettings = resolveSettings({});
  let client: AiClient = createHanzoClient(settings);
  const rebuild = (raw: Record<string, unknown>): void => {
    settings = resolveSettings(raw);
    client = createHanzoClient(settings);
  };
  try {
    const loaded = await settingRegistry.load(PLUGIN_ID);
    rebuild(loaded.composite as Record<string, unknown>);
    loaded.changed.connect(() =>
      rebuild(loaded.composite as Record<string, unknown>),
    );
  } catch {
    // No registry entry (e.g. schema not yet installed) — defaults stand.
  }

  // ── Live-notebook context reader for the panel. ────────────────────────────
  const readContext = (mode: ContextMode): string => {
    const panel = tracker.currentWidget;
    if (!panel || mode === 'none') return '';
    const nb = panel.content;
    if (mode === 'notebook') return notebookContext(notebookToPure(nb.widgets));
    if (mode === 'selection') {
      const selected = nb.widgets.filter((c) => nb.isSelectedOrActive(c));
      const src = selected.length ? selected : tracker.activeCell ? [tracker.activeCell] : [];
      return notebookContext(notebookToPure(src));
    }
    // 'cell'
    return tracker.activeCell ? cellContext(cellToPure(tracker.activeCell)) : '';
  };

  // ── Side panel (right sidebar). ────────────────────────────────────────────
  const panel = new HanzoPanel({
    getSettings: () => settings,
    getClient: () => client,
    getContext: readContext,
  });
  shell.add(panel, 'right', { rank: 900 });

  // ── Cell actions. Each is: adapt active cell → run action → insert/show. ──
  const runCellAction = async (id: ActionId, detail?: string): Promise<void> => {
    const nbPanel = tracker.currentWidget;
    const active = tracker.activeCell;
    if (!nbPanel) return;
    const cell = id === 'generate' && !active ? undefined : active ? cellToPure(active) : undefined;
    const text = await runAction(id, { cell, detail }, client, settings);
    if (actionReturnsCode(id)) {
      insertCodeBelow(nbPanel.content, text);
    } else {
      // Explain → surface prose in the panel by opening it (the panel is the
      // read surface). Insert as a markdown cell so it stays with the work.
      insertMarkdownBelow(nbPanel.content, text);
    }
  };

  commands.addCommand(CommandIds.explainCell, {
    label: 'Hanzo: Explain This Cell',
    icon: hanzoActionIcon,
    isEnabled: () => tracker.activeCell?.model.type === 'code',
    execute: () => runCellAction('explain'),
  });
  commands.addCommand(CommandIds.fixCell, {
    label: 'Hanzo: Fix / Debug This Cell',
    isEnabled: () => tracker.activeCell?.model.type === 'code',
    execute: () => runCellAction('fix'),
  });
  commands.addCommand(CommandIds.documentCell, {
    label: 'Hanzo: Add Docstring / Comments',
    isEnabled: () => tracker.activeCell?.model.type === 'code',
    execute: () => runCellAction('document'),
  });
  commands.addCommand(CommandIds.optimizeCell, {
    label: 'Hanzo: Optimize This Cell',
    isEnabled: () => tracker.activeCell?.model.type === 'code',
    execute: () => runCellAction('optimize'),
  });
  commands.addCommand(CommandIds.generateCell, {
    label: 'Hanzo: Generate a Cell from a Prompt…',
    execute: async () => {
      const detail = window.prompt('Describe the cell to generate:');
      if (detail && detail.trim()) await runCellAction('generate', detail.trim());
    },
  });
  commands.addCommand(CommandIds.openPanel, {
    label: 'Hanzo: Open Assistant Panel',
    execute: () => {
      shell.activateById(panel.id);
    },
  });

  // ── Cell toolbar button + context menu. ────────────────────────────────────
  app.contextMenu.addItem({
    command: CommandIds.explainCell,
    selector: '.jp-Notebook .jp-CodeCell',
    rank: 10,
  });
  app.contextMenu.addItem({
    command: CommandIds.fixCell,
    selector: '.jp-Notebook .jp-CodeCell',
    rank: 11,
  });
  app.contextMenu.addItem({
    command: CommandIds.optimizeCell,
    selector: '.jp-Notebook .jp-CodeCell',
    rank: 12,
  });

  // ── Command palette. ───────────────────────────────────────────────────────
  if (palette) {
    for (const command of Object.values(CommandIds)) {
      palette.addItem({ command, category: 'Hanzo AI' });
    }
  }
}

// ── New-cell insertion (imperative shell edge) ───────────────────────────────

/** insertCodeBelow inserts a code cell below the active one and sets its source. */
function insertCodeBelow(notebook: import('@jupyterlab/notebook').Notebook, source: string): void {
  NotebookActions.insertBelow(notebook);
  const cell = notebook.activeCell;
  if (cell) cell.model.sharedModel.setSource(stripFences(source));
}

/** insertMarkdownBelow inserts a markdown cell below the active one. */
function insertMarkdownBelow(
  notebook: import('@jupyterlab/notebook').Notebook,
  source: string,
): void {
  NotebookActions.insertBelow(notebook);
  NotebookActions.changeCellType(notebook, 'markdown');
  const cell = notebook.activeCell;
  if (cell) cell.model.sharedModel.setSource(source.trim());
}

const hanzoActionIcon = new LabIcon({
  name: 'hanzo:action',
  svgstr:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">' +
    '<path d="M8 7v10M16 7v10M8 12h8" stroke="#C80000" stroke-width="2" fill="none" stroke-linecap="round"/>' +
    '</svg>',
});

export default plugin;
