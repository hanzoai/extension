import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MCPTool } from '../server';
import { VectorStore } from '../../core/vector-store';
import { DocumentStore } from '../../core/document-store';

// Singleton instances
let vectorStore: VectorStore | null = null;
let documentStore: DocumentStore | null = null;

function getVectorStore(): VectorStore {
    if (!vectorStore) {
        vectorStore = new VectorStore();
    }
    return vectorStore;
}

function getDocumentStore(context: vscode.ExtensionContext): DocumentStore {
    if (!documentStore) {
        const storePath = path.join(context.globalStorageUri.fsPath, 'documents');
        documentStore = new DocumentStore(storePath);
        documentStore.initialize().catch(console.error);
    }
    return documentStore;
}

export function createVectorTools(context: vscode.ExtensionContext): MCPTool[] {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    return [
        {
            name: 'vector_index',
            description: 'Index content for vector search',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to index'
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'Index recursively (default: true)'
                    },
                    fileTypes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'File extensions to index (default: all text files)'
                    }
                },
                required: ['path']
            },
            handler: async (args: { path: string; recursive?: boolean; fileTypes?: string[] }) => {
                const store = getVectorStore();
                const indexPath = path.isAbsolute(args.path) ? args.path : path.join(workspaceRoot, args.path);
                let indexed = 0;
                
                const validExtensions = args.fileTypes || ['.txt', '.md', '.js', '.ts', '.json', '.py', '.java', '.cpp', '.c', '.h'];
                
                async function indexFile(filePath: string) {
                    const ext = path.extname(filePath);
                    if (!validExtensions.includes(ext)) return;
                    
                    try {
                        const content = await fs.readFile(filePath, 'utf-8');
                        await store.addDocument(content, {
                            filePath: path.relative(workspaceRoot, filePath),
                            fileName: path.basename(filePath),
                            extension: ext,
                            size: content.length
                        });
                        indexed++;
                    } catch (error) {
                        // Skip files that can't be read
                    }
                }
                
                async function indexDirectory(dir: string) {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        
                        if (entry.isDirectory() && args.recursive !== false) {
                            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                                await indexDirectory(fullPath);
                            }
                        } else if (entry.isFile()) {
                            await indexFile(fullPath);
                        }
                    }
                }
                
                const stats = await fs.stat(indexPath);
                if (stats.isDirectory()) {
                    await indexDirectory(indexPath);
                } else {
                    await indexFile(indexPath);
                }
                
                const storeStats = store.getStats();
                return {
                    indexed,
                    total: storeStats.documentCount,
                    path: args.path,
                    message: `Indexed ${indexed} files, total documents: ${storeStats.documentCount}`
                };
            }
        },
        
        {
            name: 'vector_search',
            description: 'Semantic search using embeddings',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    },
                    filter: {
                        type: 'object',
                        description: 'Metadata filters',
                        properties: {
                            filePath: { type: 'string' },
                            extension: { type: 'string' }
                        }
                    },
                    topK: {
                        type: 'number',
                        description: 'Number of results to return (default: 10)'
                    },
                    threshold: {
                        type: 'number',
                        description: 'Minimum similarity threshold (0-1, default: 0)'
                    }
                },
                required: ['query']
            },
            handler: async (args: { query: string; filter?: any; topK?: number; threshold?: number }) => {
                const store = getVectorStore();
                const results = await store.search(args.query, {
                    topK: args.topK || 10,
                    threshold: args.threshold || 0,
                    filter: args.filter
                });
                
                return {
                    count: results.length,
                    results: results.map(r => ({
                        score: r.score.toFixed(3),
                        content: r.document.content.substring(0, 200) + '...',
                        metadata: r.document.metadata
                    }))
                };
            }
        },
        
        {
            name: 'vector_similar',
            description: 'Find similar documents to a given document',
            inputSchema: {
                type: 'object',
                properties: {
                    documentId: {
                        type: 'string',
                        description: 'Document ID to find similar documents for'
                    },
                    topK: {
                        type: 'number',
                        description: 'Number of results to return (default: 10)'
                    }
                },
                required: ['documentId']
            },
            handler: async (args: { documentId: string; topK?: number }) => {
                const store = getVectorStore();
                const results = await store.getSimilar(args.documentId, args.topK || 10);
                
                return {
                    count: results.length,
                    results: results.map(r => ({
                        score: r.score.toFixed(3),
                        content: r.document.content.substring(0, 200) + '...',
                        metadata: r.document.metadata
                    }))
                };
            }
        },
        
        {
            name: 'document_store',
            description: 'Store and manage chat documents',
            inputSchema: {
                type: 'object',
                properties: {
                    operation: {
                        type: 'string',
                        enum: ['add', 'get', 'search', 'update', 'save_session', 'get_stats'],
                        description: 'Operation to perform'
                    },
                    // For add
                    chatId: { type: 'string' },
                    content: { type: 'string' },
                    type: { type: 'string', enum: ['code', 'markdown', 'text', 'image', 'file'] },
                    metadata: { type: 'object' },
                    // For get/update
                    documentId: { type: 'string' },
                    updates: { type: 'object' },
                    // For search
                    query: { type: 'string' },
                    // For save_session
                    session: { type: 'object' }
                },
                required: ['operation']
            },
            handler: async (args: any) => {
                const store = getDocumentStore(context);
                
                switch (args.operation) {
                    case 'add':
                        if (!args.chatId || !args.content || !args.type) {
                            throw new Error('chatId, content, and type are required');
                        }
                        const docId = await store.addDocument(
                            args.chatId,
                            args.content,
                            args.type,
                            args.metadata
                        );
                        return {
                            documentId: docId,
                            message: 'Document added successfully'
                        };
                        
                    case 'get':
                        if (!args.documentId) throw new Error('documentId required');
                        const doc = store.getDocument(args.documentId);
                        return doc || { error: 'Document not found' };
                        
                    case 'search':
                        if (!args.query) throw new Error('query required');
                        const docs = await store.searchDocuments(args.query, {
                            chatId: args.chatId,
                            type: args.type,
                            tags: args.tags,
                            limit: args.limit
                        });
                        return {
                            count: docs.length,
                            documents: docs.map(d => ({
                                id: d.id,
                                title: d.title,
                                type: d.type,
                                preview: d.content.substring(0, 100) + '...',
                                metadata: d.metadata
                            }))
                        };
                        
                    case 'update':
                        if (!args.documentId || !args.updates) {
                            throw new Error('documentId and updates required');
                        }
                        await store.updateDocument(args.documentId, args.updates);
                        return 'Document updated successfully';
                        
                    case 'save_session':
                        if (!args.session) throw new Error('session required');
                        await store.saveSession(args.session);
                        return 'Session saved successfully';
                        
                    case 'get_stats':
                        return store.getStats();
                        
                    default:
                        throw new Error(`Unknown operation: ${args.operation}`);
                }
            }
        }
    ];
}