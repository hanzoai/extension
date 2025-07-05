import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { UnifiedRxDBBackend } from '../../core/unified-rxdb-backend';
import { GraphAlgorithms } from '../../core/rxdb-graph-extension';
import { ASTIndex } from '../../core/ast-index';
import * as path from 'path';

interface SearchResult {
    type: 'file' | 'symbol' | 'git' | 'vector' | 'graph' | 'ast';
    path?: string;
    line?: number;
    column?: number;
    content: string;
    score?: number;
    metadata?: any;
}

/**
 * Enhanced unified search that uses all indexes in parallel
 * Demonstrates how RxDB indexes, graph algorithms, vector search,
 * and AST analysis work together
 */
export function createEnhancedUnifiedSearchTool(context: vscode.ExtensionContext): MCPTool {
    let backend: UnifiedRxDBBackend | null = null;
    let graphAlgorithms: GraphAlgorithms | null = null;
    let astIndex: ASTIndex | null = null;
    let isIndexing = false;
    let lastIndexTime = 0;
    
    // Initialize backend on first use
    const getBackend = async (): Promise<UnifiedRxDBBackend> => {
        if (!backend) {
            backend = new UnifiedRxDBBackend(context.globalStorageUri.fsPath);
            await backend.initialize();
            
            // Initialize graph algorithms if RxDB has graph collections
            if ((backend as any).db?.collections?.nodes && (backend as any).db?.collections?.edges) {
                graphAlgorithms = new GraphAlgorithms(
                    (backend as any).db.collections.nodes,
                    (backend as any).db.collections.edges
                );
            }
        }
        return backend;
    };
    
    // Initialize AST index
    const getASTIndex = (): ASTIndex => {
        if (!astIndex) {
            astIndex = new ASTIndex();
        }
        return astIndex;
    };
    
    return {
        name: 'unified_search_enhanced',
        description: 'Enhanced parallel search using all indexes (SQL, Vector, Graph, AST)',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query'
                },
                types: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['sql', 'vector', 'graph', 'ast', 'git', 'files']
                    },
                    description: 'Types of search to perform (default: all)'
                },
                filters: {
                    type: 'object',
                    properties: {
                        filePattern: { type: 'string' },
                        author: { type: 'string' },
                        dateRange: {
                            type: 'object',
                            properties: {
                                start: { type: 'string' },
                                end: { type: 'string' }
                            }
                        },
                        language: { type: 'string' },
                        project: { type: 'string' }
                    }
                },
                limit: {
                    type: 'number',
                    description: 'Maximum results per search type (default: 10)'
                },
                indexFirst: {
                    type: 'boolean',
                    description: 'Update indexes before searching (default: false)'
                }
            },
            required: ['query']
        },
        handler: async (args: {
            query: string;
            types?: string[];
            filters?: any;
            limit?: number;
            indexFirst?: boolean;
        }) => {
            const searchTypes = args.types || ['sql', 'vector', 'graph', 'ast', 'git', 'files'];
            const limit = args.limit || 10;
            const db = await getBackend();
            const ast = getASTIndex();
            
            // Check if we need to update indexes
            if (args.indexFirst || Date.now() - lastIndexTime > 3600000) { // 1 hour
                if (!isIndexing) {
                    isIndexing = true;
                    await updateIndexes(db, ast);
                    lastIndexTime = Date.now();
                    isIndexing = false;
                }
            }
            
            // Parallel search across all systems
            const searchPromises: Promise<SearchResult[]>[] = [];
            
            // 1. SQL Search (using RxDB indexes)
            if (searchTypes.includes('sql')) {
                searchPromises.push(performSQLSearch(db, args.query, args.filters, limit));
            }
            
            // 2. Vector Search (semantic similarity)
            if (searchTypes.includes('vector')) {
                searchPromises.push(performVectorSearch(db, args.query, args.filters, limit));
            }
            
            // 3. Graph Search (relationships and paths)
            if (searchTypes.includes('graph') && graphAlgorithms) {
                searchPromises.push(performGraphSearch(graphAlgorithms, args.query, limit));
            }
            
            // 4. AST Search (code structure)
            if (searchTypes.includes('ast')) {
                searchPromises.push(performASTSearch(ast, args.query, limit));
            }
            
            // 5. Git Search (history)
            if (searchTypes.includes('git')) {
                searchPromises.push(performGitSearch(args.query, args.filters?.filePattern, limit));
            }
            
            // 6. File Search (filenames)
            if (searchTypes.includes('files')) {
                searchPromises.push(performFileSearch(args.query, args.filters?.filePattern, limit));
            }
            
            // Execute all searches in parallel
            const startTime = Date.now();
            const allResults = await Promise.all(searchPromises);
            const searchTime = Date.now() - startTime;
            
            // Merge and rank results
            const mergedResults = mergeResults(allResults.flat(), args.query);
            
            // Get index statistics
            const stats = await getIndexStats(db, ast);
            
            return {
                query: args.query,
                searchTime: `${searchTime}ms`,
                totalResults: mergedResults.length,
                results: mergedResults.slice(0, limit * 2), // Return more since we merged
                indexStats: stats,
                searchTypes: searchTypes,
                message: `Searched ${searchTypes.length} indexes in parallel in ${searchTime}ms`
            };
        }
    };
}

