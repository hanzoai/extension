import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

interface SearchResult {
    type: 'grep' | 'symbol' | 'git' | 'filename' | 'ast';
    file?: string;
    line?: number;
    column?: number;
    match: string;
    context?: string;
    score?: number;
}

export function createUnifiedSearchTool(context: vscode.ExtensionContext): MCPTool {
    async function searchGrep(query: string, root: string | undefined, filePattern?: string): Promise<SearchResult[]> {
        if (!root) {return [];}
        try {
            // rg is always given the directory. Given none, it reads stdin when
            // stdin is a pipe, and its stdin here is a pipe that never closes.
            const glob = filePattern ? ['--glob', filePattern] : [];
            const { stdout } = await execFileAsync(
                'rg', ['--json', '--max-count', '50', ...glob, '--', query, root],
                { maxBuffer: 10 * 1024 * 1024 }
            );
            
            const results: SearchResult[] = [];
            const lines = stdout.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.type === 'match') {
                        const match = data.data;
                        results.push({
                            type: 'grep',
                            file: match.path.text,
                            line: match.line_number,
                            match: match.lines.text.trim(),
                            context: match.lines.text
                        });
                    }
                } catch {
                    // Skip invalid JSON lines
                }
            }
            
            return results;
        } catch (error) {
            console.error('Grep search error:', error);
            return [];
        }
    }

    async function searchSymbols(query: string, dir: string | undefined): Promise<SearchResult[]> {
        try {
            // Use VS Code's symbol search
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                query
            );
            
            if (!symbols) {return [];}
            
            const under = dir ? symbols.filter(s => s.location.uri.fsPath.startsWith(dir)) : symbols;
            return under.slice(0, 30).map(symbol => ({
                type: 'symbol' as const,
                file: symbol.location.uri.fsPath,
                line: symbol.location.range.start.line + 1,
                column: symbol.location.range.start.character + 1,
                match: `${symbol.name} (${vscode.SymbolKind[symbol.kind]})`,
                context: symbol.containerName
            }));
        } catch (error) {
            console.error('Symbol search error:', error);
            return [];
        }
    }

    async function searchGit(query: string, root: string | undefined): Promise<SearchResult[]> {
        if (!root) {return [];}
        try {
            // Search in git commit messages
            const { stdout: commitSearch } = await execFileAsync(
                'git', ['log', `--grep=${query}`, '--oneline', '--max-count=20'],
                { cwd: root }
            );
            
            const results: SearchResult[] = [];
            
            if (commitSearch.trim()) {
                const commits = commitSearch.split('\n').filter(line => line.trim());
                for (const commit of commits) {
                    const [hash, ...messageParts] = commit.split(' ');
                    results.push({
                        type: 'git',
                        match: `Commit: ${messageParts.join(' ')}`,
                        context: `Hash: ${hash}`
                    });
                }
            }
            
            // Search in git file history
            try {
                const { stdout: fileSearch } = await execFileAsync(
                    'git', ['log', '--all', '--full-history', '--oneline', '--max-count=10', '--', `*${query}*`],
                    { cwd: root }
                );
                
                if (fileSearch.trim()) {
                    const files = fileSearch.split('\n').filter(line => line.trim());
                    for (const file of files) {
                        results.push({
                            type: 'git',
                            match: `File history: ${file}`,
                            context: 'Git file history match'
                        });
                    }
                }
            } catch {
                // Ignore file search errors
            }
            
            return results;
        } catch (error) {
            console.error('Git search error:', error);
            return [];
        }
    }

    async function searchFilenames(query: string, dir: string | undefined): Promise<SearchResult[]> {
        try {
            const pattern = `**/*${query}*`;
            const files = await vscode.workspace.findFiles(dir ? new vscode.RelativePattern(dir, pattern) : pattern, null, 50);
            
            return files.map(file => ({
                type: 'filename' as const,
                file: file.fsPath,
                match: path.basename(file.fsPath),
                context: path.dirname(file.fsPath)
            }));
        } catch (error) {
            console.error('Filename search error:', error);
            return [];
        }
    }

    return {
        name: 'unified_search',
        description: 'Comprehensive parallel search across code, symbols, git history, and filenames',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query'
                },
                path: {
                    type: 'string',
                    description: 'Directory to search, absolute or relative to the workspace (default: the workspace)'
                },
                include: {
                    type: 'array',
                    items: { type: 'string' },
                    enum: ['grep', 'symbol', 'git', 'filename'],
                    description: 'Search types to include (default: all)'
                },
                file_pattern: {
                    type: 'string',
                    description: 'File pattern to filter results (e.g., "*.ts")'
                },
                max_results: {
                    type: 'number',
                    description: 'Maximum results per search type (default: 20)'
                }
            },
            required: ['query']
        },
        handler: async (args: {
            query: string;
            path?: string;
            include?: string[];
            file_pattern?: string;
            max_results?: number;
        }) => {
            const searchTypes = args.include || ['grep', 'symbol', 'git', 'filename'];
            const maxResults = args.max_results || 20;
            // `dir` is the path the caller gave, absolute or relative to the
            // open folder. grep and git run in it, else in the folder. With
            // neither there is no project and they search nothing: the extension
            // host's working directory is not one.
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const dir = !args.path ? undefined : path.isAbsolute(args.path) ? args.path : folder && path.join(folder, args.path);
            const root = args.path ? dir : folder;
            
            // Run all searches in parallel
            const searchPromises: Promise<SearchResult[]>[] = [];
            
            if (searchTypes.includes('grep')) {
                searchPromises.push(searchGrep(args.query, root, args.file_pattern));
            }
            if (searchTypes.includes('symbol')) {
                searchPromises.push(searchSymbols(args.query, dir));
            }
            if (searchTypes.includes('git')) {
                searchPromises.push(searchGit(args.query, root));
            }
            if (searchTypes.includes('filename')) {
                searchPromises.push(searchFilenames(args.query, dir));
            }
            
            const allResults = await Promise.all(searchPromises);
            const combinedResults = allResults.flat();
            
            // Group results by type
            const groupedResults: Record<string, SearchResult[]> = {};
            for (const result of combinedResults) {
                if (!groupedResults[result.type]) {
                    groupedResults[result.type] = [];
                }
                groupedResults[result.type].push(result);
            }
            
            // Format output
            let output = `# Unified Search Results for: "${args.query}"\n\n`;
            output += `Total results: ${combinedResults.length}\n\n`;
            
            // Grep results
            if (groupedResults.grep?.length > 0) {
                output += `## Text Matches (${groupedResults.grep.length})\n\n`;
                for (const result of groupedResults.grep.slice(0, maxResults)) {
                    output += `📄 ${result.file}:${result.line}\n`;
                    output += `   ${result.match}\n\n`;
                }
            }
            
            // Symbol results
            if (groupedResults.symbol?.length > 0) {
                output += `## Symbol Matches (${groupedResults.symbol.length})\n\n`;
                for (const result of groupedResults.symbol.slice(0, maxResults)) {
                    output += `🔍 ${result.match}\n`;
                    output += `   ${result.file}:${result.line}\n`;
                    if (result.context) {
                        output += `   Container: ${result.context}\n`;
                    }
                    output += '\n';
                }
            }
            
            // Git results
            if (groupedResults.git?.length > 0) {
                output += `## Git History Matches (${groupedResults.git.length})\n\n`;
                for (const result of groupedResults.git.slice(0, maxResults)) {
                    output += `📚 ${result.match}\n`;
                    if (result.context) {
                        output += `   ${result.context}\n`;
                    }
                    output += '\n';
                }
            }
            
            // Filename results
            if (groupedResults.filename?.length > 0) {
                output += `## Filename Matches (${groupedResults.filename.length})\n\n`;
                for (const result of groupedResults.filename.slice(0, maxResults)) {
                    output += `📁 ${result.match}\n`;
                    output += `   ${result.context}\n\n`;
                }
            }
            
            if (combinedResults.length === 0) {
                output = `No results found for "${args.query}"`;
            }
            
            return output;
        }
    };
}