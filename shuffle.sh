
    #!/usr/bin/env bash
    set -e

    # 1. Create pnpm workspace config
    apply_patch << 'EOF'
    *** Begin Patch
    *** Update File: package.json
    @@
    -  "private": false,
    +  "private": true,
    @@
    -  "engines": {
    +  "packageManager": "pnpm@10.12.4",
    +  "workspaces": ["pkg/*","app/*"],
    +  "engines": {
    *** End Patch
    EOF

    apply_patch << 'EOF'
    *** Begin Patch
    *** Add File: pnpm-workspace.yaml
    +packages:
    +  - 'pkg/*'
    +  - 'app/*'
    *** End Patch
    EOF

    # 2. Move existing packages
    mkdir -p pkg/mcp app/dev
    mv packages/mcp pkg/mcp
    mv packages/dev app/dev

    # 3. Hoist VSCode extension
    mkdir -p pkg/vscode/{src,out,test,integration-tests}
    mv src pkg/vscode/src
    mv out pkg/vscode/out
    mv test pkg/vscode/test
    mv integration-tests pkg/vscode/integration-tests
    mv package.json tsconfig*.json pkg/vscode/

    # 4. Browser extension
    mkdir -p pkg/browser
    mv src/browser-extension pkg/browser/src
    mv src/browser-extension/package.json pkg/browser/

    # 5. CLI‑tools
    mkdir -p pkg/tools
    mv src/cli-tools pkg/tools/src
    # create pkg/tools/package.json, tsconfig.json accordingly

    # 6. JetBrains plugin
    mkdir -p pkg/jetbrains
    mv jetbrains-plugin pkg/jetbrains/jetbrains-plugin

    # 7. DXT bundle
    mkdir -p pkg/dxt
    mv dxt pkg/dxt/dxt

    # 8. Website
    mkdir -p app/site
    mv site app/site/site

    # 9. Clean up old now‑empty dirs
    rm -rf src out test integration-tests packages browser-extension cli-tools jetbrains-plugin dxt site

    # 10. Install & build/test all
    pnpm install
    pnpm -r build
    pnpm -r test

    # 11. Stage everything
    git add -A
    git commit -m "Monorepo: pkg/app restructure into pnpm workspace"
