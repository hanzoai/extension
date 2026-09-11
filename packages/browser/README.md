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

Safari needs the Xcode wrapper around `src/safari`; this README does not cover
it.

## Let an agent drive the browser

The extension opens no port. It calls `connectNative("ai.hanzo.zap")`, the
browser starts `zapd` as that native-messaging host, and zapd registers the
extension on the local router socket `~/.zap/run/zapd.sock` as a provider named
`browser:<engine>/<host>/default`. An agent reaches the browser through that
router.

Install zapd and its host manifests once:

```bash
curl -fsSL https://raw.githubusercontent.com/zap-proto/zapd/main/install.sh | sh
zapd install-host --brand hanzo
```

`install-host` writes `ai.hanzo.zap.json` into the `NativeMessagingHosts`
directory of each installed Chrome-family browser, allowing
`chrome-extension://biingenefmanpecedoafkfajbnlgdmbl/`, and of Firefox, allowing
`hanzo-ai@hanzo.ai`. The router itself starts on demand.

The agent side is the Python MCP server with the browser tools, on Python 3.12
or newer:

```bash
pip install hanzo-mcp hanzo-tools-browser 'mcp<2'
claude mcp add hanzo-browser -- hanzo-mcp
```

`mcp<2` is required: `hanzo-tools-browser` 0.5.11 imports `FastMCP` from
`mcp.server`, which mcp 2 removed. The first start loaded its tool packages for
two to three minutes here, past Claude Code's 30-second connection check; after
that, a start connected in about 12 seconds.

The server offers `browser`, whose actions include `navigate`, `click`, `fill`,
`url` and `title`, and `cdp`, which sends a DevTools Protocol method by name.
Both route through zapd to the extension. To see whether zapd lists the browser:

```bash
python -c 'from hanzo_tools.browser.zapd_consumer import get_consumer; print([p["id"] for p in get_consumer().list_providers()])'
```

With the extension loaded in Firefox it printed `['browser:firefox/ra/default']`.

## Test

```bash
cd packages/browser
npx vitest run
```