// SQL Search using RxDB indexes
async function performSQLSearch(
    db: UnifiedRxDBBackend,
    query: string,
    filters: any,
    limit: number
): Promise<SearchResult[]> {
    try {
        // Use RxDB's indexed queries
        const results = await db.query({
            ...filters,
            limit,
            orderBy: 'metadata.updated',
            direction: 'desc'
        });
        
        // Also do full-text search
        const textResults = await db.fullTextSearch(query, limit);
        
        // Combine and convert to SearchResult format
        const allDocs = [...results, ...textResults];
        const seen = new Set<string>();
        
        return allDocs
            .filter(doc => {
                if (seen.has(doc.id)) return false;
                seen.add(doc.id);
                return true;
            })
            .map(doc => ({
                type: 'file' as const,
                path: doc.metadata?.filePath,
                content: doc.content.substring(0, 200) + '...',
                metadata: doc.metadata
            }));
    } catch (error) {
        console.error('SQL search error:', error);
        return [];
    }
}

// Vector Search using embeddings
async function performVectorSearch(
    db: UnifiedRxDBBackend,
    query: string,
    filters: any,
    limit: number
): Promise<SearchResult[]> {
    try {
        const results = await db.vectorSearch(query, {
            filter: filters,
            limit,
            threshold: 0.7
        });
        
        return results.map(result => ({
            type: 'vector' as const,
            path: result.document.metadata?.filePath,
            content: result.document.content.substring(0, 200) + '...',
            score: result.score,
            metadata: result.document.metadata
        }));
    } catch (error) {
        console.error('Vector search error:', error);
        return [];
    }
}

// Graph Search using relationships
async function performGraphSearch(
    algorithms: GraphAlgorithms,
    query: string,
    limit: number
): Promise<SearchResult[]> {
    try {
        // Search nodes by type or properties
        const nodes = await (algorithms as any).nodes
            .find()
            .where('label')
            .regex(new RegExp(query, 'i'))
            .limit(limit)
            .exec();
            
        // Also find nodes with high PageRank
        const pageRanks = await algorithms.pageRank();
        const topNodes = Array.from(pageRanks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([nodeId]) => nodeId);
            
        return nodes.map((node: any) => ({
            type: 'graph' as const,
            path: node.filePath,
            line: node.line,
            column: node.column,
            content: `${node.type}: ${node.label}`,
            score: pageRanks.get(node.id) || 0,
            metadata: {
                nodeType: node.type,
                connections: node.properties?.connections || 0,
                pageRank: pageRanks.get(node.id)
            }
        }));
    } catch (error) {
        console.error('Graph search error:', error);
        return [];
    }
}

// AST Search for code symbols
async function performASTSearch(
    ast: ASTIndex,
    query: string,
    limit: number
): Promise<SearchResult[]> {
    try {
        const symbols = ast.searchSymbols(query, {
            exact: false,
            caseSensitive: false
        });
        
        return symbols.slice(0, limit).map(symbol => ({
            type: 'ast' as const,
            path: symbol.filePath,
            line: symbol.line,
            column: symbol.column,
            content: `${symbol.kindName}: ${symbol.name}`,
            metadata: {
                kind: symbol.kindName,
                type: symbol.type,
                documentation: symbol.documentation
            }
        }));
    } catch (error) {
        console.error('AST search error:', error);
        return [];
    }
}

