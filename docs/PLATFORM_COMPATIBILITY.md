# Platform Compatibility Guide

## VS Code vs Cursor vs Windsurf

### Short Answer: NO, we don't need different builds! 🎉

The same `.vsix` extension package works across all three platforms because:

1. **Cursor** is a fork of VS Code that maintains 100% API compatibility
2. **Windsurf** is also VS Code-based with full extension compatibility
3. All three use the same extension manifest format and APIs

### Single Build, Multiple Platforms

```bash
# Build once
npm run package

# Install the same .vsix file in any editor:
# - VS Code: Extensions > Install from VSIX
# - Cursor: Extensions > Install from VSIX  
# - Windsurf: Extensions > Install from VSIX
```

### Platform Detection (if needed)

While not necessary, you can detect which editor is running:

```typescript
// In extension code
const appName = vscode.env.appName;
// Returns: "Visual Studio Code" | "Cursor" | "Windsurf"

const appHost = vscode.env.appHost;
// Returns: "desktop" | "web" | "codespaces"
```

### Claude Desktop Integration

Claude Desktop requires a separate MCP server build, but this is already handled:

```bash
# VS Code/Cursor/Windsurf extension
npm run package          # Creates hanzoai-1.5.4.vsix

# Claude Desktop MCP server
npm run build:mcp        # Creates out/mcp-server-standalone.js
```

### Installation Summary

| Platform | Installation Method | File |
|----------|-------------------|------|
| VS Code | Install from VSIX | `hanzoai-1.5.4.vsix` |
| Cursor | Install from VSIX | `hanzoai-1.5.4.vsix` |
| Windsurf | Install from VSIX | `hanzoai-1.5.4.vsix` |
| Claude Desktop | MCP Config | `out/mcp-server-standalone.js` |

### Benefits of Unified Build

1. **Maintenance**: Single codebase to maintain
2. **Testing**: Test once, run everywhere
3. **Distribution**: One package for all VS Code-based editors
4. **Updates**: Users get same features regardless of editor

### Edge Cases

The only platform-specific considerations are:

1. **Keybindings**: Some editors may have different default keybindings
2. **Theme**: UI might look slightly different based on editor theme
3. **Settings**: Editor-specific settings namespace (but our extension uses `hanzo.*`)

### Verification

To verify compatibility:

```bash
# 1. Build extension
npm run package

# 2. Test in each editor
code --install-extension hanzoai-1.5.4.vsix
cursor --install-extension hanzoai-1.5.4.vsix
windsurf --install-extension hanzoai-1.5.4.vsix

# 3. All should work identically!
```

## Conclusion

Our unified build approach is the recommended best practice. The VS Code extension API was designed for this compatibility, and forks like Cursor and Windsurf maintain this compatibility intentionally.