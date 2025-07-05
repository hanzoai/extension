/**
 * SQLite backend for local persistence using RxDB
 * Provides persistent storage for all data structures
 */

import { createRxDatabase, RxDatabase, RxCollection, RxDocument, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import * as path from 'path';

// Schema definitions
const graphNodeSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        type: {
            type: 'string'
        },
        properties: {
            type: 'object'
        },
        createdAt: {
            type: 'number'
        },
        updatedAt: {
            type: 'number'
        }
    },
    required: ['id', 'type']
};

const graphEdgeSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        from: {
            type: 'string',
            ref: 'graphnodes'
        },
        to: {
            type: 'string',
            ref: 'graphnodes'
        },
        type: {
            type: 'string'
        },
        properties: {
            type: 'object'
        },
        createdAt: {
            type: 'number'
        }
    },
    required: ['id', 'from', 'to', 'type']
};

const vectorDocumentSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        content: {
            type: 'string'
        },
        embedding: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        metadata: {
            type: 'object'
        },
        timestamp: {
            type: 'number'
        }
    },
    required: ['id', 'content'],
    indexes: ['timestamp']
};

const chatDocumentSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        chatId: {
            type: 'string'
        },
        title: {
            type: 'string'
        },
        content: {
            type: 'string'
        },
        type: {
            type: 'string',
            enum: ['code', 'markdown', 'text', 'image', 'file']
        },
        language: {
            type: 'string'
        },
        metadata: {
            type: 'object',
            properties: {
                created: { type: 'number' },
                updated: { type: 'number' },
                tags: {
                    type: 'array',
                    items: { type: 'string' }
                },
                references: {
                    type: 'array',
                    items: { type: 'string' }
                },
                author: { type: 'string' }
            }
        }
    },
    required: ['id', 'chatId', 'content', 'type'],
    indexes: ['chatId', 'type', ['chatId', 'type']]
};

const chatSessionSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 200
        },
        title: {
            type: 'string'
        },
        created: {
            type: 'number'
        },
        updated: {
            type: 'number'
        },
        messages: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    role: { type: 'string' },
                    content: { type: 'string' },
                    timestamp: { type: 'number' },
                    documents: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                }
            }
        },
        documents: {
            type: 'array',
            items: { type: 'string' }
        },
        tags: {
            type: 'array',
            items: { type: 'string' }
        }
    },
    required: ['id', 'title', 'created', 'updated'],
    indexes: ['updated']
};

const configSchema = {
    version: 0,
    primaryKey: 'key',
    type: 'object',
    properties: {
        key: {
            type: 'string',
            maxLength: 200
        },
        value: {
            type: 'string'
        },
        updatedAt: {
            type: 'number'
        }
    },
    required: ['key', 'value']
};

export class SQLiteBackend {
    private db?: RxDatabase;
    private dbPath: string;
    private initialized: boolean = false;
    
    // Collections
    private graphNodes?: RxCollection;
    private graphEdges?: RxCollection;
    private vectorDocuments?: RxCollection;
    private chatDocuments?: RxCollection;
    private chatSessions?: RxCollection;
    private config?: RxCollection;
    
