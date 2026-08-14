# Hanzo AI for JupyterLab

`@hanzo/jupyter` — an in-notebook AI assistant for **JupyterLab 4**. AI where data
scientists live.

- **Assistant side panel** — a model picker, a prompt, and streaming output. It
  can attach the **active cell**, the **selected cells**, or the **whole
  notebook** as context.
- **Cell actions** (command palette, cell context menu, and cell toolbar):
  - **Explain this cell** — plain-language walkthrough of a code cell.
  - **Fix / debug** — reads the cell *and its error traceback*, inserts a
    corrected cell below.
  - **Add docstring / comments** — documents the code in place.
  - **Optimize** — vectorizes / cleans up without changing behavior.
  - **Generate a cell from a prompt** — describe what you want, get a new cell.
- Reads **cell outputs** (especially tracebacks) for the fix action, and inserts
  AI-generated code as a new cell below the active one.

Model calls route through the **Hanzo AI gateway** (`api.hanzo.ai`, `/v1/...`)
via the published headless client [`@hanzo/ai`](https://www.npmjs.com/package/@hanzo/ai) —
no bespoke HTTP. Your Hanzo `sk-` key is set in JupyterLab settings, never in
source.

## Architecture

The JupyterLab widget layer is kept thin; the model-facing logic is pure and
unit-tested.

| File | Responsibility |
| --- | --- |
| `src/index.ts` | The JupyterLab plugin — the imperative shell. Registers the panel, the five commands, the cell toolbar button + context menu, tracks the active notebook, and adapts live cells into the pure data shapes. |
| `src/panel.tsx` | The side-panel `ReactWidget` (model picker + prompt + streaming output over `@hanzo/ai`). |
| `src/notebook.ts` | **Pure.** Cell / notebook → context text, error-output & traceback extraction, ANSI stripping, truncation, fence stripping. |
| `src/hanzo.ts` | Thin over `@hanzo/ai` + the **pure** action catalog: system frame, per-action prompt builders, request shaping, and the two async model edges (`runAction`, `streamChat`). |
| `src/config.ts` | Settings resolution + command/plugin ids. |
| `schema/plugin.json` | The settings-registry schema (API key, default model, gateway base URL). |

## Requirements

- JupyterLab **>= 4.0**
- Node **>= 18** and `jlpm` (the JupyterLab-pinned Yarn, shipped with JupyterLab)
- A Hanzo `sk-` API key (from <https://hanzo.ai>) for authenticated models; the
  gateway also serves public/limited models anonymously.

## Build

```bash
# from the repo root, install workspace deps
pnpm install

cd packages/jupyter

# compile TypeScript → lib/ and build the federated labextension bundle
jlpm build          # dev build
jlpm build:prod     # minified production build
```

`jlpm build` runs `build:lib` (`tsc`) then `build:labextension` (`jupyter
labextension build .`), emitting the federated bundle under
`hanzo_jupyter/labextension`.

## Install (development)

```bash
# from packages/jupyter — installs the Python package and links the source
# extension so a rebuild is picked up on JupyterLab reload
pip install -e .
jupyter labextension develop . --overwrite
jlpm build

jupyter labextension list   # should show @hanzo/jupyter … enabled OK
jupyter lab
```

For a normal install from a built wheel:

```bash
pip install .
jupyter lab
```

## Settings — your Hanzo key

Open **Settings → Settings Editor → Hanzo AI** (or edit Advanced Settings JSON):

```json
{
  "apiKey": "sk-…",
  "model": "zen5",
  "baseUrl": "https://api.hanzo.ai"
}
```

- **`apiKey`** — your Hanzo `sk-` key. Sent as a Bearer token to `api.hanzo.ai`.
  Leave blank to use the gateway's public models. Stored by the JupyterLab
  settings registry, never committed to source.
- **`model`** — the default model id for cell actions and the panel. Any id from
  `/v1/models` (the panel's picker lists them live). Defaults to a Zen model.
- **`baseUrl`** — override only for a self-hosted gateway.

## Usage

- **Panel** — click the Hanzo tab in the right sidebar. Pick a model and a
  context mode, type a prompt, `Send` (or ⌘/Ctrl+Enter). Output streams in.
- **Cell actions** — right-click a code cell, use the cell toolbar, or the
  command palette ("Hanzo AI"). Fix/document/optimize/generate insert a new cell
  below; explain inserts a markdown note.

## Test / typecheck

```bash
jlpm test        # vitest — pure logic (notebook.ts, hanzo.ts, config.ts)
jlpm typecheck   # tsc --noEmit
```

The JupyterLab widget APIs are integration-tested by running JupyterLab; the
unit tests cover the pure core: context assembly & truncation, traceback
extraction, the action-catalog prompt builders, and `@hanzo/ai` request shaping
(with a mocked client).

## Publish

- **npm** (the source package): `npm publish` (`publishConfig.access` is
  `public`).
- **PyPI** (the prebuilt extension end users `pip install`):

  ```bash
  jlpm build:prod
  pip install build twine
  python -m build              # sdist + wheel with the bundled labextension
  twine upload dist/*
  ```

## License

MIT
