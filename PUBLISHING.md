# Publishing Hanzo Extensions

Publishing is NATIVE: it runs on Hanzo Git (`git.hanzo.ai`) act_runners, and
every store credential lives in Hanzo KMS. GitHub only mirrors the repo.

## Topology (one way)

- **Git of record:** `git.hanzo.ai/hanzoai/extension`. GitHub is a public
  mirror; `.github/workflows/sync.yml` pushes `main` + tags to Hanzo Git.
- **CI/CD:** `.gitea/workflows/*` on `hanzo-build-linux-amd64` act_runners —
  `ci.yml` (test + build) and `publish.yml` (Chrome Web Store + Firefox AMO + npm).
- **Secrets — KMS ONLY.** The native pipeline logs in with the KMS machine
  identity (`KMS_CLIENT_ID` / `KMS_CLIENT_SECRET`) and pulls store creds from
  org `hanzo`, env `prod`, path `/extension-publish`
  (see `deploy/kms/extension-publish-kms-sync.yaml`). No store credential is
  ever a GitHub or Gitea Actions secret.
- **amd64/Linux publishes natively.** Safari (macOS) + desktop (Windows) stay on
  GitHub-hosted runners until native macOS/Windows act_runners are green
  (`universe/docs/architecture/runners-act-migration.md`).

## KMS keys the operator seeds (path `hanzo:/extension-publish`, env `prod`)

| Key(s) | Store |
|--------|-------|
| `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | Chrome Web Store |
| `AMO_API_KEY`, `AMO_API_SECRET` | Firefox Add-ons |
| `NPM_TOKEN` | npm (`@hanzo/*`) |

## Publishing Methods

### Automatic (native)

Push a `vX.Y.Z` tag. GitHub mirrors it to Hanzo Git, which fires
`.gitea/workflows/publish.yml`. Or run `workflow_dispatch` on Hanzo Git.

```bash
# version lives in packages/browser/package.json (patch only, never major)
git tag v1.9.35 && git push origin v1.9.35
```

> Interim: the live npm publish still also runs from `.github/workflows/publish.yml`
> until the KMS `NPM_TOKEN` is seeded and one native `publish.yml` run is verified
> green; then the GitHub npm job is deleted. `pnpm publish` skips versions already
> on npm, so the overlap is idempotent.

### Manual Publishing

#### VS Code Marketplace

```bash
cd packages/vscode
pnpm install
pnpm run compile
vsce package --no-dependencies
vsce publish -p YOUR_TOKEN
```

#### Open VSX Registry

```bash
cd packages/vscode
ovsx publish *.vsix -p YOUR_TOKEN
```

#### npm (@hanzo/mcp)

```bash
cd packages/mcp
npm run build
npm publish --access public
```

#### JetBrains Marketplace

```bash
cd packages/jetbrains
./gradlew publishPlugin
# Requires PUBLISH_TOKEN environment variable
```

#### Chrome Web Store

1. Build: `cd packages/browser && pnpm run build`
2. Package: `zip -r extension.zip dist/ src/manifest.json src/*.html src/*.css`
3. Upload at [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)

#### Firefox Add-ons

1. Build: `cd packages/browser && pnpm run build`
2. Package: `zip -r extension.zip dist/ src/manifest.json src/*.html src/*.css`
3. Upload at [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/)

## Version Management

All packages use the same version from the root `package.json`:

```bash
# Bump version
npm version patch  # or minor, major
git push --tags
```

## Marketplace Links

- [VS Code Marketplace](https://marketplace.visualstudio.com/publishers/hanzo-ai)
- [Open VSX Registry](https://open-vsx.org/namespace/hanzo-ai)
- [npm @hanzo](https://www.npmjs.com/org/hanzo)
- [JetBrains Marketplace](https://plugins.jetbrains.com/vendor/hanzo-ai)
- [Chrome Web Store](https://chrome.google.com/webstore/developer/dashboard)
- [Firefox Add-ons](https://addons.mozilla.org/developers/)

## First-Time Setup

### VS Code Marketplace Publisher

1. Create Azure DevOps organization at [dev.azure.com](https://dev.azure.com)
2. Create publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
3. Publisher ID: `hanzo-ai`

### JetBrains Marketplace Vendor

1. Register at [plugins.jetbrains.com](https://plugins.jetbrains.com)
2. Create vendor: `hanzo-ai`
3. Configure plugin signing (required for paid plugins)

### Chrome Web Store Developer

1. Register at [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Pay one-time $5 developer fee
3. Verify identity

### Firefox Developer

1. Register at [Firefox Add-ons](https://addons.mozilla.org/developers/)
2. Complete developer agreement
