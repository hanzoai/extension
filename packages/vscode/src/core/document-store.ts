/**
 * Document store for managing chat documents and shared content
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { VectorStore } from './vector-store';
import { GraphDatabase } from './graph-db';

export interface ChatDocument {
    id: string;
    chatId: string;
    title: string;
    content: string;
    type: 'code' | 'markdown' | 'text' | 'image' | 'file';
    language?: string;
    filePath?: string;
    metadata: {
        created: Date;
        updated: Date;
        tags: string[];
        references: string[];
        author?: string;
    };
}

export interface ChatSession {
    id: string;
    title: string;
    created: Date;
    updated: Date;
    messages: ChatMessage[];
    documents: string[]; // Document IDs
    tags: string[];
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    documents?: string[]; // Referenced document IDs
}

export class DocumentStore {
    private documents: Map<string, ChatDocument> = new Map();
    private sessions: Map<string, ChatSession> = new Map();
    private vectorStore: VectorStore;
    private graphDb: GraphDatabase;
    private storePath: string;
    
    constructor(storePath: string) {
        this.storePath = storePath;
        this.vectorStore = new VectorStore();
        this.graphDb = new GraphDatabase();
    }
    
    async initialize(): Promise<void> {
        // Ensure storage directory exists
        await fs.mkdir(this.storePath, { recursive: true });
        
        // Load existing data
        await this.load();
    }
    
    /**
     * Add a document from chat
     */
    async addDocument(
        chatId: string,
        content: string,
        type: ChatDocument['type'],
        metadata?: Partial<ChatDocument['metadata']>
    ): Promise<string> {
        const id = `doc_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        const doc: ChatDocument = {
            id,
            chatId,
            title: this.generateTitle(content, type),
            content,
            type,
            metadata: {
                created: new Date(),
                updated: new Date(),
                tags: metadata?.tags || [],
                references: metadata?.references || [],
                author: metadata?.author
            }
        };
        
        // Store document
        this.documents.set(id, doc);
        
        // Index in vector store
        await this.vectorStore.addDocument(content, {
            id,
            chatId,
            type,
            title: doc.title,
            tags: doc.metadata.tags
        });
        
        // Add to graph database
        this.graphDb.addNode({
            id,
            type: 'document',
            properties: {
                chatId,
                documentType: type,
                title: doc.title,
                created: doc.metadata.created.toISOString()
            }
        });
        
        // Link to chat session
        this.graphDb.addEdge({
            id: `edge_${id}_${chatId}`,
            from: chatId,
            to: id,
            type: 'contains'
        });
        
        // Save to disk
        await this.save();
        
        return id;
    }
    
    /**
     * Get a document by ID
     */
    getDocument(id: string): ChatDocument | undefined {
        return this.documents.get(id);
    }
    
    /**
     * Update a document
     */
    async updateDocument(id: string, updates: Partial<ChatDocument>): Promise<void> {
        const doc = this.documents.get(id);
        if (!doc) {
            throw new Error(`Document ${id} not found`);
        }
        
        // Update document
        Object.assign(doc, updates);
        doc.metadata.updated = new Date();
        
        // Update vector store if content changed
        if (updates.content) {
            await this.vectorStore.updateDocument(id, updates.content);
        }
        
        // Update graph node
        this.graphDb.updateNode(id, {
            properties: {
                title: doc.title,
                updated: doc.metadata.updated.toISOString()
            }
        });
        
        await this.save();
    }
    
    /**
     * Search documents by content
     */
    async searchDocuments(
        query: string,
        options?: {
            chatId?: string;
            type?: ChatDocument['type'];
            tags?: string[];
            limit?: number;
        }
    ): Promise<ChatDocument[]> {
        const filter: Record<string, any> = {};
        
        if (options?.chatId) filter.chatId = options.chatId;
        if (options?.type) filter.type = options.type;
        
        const results = await this.vectorStore.search(query, {
            topK: options?.limit || 20,
            filter
        });
        
        const documents: ChatDocument[] = [];
        for (const result of results) {
            const docId = result.document.metadata.id as string;
            const doc = this.documents.get(docId);
            if (doc) {
                // Apply tag filter if specified
                if (options?.tags && options.tags.length > 0) {
                    const hasAllTags = options.tags.every(tag => 
                        doc.metadata.tags.includes(tag)
                    );
                    if (!hasAllTags) continue;
                }
                documents.push(doc);
            }
        }
        
        return documents;
    }
    
    /**
     * Create or update a chat session
     */
    async saveSession(session: ChatSession): Promise<void> {
        this.sessions.set(session.id, session);
        
        // Add to graph if new
        if (!this.graphDb.getNode(session.id)) {
            this.graphDb.addNode({
                id: session.id,
                type: 'session',
                properties: {
                    title: session.title,
                    created: session.created.toISOString(),
                    messageCount: session.messages.length
                }
            });
        } else {
            this.graphDb.updateNode(session.id, {
                properties: {
                    title: session.title,
                    updated: session.updated.toISOString(),
                    messageCount: session.messages.length
                }
            });
        }
        
        await this.save();
    }
    
    /**
     * Get a chat session
     */
    getSession(id: string): ChatSession | undefined {
        return this.sessions.get(id);
    }
    
    /**
     * Get all sessions
     */
    getAllSessions(): ChatSession[] {
        return Array.from(this.sessions.values())
            .sort((a, b) => b.updated.getTime() - a.updated.getTime());
    }
    
    /**
     * Find related documents using graph relationships
     */
    findRelatedDocuments(documentId: string, limit: number = 10): ChatDocument[] {
        const edges = this.graphDb.getNodeEdges(documentId);
        const relatedIds = new Set<string>();
        
        // Find documents in same chat
        const doc = this.documents.get(documentId);
        if (doc) {
            const chatDocs = this.graphDb.queryNodes({
                type: 'document',
                properties: { chatId: doc.chatId }
            });
            
            chatDocs.forEach(node => {
                if (node.id !== documentId) {
                    relatedIds.add(node.id);
                }
            });
        }
        
        // Find documents with shared references
        for (const edge of edges) {
            if (edge.type === 'references') {
                relatedIds.add(edge.from === documentId ? edge.to : edge.from);
            }
        }
        
        const related: ChatDocument[] = [];
        for (const id of relatedIds) {
            const relDoc = this.documents.get(id);
            if (relDoc) {
                related.push(relDoc);
            }
            if (related.length >= limit) break;
        }
        
        return related;
    }
    
    /**
     * Export session with all documents
     */
    async exportSession(sessionId: string): Promise<{
        session: ChatSession;
        documents: ChatDocument[];
    }> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        
        const documents: ChatDocument[] = [];
        for (const docId of session.documents) {
            const doc = this.documents.get(docId);
            if (doc) {
                documents.push(doc);
            }
        }
        
        return { session, documents };
    }
    
    /**
     * Get document graph for visualization
     */
    getDocumentGraph(chatId?: string): {
        nodes: Array<{ id: string; label: string; type: string }>;
        edges: Array<{ from: string; to: string; type: string }>;
    } {
        const nodes = chatId 
            ? this.graphDb.queryNodes({ type: 'document', properties: { chatId } })
            : this.graphDb.queryNodes({ type: 'document' });
            
        const graphNodes = nodes.map(node => ({
            id: node.id,
            label: node.properties.title || node.id,
            type: node.properties.documentType || 'unknown'
        }));
        
        const edges = [];
        for (const node of nodes) {
            const nodeEdges = this.graphDb.getNodeEdges(node.id);
            for (const edge of nodeEdges) {
                if (edge.type === 'references') {
                    edges.push({
                        from: edge.from,
                        to: edge.to,
                        type: edge.type
                    });
                }
            }
        }
        
        return { nodes: graphNodes, edges };
    }
    
    /**
     * Get statistics
     */
    getStats(): {
        documentCount: number;
        sessionCount: number;
        documentTypes: Record<string, number>;
        averageDocumentsPerSession: number;
        vectorStoreStats: any;
        graphStats: any;
    } {
        const documentTypes: Record<string, number> = {};
        let totalDocsInSessions = 0;
        
        for (const doc of this.documents.values()) {
            documentTypes[doc.type] = (documentTypes[doc.type] || 0) + 1;
        }
        
        for (const session of this.sessions.values()) {
            totalDocsInSessions += session.documents.length;
        }
        
        return {
            documentCount: this.documents.size,
            sessionCount: this.sessions.size,
            documentTypes,
            averageDocumentsPerSession: this.sessions.size > 0 
                ? totalDocsInSessions / this.sessions.size 
                : 0,
            vectorStoreStats: this.vectorStore.getStats(),
            graphStats: this.graphDb.getStats()
        };
    }
    
    // Private helper methods
    
    private generateTitle(content: string, type: ChatDocument['type']): string {
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length === 0) return 'Untitled';
        
        switch (type) {
            case 'code':
                // Try to find function/class name
                const codeMatch = lines[0].match(/(?:function|class|def|const|let|var)\s+(\w+)/);
                if (codeMatch) return codeMatch[1];
                break;
            case 'markdown':
                // Try to find heading
                const heading = lines.find(l => l.startsWith('#'));
                if (heading) return heading.replace(/^#+\s*/, '');
                break;
        }
        
        // Default: first line truncated
        return lines[0].substring(0, 50) + (lines[0].length > 50 ? '...' : '');
    }
    
    private async save(): Promise<void> {
        const data = {
            documents: Array.from(this.documents.entries()),
            sessions: Array.from(this.sessions.entries()),
            vectorStore: this.vectorStore.export(),
            graphDb: this.graphDb.toJSON()
        };
        
        const filePath = path.join(this.storePath, 'document-store.json');
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    }
    
    private async load(): Promise<void> {
        try {
            const filePath = path.join(this.storePath, 'document-store.json');
            const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            
            // Restore documents
            this.documents = new Map(data.documents.map(([id, doc]: [string, any]) => {
                doc.metadata.created = new Date(doc.metadata.created);
                doc.metadata.updated = new Date(doc.metadata.updated);
                return [id, doc];
            }));
            
            // Restore sessions
            this.sessions = new Map(data.sessions.map(([id, session]: [string, any]) => {
                session.created = new Date(session.created);
                session.updated = new Date(session.updated);
                session.messages = session.messages.map((msg: any) => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp)
                }));
                return [id, session];
            }));
            
            // Restore vector store
            if (data.vectorStore) {
                await this.vectorStore.import(data.vectorStore);
            }
            
            // Restore graph database
            if (data.graphDb) {
                this.graphDb = GraphDatabase.fromJSON(data.graphDb);
            }
        } catch (error) {
            // No existing data or error loading - start fresh
            console.log('Starting with empty document store');
        }
    }
}