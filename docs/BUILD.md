# Hanzo AI Extension Build Guide

This guide covers all build options for the Hanzo AI extension across different platforms and distribution methods.

## Prerequisites

- Node.js 16+ and npm/pnpm
- TypeScript compiler
- VS Code (for extension development)
- [Optional] @anthropic-ai/dxt CLI for DXT builds

## Build Commands

### Development Build

```bash
# Install dependencies
pnpm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch
```

### Production Builds

#### 1. VS Code Extension (.vsix)

```bash
# Build complete VS Code extension
npm run package

# This creates: hanzoai-{version}.vsix
```

#### 2. Desktop Extension (.dxt) for Claude Code

```bash
# Using custom build script
npm run build:dxt

# Or using official DXT CLI (recommended)
npm install -g @anthropic-ai/dxt
cd dxt
dxt pack

# Output: dist/hanzo-ai.dxt
```

#### 3. NPM Package for Claude Desktop

```bash
# Build for npm distribution
npm run build:claude-desktop

# Publish to npm
npm run publish:npm

# Users install with: npx @hanzo/mcp@latest
```

#### 4. MCP Server Standalone

```bash
# Build standalone MCP server
npm run build:mcp

# Creates:
# - out/mcp-server-standalone.js (original)
# - out/mcp-server-standalone-auth.js (with authentication)
# - dist/mcp-server.js (minified for distribution)
```

## Build All Distributions

```bash
# Build everything at once
npm run build:all

# This runs:
# 1. TypeScript compilation
# 2. MCP server build
# 3. Claude Desktop package
# 4. DXT extension
# 5. VS Code extension
```

## Output Files

After running `npm run build:all`, you'll have:

```
dist/
├── hanzo-ai.dxt              # Claude Code desktop extension
├── mcp-server.js             # Standalone MCP server
└── claude-desktop/           # NPM package directory
    ├── package.json
    ├── server.js
    ├── bin/install.js
    └── README.md

hanzoai-{version}.vsix        # VS Code extension
```

## Distribution Methods

### 1. VS Code Marketplace
- File: `hanzoai-{version}.vsix`
- Install: Search "Hanzo AI Context Manager" in VS Code

### 2. Claude Code (DXT)
- File: `dist/hanzo-ai.dxt`
- Install: Drag and drop into Claude Code

### 3. NPM Registry
- Package: `@hanzo/mcp`
- Install: `npx @hanzo/mcp@latest`

### 4. GitHub Releases
All build artifacts are automatically uploaded to GitHub releases

## Signing Extensions

### DXT Signing (Optional)

```bash
# Generate self-signed certificate
dxt sign --self-signed dist/hanzo-ai.dxt

# Or use existing certificate
dxt sign -c cert.pem -k key.pem dist/hanzo-ai.dxt

# Verify signature
dxt verify dist/hanzo-ai.dxt
```

### VS Code Extension Signing
VS Code extensions are signed automatically when published to the marketplace.

## Environment Variables

- `VSCODE_ENV`: Set to 'development' or 'production'
- `HANZO_WORKSPACE`: Default workspace for MCP operations
- `HANZO_ANONYMOUS`: Set to 'true' for anonymous mode
- `HANZO_IAM_ENDPOINT`: Custom IAM endpoint (default: https://iam.hanzo.ai)

## Testing Builds

### Test VS Code Extension
```bash
# Install locally
code --install-extension hanzoai-{version}.vsix
```

### Test DXT Extension
1. Open Claude Code
2. Drag `dist/hanzo-ai.dxt` into the window
3. Follow installation prompts

### Test NPM Package
```bash
# Test installation script
cd dist/claude-desktop
node bin/install.js --help
```

## Troubleshooting

### Build Failures
- Ensure all dependencies are installed: `pnpm install`
- Clean and rebuild: `rm -rf out dist && npm run build:all`
- Check TypeScript errors: `npm run compile`

### DXT Issues
- Validate manifest: `dxt validate dxt/manifest.json`
- Check file paths in manifest match actual files
- Ensure icon.png exists and is valid PNG

### NPM Publishing
- Login to npm: `npm login`
- Ensure you have publish rights to @hanzo scope
- Use OTP from authenticator when publishing

## CI/CD

GitHub Actions automatically builds all distributions on:
- Push to main branch
- Pull requests
- Release tags (v*)

See `.github/workflows/build.yml` for details.