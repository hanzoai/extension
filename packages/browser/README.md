# @hanzo/browser-extension

The Hanzo AI browser extension for Chrome, Firefox and Safari. It replaces the
new tab page, adds a popup, and registers the browser with the local zapd router
so an agent can drive it.

## Build

From the repository root. The root `package.json` pins pnpm 11.24.0, which
`corepack enable` provides.

```bash
pnpm install
cd packages/browser
node src/build.js
```

The build writes `dist/chrome`, `dist/firefox` and `dist/safari` at the
repository root.

## Load it

Chrome: open `chrome://extensions`, turn on Developer mode, choose Load unpacked
and select `dist/chrome`. The manifest carries a fixed `key`, so the extension id
is `biingenefmanpecedoafkfajbnlgdmbl` wherever it is loaded.

Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary
Add-on and select `dist/firefox/manifest.json`. The id is `hanzo-ai@hanzo.ai`,
and the manifest requires Firefox 109 or newer.

Safari is built from `dist/chrome` by Xcode's `safari-web-extension-converter`
(`make build` runs it on macOS); this README does not cover signing it.

## Let an agent drive the browser

The extension connects out to this computer's ZAP router: a WebSocket to
`127.0.0.1:<port>`, where the port is `20000 + uid mod 10000`. There is no
helper binary, no native-messaging manifest and no daemon — the router is
embedded in hanzo-mcp (and the dev CLI, the desktop app and the IDE), and
whichever of them runs first serves it. The extension registers as
`browser/<host>/<engine>-<id>`.

Pair once per browser. On the same computer:

```bash
hanzo-mcp pair        # prints ws://127.0.0.1:<port>/#<token>
```

Paste that code into the extension popup's **Pair** box. The router admits the
extension only from its own extension origin and only after both sides prove
the token (the router first); a web page can reach neither. `hanzo-mcp pair
--reset` issues a new token and every browser pairs again.

The agent side is the Python MCP server with the browser tools, on Python 3.12
or newer:

```bash
pip install hanzo-mcp 'mcp<2'
claude mcp add hanzo -- hanzo-mcp
```

`mcp<2` is required: `hanzo-tools-browser` imports `FastMCP` from `mcp.server`,
which mcp 2 removed.

The server offers `browser`, whose actions include `navigate`, `click`, `fill`,
`url` and `title`, and `cdp`, which sends a DevTools Protocol method by name.
Both route through the router to the extension. `zapd ls` (from
`npm i -g @zap-proto/zapd`) lists every node on the router, the browser
included.

## Drive a page: snapshot, then refs

An agent sees a page as its accessibility tree, with a ref on every node it can
act on, and acts by ref:

```
browser(action="snapshot", interactive=true)
  - textbox "Email" [ref=e3]
  - button "Subscribe" [ref=e4]
browser(action="fill", selector="@e3", text="me@example.com")
browser(action="click", selector="@e4")
browser(action="read")                     the page as markdown
```

- A ref names one element while it stays on the page, across snapshots. Once
  the element is gone, or the tab has navigated, the ref is refused: snapshot
  again.
- A click is refused before any event fires when another element covers the
  target, a consent banner or a modal, and the error names the cover.
- `screenshot annotate=true` boxes every on-screen ref, labelled `[N]` for ref
  `@eN`, and returns the legend.
- `browser(action="help")` lists everything past the core actions.

The page half is `page.js`, which `src/shared/drive.ts` injects into the tab's
isolated world on first use, so Chrome, Firefox and Safari run the same code
with no debugger attached. An extension page drives a tab the same way:

```js
chrome.runtime.sendMessage({ action: 'drive', method: 'hanzo.snapshot', params: { tabId, interactive: true } })
```

## Test

```bash
cd packages/browser
npx vitest run
npx playwright test --config=e2e/playwright.config.ts e2e/snapshot-ref.spec.ts
```
