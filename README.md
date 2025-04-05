# Hanzo AI

Hanzo AI transforms your IDE into a full blown software engineering ninja.

Hanzo seamlessly manages context, tracks changes, and organizes knowledge across your codebase through advanced AI capabilities including vector search, symbolic search, and extended "thinking" processes.

## Features

- **Intelligent Context Management**: Automatically maintains project context across sessions
- **Vector Search**: Find relevant code and documentation using semantic similarity
- **Symbolic Search**: Discover code elements through structure and relationships
- **Extended Thinking**: Leverage advanced reasoning for complex development tasks
- **MCP Server Integration**: Connect to Meta Model Control Protocol servers for enhanced capabilities
- **Automatic Documentation**: Generate comprehensive documentation from existing code
- **Project Analysis**: Create detailed SPEC.md files through codebase analysis

## Usage

1. Open any project in VS Code
2. Run `Hanzo: Open Project Manager` from the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. The project dashboard will appear showing your project overview
4. Enter additional project details if needed
5. Click "Analyze Project" to generate specifications

The extension will:
- Analyze your codebase structure and dependencies
- Generate a comprehensive SPEC.md file
- Create/update .cursorrules with project context
- Build knowledge graphs for enhanced navigation

## Advanced Features

- **Knowledge Management**: Track changes and maintain history across your development lifecycle
- **Rules-Based Assistance**: Define custom rules for code generation and recommendations
- **Integration with LLMs**: Connect with various large language models for diverse capabilities

## Debugging

If you encounter "request too long" errors, create a `.hanzoignore` file in your project root using `.gitignore` format:

```
staticfiles/
media/
large-binary.exe
```

### Large Projects

Hanzo automatically chunks file data when processing:
- Projects >10MB are split into multiple processing chunks
- Each chunk is processed separately then combined
- Progress displays in the VS Code notification area

For persistent size issues:
1. Exclude more directories in `.hanzoignore`
2. Remove large binaries or media files
3. Focus analysis on core source directories

## Installation

Install from VS Code Marketplace:
1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install namanyayg.hanzo`

## Requirements

- VS Code 1.85.0+
- Internet connection for AI capabilities

## Extension Settings

Hanzo works immediately without configuration. Access additional settings via:
- VS Code settings (`Ctrl+,` / `Cmd+,`)
- Hanzo configuration panel in the extension sidebar

## Known Issues & Limitations

- Large projects may require longer analysis time
- Some file types excluded from analysis (binaries, media)
- Performance may vary based on project complexity

## License

Licensed under MIT License. See LICENSE file for details.
