# IDE Support Roadmap for Hanzo AI

## Currently Supported
- ✅ **VS Code** (current extension)
- ✅ **Cursor** (VS Code compatible)
- ✅ **Windsurf** (VS Code compatible)
- ✅ **Claude Code** (via .dxt file)
- ✅ **Terminal/Neovim** (via npx @hanzo/mcp)
- ✅ **JetBrains IDEs** (IntelliJ, PyCharm, WebStorm, GoLand, etc.) - Plugin available!

## Top Priority IDEs for Support

### 1. **JetBrains IDEs** (IntelliJ Platform)
- **IntelliJ IDEA** - Java/Kotlin developers
- **WebStorm** - JavaScript/TypeScript
- **PyCharm** - Python developers
- **GoLand** - Go developers
- **Rider** - .NET developers
- **PhpStorm** - PHP developers
- **RubyMine** - Ruby developers
- **CLion** - C/C++ developers
- **DataSpell** - Data scientists

**Why**: JetBrains has 15+ million users across all IDEs. Single plugin can support all.

### 2. **Neovim/Vim**
- Native LSP support
- Huge power-user community
- Can leverage existing MCP implementation

**Why**: 2+ million active users, highly technical audience perfect for Hanzo AI.

### 3. **Sublime Text**
- Fast, lightweight editor
- Popular with web developers
- Python-based plugin system

**Why**: 1+ million active users, easy to implement.

### 4. **Emacs**
- Highly extensible
- Strong in academic/research
- Elisp package system

**Why**: 500k+ users, influential in AI/ML research community.

### 5. **Xcode**
- iOS/macOS development
- Swift/Objective-C
- Apple ecosystem

**Why**: 5+ million iOS developers, high-value market.

### 6. **Visual Studio** (full IDE)
- Enterprise .NET development
- C++/C# focus
- Windows development

**Why**: 4+ million enterprise developers.

### 7. **Android Studio**
- Android development
- Based on IntelliJ
- Kotlin/Java focus

**Why**: 6+ million Android developers.

### 8. **Zed**
- New high-performance editor
- Built for collaboration
- Growing rapidly

**Why**: Fast-growing, AI-friendly community.

## Web-Based IDEs

### 9. **GitHub Codespaces**
- Cloud development
- VS Code based
- GitHub integration

### 10. **GitPod**
- Cloud development environments
- Open source friendly
- Docker-based

### 11. **Replit**
- Browser-based IDE
- Education focus
- Built-in AI features

### 12. **CodeSandbox**
- Web development focus
- React/Vue/Angular
- Instant environments

## Implementation Strategy

### Phase 1: JetBrains Platform (✅ COMPLETED)
- Single plugin for all JetBrains IDEs
- Estimated 15M+ potential users
- Java/Kotlin implementation
- **Status**: Plugin built and ready for distribution
- **Features**: 200+ models, MCP support, symbol search, chat interface

### Phase 2: Terminal Editors (Q1-Q2)
- Neovim LSP integration
- Vim plugin
- Emacs package
- Combined 3M+ users

### Phase 3: Native IDEs (Q2-Q3)
- Xcode extension
- Visual Studio extension
- Android Studio (via JetBrains base)
- Combined 15M+ users

### Phase 4: Modern Editors (Q3)
- Sublime Text package
- Zed extension
- Nova extension
- Combined 2M+ users

### Phase 5: Cloud IDEs (Q4)
- GitHub Codespaces app
- GitPod extension
- Replit integration
- CodeSandbox plugin

## Technical Considerations

### Shared Core
- Extract MCP client to language-agnostic library
- REST API for IDE integrations
- WebSocket for real-time features
- CLI tool as fallback

### Language Bindings
- TypeScript/JavaScript (current)
- Java/Kotlin (JetBrains)
- Python (Sublime, vim)
- Swift (Xcode)
- C# (Visual Studio)
- Elisp (Emacs)
- Lua (Neovim)

### Distribution Channels
- JetBrains Marketplace
- VS Code Marketplace
- Package managers (npm, pip, brew)
- Direct downloads
- Plugin registries

## Market Impact

Total addressable market: 50M+ developers across all IDEs

Priority based on:
1. User base size
2. Technical audience fit
3. Implementation effort
4. Strategic value

JetBrains alone would add 15M+ potential users with a single plugin.