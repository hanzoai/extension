# Publishing Hanzo Extensions

This document describes how to publish Hanzo extensions to various marketplaces.

## Required Secrets

Add these secrets to your GitHub repository settings:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `VSCE_PAT` | VS Code Marketplace token | [Create PAT](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token) |
| `OVSX_PAT` | Open VSX Registry token | [Create token](https://open-vsx.org/user-settings/tokens) |
| `NPM_TOKEN` | npm publish token | `npm token create` or [npm.js tokens](https://www.npmjs.com/settings/~/tokens) |
| `JETBRAINS_TOKEN` | JetBrains Marketplace token | [Generate token](https://plugins.jetbrains.com/author/me/tokens) |
| `CERTIFICATE_CHAIN` | JetBrains plugin signing cert | [Plugin signing](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html) |
| `PRIVATE_KEY` | JetBrains plugin signing key | See above |
| `PRIVATE_KEY_PASSWORD` | JetBrains key password | See above |

## Publishing Methods

### Automatic (GitHub Actions)

1. Create a GitHub release with a version tag (e.g., `v1.6.0`)
2. The `publish.yml` workflow will automatically publish to all marketplaces

Or manually trigger:
```bash
gh workflow run publish.yml
```

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