// Git Search
async function performGitSearch(
    query: string,
    filePattern?: string,
    limit: number = 10
): Promise<SearchResult[]> {
    const { execSync } = require('child_process');
    try {
        const pattern = filePattern || '*';
        const cmd = `git log --all --grep="${query}" --pretty=format:"%h|%s|%an|%ad" --date=short -n ${limit}`;
        const output = execSync(cmd, { encoding: 'utf-8' });
        
        return output
            .trim()
            .split('\n')
            .filter((line: any) => line)
            .map((line: any) => {
                const [hash, subject, author, date] = line.split('|');
                return {
                    type: 'git' as const,
                    content: `${subject} (${hash})`,
                    metadata: { hash, author, date }
                };
            });
    } catch (error) {
        return [];
    }
}

// File Search
async function performFileSearch(
    query: string,
    filePattern?: string,
    limit: number = 10
): Promise<SearchResult[]> {
    const files = await vscode.workspace.findFiles(
        filePattern || `**/*${query}*`,
        '**/node_modules/**',
        limit
    );
    
    return files.map(file => ({
        type: 'file' as const,
        path: file.fsPath,
        content: path.basename(file.fsPath)
    }));
}

// Update all indexes
async function updateIndexes(db: UnifiedRxDBBackend, ast: ASTIndex): Promise<void> {
    console.log('Updating search indexes...');
    
    // Index workspace files
    const files = await vscode.workspace.findFiles(
        '**/*.{ts,js,tsx,jsx,py,java,cpp,c,h}',
        '**/node_modules/**',
        1000
    );
    
    for (const file of files) {
        try {
            // Read file content
            const content = await vscode.workspace.fs.readFile(file);
            const text = Buffer.from(content).toString('utf-8');
            
            // Add to RxDB (will generate embedding automatically)
            await (db as any).documents?.insert({
                id: file.fsPath,
                content: text,
                type: 'code',
                metadata: {
                    filePath: file.fsPath,
                    fileName: path.basename(file.fsPath),
                    extension: path.extname(file.fsPath),
                    language: getLanguageFromExtension(path.extname(file.fsPath)),
                    size: content.byteLength
                }
            }).catch(async () => {
                // Document might already exist, update it
                const doc = await (db as any).documents?.findOne(file.fsPath).exec();
                if (doc) {
                    await doc.patch({ content: text });
                }
            });
            
            // Index with AST
            if (file.fsPath.endsWith('.ts') || file.fsPath.endsWith('.js')) {
                await ast.indexFile(file.fsPath);
            }
        } catch (error) {
            // Skip files that can't be read
        }
    }
}

// Get index statistics
async function getIndexStats(db: UnifiedRxDBBackend, ast: ASTIndex): Promise<any> {
    const dbStats = await (db as any).db?.collections?.documents?.count().exec() || 0;
    const astStats = ast.getStats();
    
    return {
        documents: {
            total: dbStats,
            withEmbeddings: await (db as any).documents?.find()
                .where('embedding').ne(null).count().exec() || 0
        },
        ast: {
            files: astStats.totalFiles,
            symbols: astStats.totalSymbols,
            imports: astStats.totalImports
        },
        graph: {
            nodes: await (db as any).db?.collections?.nodes?.count().exec() || 0,
            edges: await (db as any).db?.collections?.edges?.count().exec() || 0
        }
    };
}

// Merge and rank results from different sources
function mergeResults(results: SearchResult[], query: string): SearchResult[] {
    // Score based on relevance and source
    const scored = results.map(result => {
        let score = result.score || 0;
        
        // Boost exact matches
        if (result.content.toLowerCase().includes(query.toLowerCase())) {
            score += 0.5;
        }
        
        // Boost by type
        switch (result.type) {
            case 'vector': score *= 1.5; break;  // Semantic matches are valuable
            case 'ast': score *= 1.3; break;     // Code structure matches
            case 'graph': score *= 1.2; break;   // Relationship matches
            default: score *= 1.0;
        }
        
        return { ...result, score };
    });
    
    // Sort by score
    return scored.sort((a, b) => (b.score || 0) - (a.score || 0));
}

// Helper to get language from extension
function getLanguageFromExtension(ext: string): string {
    const map: Record<string, string> = {
        '.ts': 'typescript',
        '.js': 'javascript',
        '.tsx': 'typescriptreact',
        '.jsx': 'javascriptreact',
        '.py': 'python',
        '.java': 'java',
        '.cpp': 'cpp',
        '.c': 'c',
        '.h': 'c'
    };
    return map[ext] || 'text';
}