    constructor(storagePath: string) {
        this.dbPath = path.join(storagePath, 'hanzo.db');
    }
    
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        try {
            // Create database with Dexie storage (IndexedDB/WebSQL)
            this.db = await createRxDatabase({
                name: this.dbPath,
                storage: getRxStorageDexie(),
                password: 'hanzo-extension-2024', // Encrypt database
                multiInstance: false,
                eventReduce: true
            });
            
            // Create collections
            const collections = await this.db.addCollections({
                graphnodes: {
                    schema: graphNodeSchema
                },
                graphedges: {
                    schema: graphEdgeSchema
                },
                vectordocuments: {
                    schema: vectorDocumentSchema
                },
                chatdocuments: {
                    schema: chatDocumentSchema
                },
                chatsessions: {
                    schema: chatSessionSchema
                },
                config: {
                    schema: configSchema
                }
            });
            
            this.graphNodes = collections.graphnodes;
            this.graphEdges = collections.graphedges;
            this.vectorDocuments = collections.vectordocuments;
            this.chatDocuments = collections.chatdocuments;
            this.chatSessions = collections.chatsessions;
            this.config = collections.config;
            
            this.initialized = true;
            console.log('SQLite backend initialized at:', this.dbPath);
            
        } catch (error) {
            console.error('Failed to initialize SQLite backend:', error);
            throw error;
        }
    }
    
    // Graph operations
    async addGraphNode(node: any): Promise<void> {
        await this.ensureInitialized();
        await this.graphNodes!.insert({
            ...node,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }
    
    async updateGraphNode(id: string, updates: any): Promise<void> {
        await this.ensureInitialized();
        const doc = await this.graphNodes!.findOne(id).exec();
        if (doc) {
            await doc.patch({
                ...updates,
                updatedAt: Date.now()
            });
        }
    }
    
    async deleteGraphNode(id: string): Promise<void> {
        await this.ensureInitialized();
        const doc = await this.graphNodes!.findOne(id).exec();
        if (doc) {
            await doc.remove();
        }
    }
    
    async queryGraphNodes(query: any): Promise<any[]> {
        await this.ensureInitialized();
        
        let rxQuery = this.graphNodes!.find();
        
        if (query.type) {
            rxQuery = rxQuery.where('type').eq(query.type);
        }
        
        const results = await rxQuery.exec();
        
        // Filter by properties if needed
        if (query.properties) {
            return results.filter((doc: any) => {
                const props = doc.properties || {};
                return Object.entries(query.properties).every(([key, value]) => 
                    props[key] === value
                );
            });
        }
        
        return results.map((doc: any) => doc.toJSON());
    }
    
    async addGraphEdge(edge: any): Promise<void> {
        await this.ensureInitialized();
        await this.graphEdges!.insert({
            ...edge,
            createdAt: Date.now()
        });
    }
    
    async queryGraphEdges(filter: any): Promise<any[]> {
        await this.ensureInitialized();
        
        let rxQuery = this.graphEdges!.find();
        
        if (filter.from) {
            rxQuery = rxQuery.where('from').eq(filter.from);
        } else if (filter.to) {
            rxQuery = rxQuery.where('to').eq(filter.to);
        }
        
        if (filter.type) {
            rxQuery = rxQuery.where('type').eq(filter.type);
        }
        
        const results = await rxQuery.exec();
        return results.map((doc: any) => doc.toJSON());
    }
    
    // Vector operations
    async addVectorDocument(doc: any): Promise<void> {
        await this.ensureInitialized();
        await this.vectorDocuments!.insert({
            ...doc,
            timestamp: Date.now()
        });
    }
    
    async searchVectorDocuments(embedding: number[], limit: number = 10): Promise<any[]> {
        await this.ensureInitialized();
        
        // Get all documents with embeddings
        const docs = await this.vectorDocuments!
            .find()
            .where('embedding')
            .ne(null)
            .exec();
        
        // Calculate cosine similarity for each
        const results = docs.map((doc: any) => {
            const docData = doc.toJSON();
            const similarity = this.cosineSimilarity(embedding, docData.embedding || []);
            return {
                document: docData,
                score: similarity
            };
        });
        
        // Sort by similarity and return top results
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }
    
    async searchVectorByMetadata(filter: any): Promise<any[]> {
        await this.ensureInitialized();
        
        const docs = await this.vectorDocuments!.find().exec();
        
        return docs
            .filter((doc: any) => {
                const metadata = doc.metadata || {};
                return Object.entries(filter).every(([key, value]) => 
                    metadata[key] === value
                );
            })
            .map((doc: any) => doc.toJSON());
    }
    
    // Chat document operations
    async addChatDocument(doc: any): Promise<void> {
        await this.ensureInitialized();
        await this.chatDocuments!.insert(doc);
    }
    
    async getChatDocument(id: string): Promise<any> {
        await this.ensureInitialized();
        const doc = await this.chatDocuments!.findOne(id).exec();
        return doc ? doc.toJSON() : null;
    }
    
    async searchChatDocuments(query: any): Promise<any[]> {
        await this.ensureInitialized();
        
        let rxQuery = this.chatDocuments!.find();
        
        if (query.chatId) {
            rxQuery = rxQuery.where('chatId').eq(query.chatId);
        }
        
        if (query.type) {
            rxQuery = rxQuery.where('type').eq(query.type);
        }
        
        const results = await rxQuery.exec();
        
        // Text search in content
        if (query.text) {
            const searchText = query.text.toLowerCase();
            return results
                .filter((doc: any) => 
                    doc.content.toLowerCase().includes(searchText) ||
                    doc.title?.toLowerCase().includes(searchText)
                )
                .map((doc: any) => doc.toJSON());
        }
        
        return results.map((doc: any) => doc.toJSON());
    }
    
    // Session operations
    async saveChatSession(session: any): Promise<void> {
        await this.ensureInitialized();
        
        const existing = await this.chatSessions!.findOne(session.id).exec();
        if (existing) {
            await existing.patch(session);
        } else {
            await this.chatSessions!.insert(session);
        }
    }
    
    async getChatSession(id: string): Promise<any> {
        await this.ensureInitialized();
        const doc = await this.chatSessions!.findOne(id).exec();
        return doc ? doc.toJSON() : null;
    }
    
    async getAllChatSessions(): Promise<any[]> {
        await this.ensureInitialized();
        const docs = await this.chatSessions!
            .find()
            .sort({ updated: 'desc' })
            .exec();
        return docs.map((doc: any) => doc.toJSON());
    }
    
    // Configuration operations
    async getConfig(key: string, defaultValue?: any): Promise<any> {
        await this.ensureInitialized();
        const doc = await this.config!.findOne(key).exec();
        if (doc) {
            try {
                return JSON.parse(doc.value);
            } catch {
                return doc.value;
            }
        }
        return defaultValue;
    }
    
    async setConfig(key: string, value: any): Promise<void> {
        await this.ensureInitialized();
        
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        
        const existing = await this.config!.findOne(key).exec();
        if (existing) {
            await existing.patch({
                value: stringValue,
                updatedAt: Date.now()
            });
        } else {
            await this.config!.insert({
                key,
                value: stringValue,
                updatedAt: Date.now()
            });
        }
    }
    
    // Database management
    async getStats(): Promise<any> {
        await this.ensureInitialized();
        
        const [nodes, edges, vectors, chatDocs, sessions] = await Promise.all([
            this.graphNodes!.find().exec().then(docs => docs.length),
            this.graphEdges!.find().exec().then(docs => docs.length),
            this.vectorDocuments!.find().exec().then(docs => docs.length),
            this.chatDocuments!.find().exec().then(docs => docs.length),
            this.chatSessions!.find().exec().then(docs => docs.length)
        ]);
        
        return {
            graphNodes: nodes,
            graphEdges: edges,
            vectorDocuments: vectors,
            chatDocuments: chatDocs,
            chatSessions: sessions,
            dbPath: this.dbPath
        };
    }
    
    async backup(backupPath: string): Promise<void> {
        await this.ensureInitialized();
        
        // Export all collections
        const data = {
            graphNodes: await this.graphNodes!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            graphEdges: await this.graphEdges!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            vectorDocuments: await this.vectorDocuments!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            chatDocuments: await this.chatDocuments!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            chatSessions: await this.chatSessions!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            config: await this.config!.find().exec().then(docs => 
                docs.map((d: any) => d.toJSON())
            ),
            exportDate: new Date().toISOString()
        };
        
        const fs = require('fs').promises;
        await fs.writeFile(backupPath, JSON.stringify(data, null, 2));
    }
    
    async restore(backupPath: string): Promise<void> {
        await this.ensureInitialized();
        
        const fs = require('fs').promises;
        const data = JSON.parse(await fs.readFile(backupPath, 'utf-8'));
        
        // Clear existing data
        await this.clear();
        
        // Restore collections
        if (data.graphNodes) {
            await this.graphNodes!.bulkInsert(data.graphNodes);
        }
        if (data.graphEdges) {
            await this.graphEdges!.bulkInsert(data.graphEdges);
        }
        if (data.vectorDocuments) {
            await this.vectorDocuments!.bulkInsert(data.vectorDocuments);
        }
        if (data.chatDocuments) {
            await this.chatDocuments!.bulkInsert(data.chatDocuments);
        }
        if (data.chatSessions) {
            await this.chatSessions!.bulkInsert(data.chatSessions);
        }
        if (data.config) {
            await this.config!.bulkInsert(data.config);
        }
    }
    
    async clear(): Promise<void> {
        await this.ensureInitialized();
        
        // Remove all documents from all collections
        await Promise.all([
            this.graphNodes!.find().remove(),
            this.graphEdges!.find().remove(),
            this.vectorDocuments!.find().remove(),
            this.chatDocuments!.find().remove(),
            this.chatSessions!.find().remove(),
            this.config!.find().remove()
        ]);
    }
    
    async close(): Promise<void> {
        if (this.db) {
            await (this.db as any).destroy();
            this.initialized = false;
        }
    }
    
    // Helper methods
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }
    
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);
        
        if (normA === 0 || normB === 0) return 0;
        
        return dotProduct / (normA * normB);
    }
}