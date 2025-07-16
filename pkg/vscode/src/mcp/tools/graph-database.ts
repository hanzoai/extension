import * as vscode from 'vscode';
import * as path from 'path';
import { MCPTool } from '../server';
import { GraphDatabase } from '../../core/graph-db';
import { ASTIndex } from '../../core/ast-index';

// Singleton instances
let graphDb: GraphDatabase | null = null;
let astIndex: ASTIndex | null = null;

function getGraphDb(): GraphDatabase {
    if (!graphDb) {
        graphDb = new GraphDatabase();
    }
    return graphDb;
}

function getASTIndex(): ASTIndex {
    if (!astIndex) {
        astIndex = new ASTIndex();
    }
    return astIndex;
}

export function createGraphDatabaseTool(context: vscode.ExtensionContext): MCPTool {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    return {
        name: 'graph_db',
        description: 'Graph database operations for code analysis and relationships',
        inputSchema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['add_node', 'add_edge', 'query', 'find_path', 'analyze', 'index_code', 'search_symbols', 'get_references', 'get_hierarchy', 'clear'],
                    description: 'Operation to perform'
                },
                // For add_node
                node: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        type: { type: 'string' },
                        properties: { type: 'object' }
                    }
                },
                // For add_edge
                edge: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        from: { type: 'string' },
                        to: { type: 'string' },
                        type: { type: 'string' },
                        properties: { type: 'object' }
                    }
                },
                // For query
                query: {
                    type: 'object',
                    properties: {
                        type: { type: 'string' },
                        properties: { type: 'object' },
                        connected: {
                            type: 'object',
                            properties: {
                                type: { type: 'string' },
                                direction: { type: 'string', enum: ['in', 'out', 'both'] }
                            }
                        }
                    }
                },
                // For find_path
                from: { type: 'string' },
                to: { type: 'string' },
                maxDepth: { type: 'number' },
                // For index_code
                path: { type: 'string' },
                recursive: { type: 'boolean' },
                // For search_symbols
                symbolQuery: { type: 'string' },
                kind: { type: 'string' },
                exact: { type: 'boolean' },
                // For get_references/get_hierarchy
                symbolName: { type: 'string' },
                filePath: { type: 'string' }
            },
            required: ['operation']
        },
        handler: async (args: any) => {
            const db = getGraphDb();
            const ast = getASTIndex();
            
            switch (args.operation) {
                case 'add_node':
                    if (!args.node) throw new Error('Node data required');
                    db.addNode(args.node);
                    return `Node ${args.node.id} added successfully`;
                    
                case 'add_edge':
                    if (!args.edge) throw new Error('Edge data required');
                    db.addEdge(args.edge);
                    return `Edge ${args.edge.id} added successfully`;
                    
                case 'query':
                    const nodes = db.queryNodes(args.query || {});
                    return {
                        count: nodes.length,
                        nodes: nodes.slice(0, 100), // Limit results
                        message: nodes.length > 100 ? `Showing first 100 of ${nodes.length} results` : undefined
                    };
                    
                case 'find_path':
                    if (!args.from || !args.to) throw new Error('From and to node IDs required');
                    const foundPath = db.findPath(args.from, args.to, args.maxDepth);
                    if (foundPath) {
                        return {
                            found: true,
                            length: foundPath.length,
                            path: foundPath.map(n => ({ id: n.id, type: n.type, name: n.properties.name || n.id }))
                        };
                    } else {
                        return { found: false, message: 'No path found' };
                    }
                    
                case 'analyze':
                    const stats = db.getStats();
                    const components = db.getConnectedComponents();
                    return {
                        stats,
                        components: {
                            count: components.length,
                            sizes: components.map(c => c.length).sort((a, b) => b - a).slice(0, 10),
                            largest: components[0]?.length || 0
                        }
                    };
                    
                case 'index_code':
                    const indexPath = args.path ? path.resolve(workspaceRoot, args.path) : workspaceRoot;
                    if (args.recursive !== false) {
                        await ast.indexDirectory(indexPath);
                    } else {
                        await ast.indexFile(indexPath);
                    }
                    const indexStats = ast.getStats();
                    return {
                        indexed: true,
                        files: indexStats.totalFiles,
                        symbols: indexStats.totalSymbols,
                        imports: indexStats.totalImports,
                        calls: indexStats.totalCalls
                    };
                    
                case 'search_symbols':
                    if (!args.symbolQuery) throw new Error('Symbol query required');
                    const symbols = ast.searchSymbols(args.symbolQuery, {
                        exact: args.exact,
                        caseSensitive: args.caseSensitive
                    });
                    return {
                        count: symbols.length,
                        symbols: symbols.slice(0, 50).map(s => ({
                            name: s.name,
                            kind: s.kindName,
                            file: path.relative(workspaceRoot, s.filePath),
                            line: s.line,
                            type: s.type
                        }))
                    };
                    
                case 'get_references':
                    if (!args.symbolName) throw new Error('Symbol name required');
                    const refs = ast.findReferences(args.symbolName, args.filePath);
                    return {
                        count: refs.length,
                        references: refs.map(r => ({
                            file: path.relative(workspaceRoot, r.filePath),
                            line: r.line,
                            column: r.column,
                            type: r.type
                        }))
                    };
                    
                case 'get_hierarchy':
                    if (!args.symbolName) throw new Error('Symbol name required');
                    const hierarchy = ast.getTypeHierarchy(args.symbolName);
                    return {
                        parents: hierarchy.parents.map(s => ({
                            name: s.name,
                            file: path.relative(workspaceRoot, s.filePath),
                            line: s.line
                        })),
                        children: hierarchy.children.map(s => ({
                            name: s.name,
                            file: path.relative(workspaceRoot, s.filePath),
                            line: s.line
                        })),
                        implementations: hierarchy.implementations.map(s => ({
                            name: s.name,
                            file: path.relative(workspaceRoot, s.filePath),
                            line: s.line
                        }))
                    };
                    
                case 'clear':
                    db.clear();
                    ast.clear();
                    return 'Graph database and AST index cleared';
                    
                default:
                    throw new Error(`Unknown operation: ${args.operation}`);
            }
        }
    };
}