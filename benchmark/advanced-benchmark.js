#!/usr/bin/env node

/**
 * Advanced benchmarks for Graph Database, Vector Store, and AST operations
 */

const { performance } = require('perf_hooks');
const path = require('path');
const fs = require('fs').promises;
const Module = require('module');

// Hook require for vscode mock
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return require('../scripts/vscode-mock');
    }
    return originalRequire.apply(this, arguments);
};

// Load implementations
const { GraphDatabase } = require('../out/core/graph-db');
const { VectorStore } = require('../out/core/vector-store');
const { ASTIndex } = require('../out/core/ast-index');
const { DocumentStore } = require('../out/core/document-store');

class AdvancedBenchmark {
    constructor() {
        this.results = {};
    }
    
    async run() {
        console.log('🚀 Advanced Benchmark Suite\n');
        console.log('Testing Graph Database, Vector Store, AST Index, and Document Store\n');
        
        await this.benchmarkGraphDatabase();
        await this.benchmarkVectorStore();
        await this.benchmarkASTIndex();
        await this.benchmarkDocumentStore();
        await this.benchmarkIntegration();
        
        this.printResults();
    }
    
    async benchmark(name, fn, iterations = 100) {
        console.log(`📊 ${name}`);
        
        const times = [];
        
        // Warm-up
        for (let i = 0; i < 5; i++) {
            try {
                await fn();
            } catch (e) {
                // Ignore warm-up errors
            }
        }
        
        // Actual benchmark
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            try {
                await fn();
                times.push(performance.now() - start);
            } catch (e) {
                // Count errors but continue
            }
        }
        
        if (times.length === 0) {
            console.log('  ❌ All iterations failed\n');
            return;
        }
        
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const sorted = times.sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
        
        this.results[name] = { avg, median, p95, iterations: times.length };
        console.log(`  ✅ Avg: ${avg.toFixed(2)}ms | Median: ${median.toFixed(2)}ms | P95: ${p95.toFixed(2)}ms\n`);
    }
    
    async benchmarkGraphDatabase() {
        console.log('\n🔷 Graph Database Benchmarks\n');
        
        const db = new GraphDatabase();
        
        // Prepare test data
        const nodes = [];
        const edges = [];
        
        for (let i = 0; i < 1000; i++) {
            nodes.push({
                id: `node_${i}`,
                type: i % 3 === 0 ? 'class' : i % 3 === 1 ? 'function' : 'variable',
                properties: {
                    name: `Item_${i}`,
                    value: i,
                    category: `cat_${i % 10}`
                }
            });
        }
        
        for (let i = 0; i < 500; i++) {
            edges.push({
                id: `edge_${i}`,
                from: `node_${i}`,
                to: `node_${(i + 1) % 1000}`,
                type: i % 2 === 0 ? 'calls' : 'references'
            });
        }
        
        // Add nodes benchmark
        await this.benchmark('Graph: Add 1000 nodes', async () => {
            const tempDb = new GraphDatabase();
            for (const node of nodes) {
                tempDb.addNode(node);
            }
        }, 10);
        
        // Setup for other benchmarks
        for (const node of nodes) {
            db.addNode(node);
        }
        for (const edge of edges) {
            db.addEdge(edge);
        }
        
        // Query benchmarks
        await this.benchmark('Graph: Query by type', async () => {
            db.queryNodes({ type: 'class' });
        });
        
        await this.benchmark('Graph: Query by properties', async () => {
            db.queryNodes({ properties: { category: 'cat_5' } });
        });
        
        await this.benchmark('Graph: Find path', async () => {
            db.findPath('node_0', 'node_50', 10);
        });
        
        await this.benchmark('Graph: Get node edges', async () => {
            db.getNodeEdges('node_100', 'both');
        });
        
        await this.benchmark('Graph: Get connected components', async () => {
            db.getConnectedComponents();
        }, 10);
        
        // Complex query
        await this.benchmark('Graph: Complex query with connections', async () => {
            db.queryNodes({
                type: 'function',
                connected: { type: 'calls', direction: 'out' }
            });
        });
    }
    
    async benchmarkVectorStore() {
        console.log('\n🔷 Vector Store Benchmarks\n');
        
        const store = new VectorStore();
        
        // Prepare test documents
        const documents = [];
        const sampleTexts = [
            'The quick brown fox jumps over the lazy dog',
            'Machine learning is a subset of artificial intelligence',
            'JavaScript is a programming language for web development',
            'Data structures and algorithms are fundamental concepts',
            'Cloud computing provides on-demand computing resources'
        ];
        
        for (let i = 0; i < 1000; i++) {
            documents.push({
                content: sampleTexts[i % sampleTexts.length] + ` Document ${i}`,
                metadata: {
                    type: i % 3 === 0 ? 'code' : i % 3 === 1 ? 'documentation' : 'comment',
                    language: i % 2 === 0 ? 'javascript' : 'python',
                    project: `project_${i % 5}`
                }
            });
        }
        
        // Add documents benchmark
        await this.benchmark('Vector: Add 1000 documents', async () => {
            const tempStore = new VectorStore();
            for (const doc of documents) {
                await tempStore.addDocument(doc.content, doc.metadata);
            }
        }, 5);
        
        // Setup for search benchmarks
        for (const doc of documents) {
            await store.addDocument(doc.content, doc.metadata);
        }
        
        // Search benchmarks
        await this.benchmark('Vector: Simple search', async () => {
            await store.search('programming language');
        });
        
        await this.benchmark('Vector: Search with filters', async () => {
            await store.search('machine learning', {
                filter: { type: 'documentation' }
            });
        });
        
        await this.benchmark('Vector: Search top 50', async () => {
            await store.search('data', { topK: 50 });
        });
        
        // Get similar documents
        const firstDoc = store.getDocument(documents[0].content);
        if (firstDoc) {
            await this.benchmark('Vector: Find similar documents', async () => {
                await store.getSimilar(firstDoc.id, 20);
            });
        }
        
        // Metadata search
        await this.benchmark('Vector: Search by metadata', async () => {
            store.searchByMetadata({ language: 'javascript', project: 'project_2' });
        });
    }
    
    async benchmarkASTIndex() {
        console.log('\n🔷 AST Index Benchmarks\n');
        
        const ast = new ASTIndex();
        
        // Create test TypeScript files
        const testDir = path.join(__dirname, 'test-ast');
        await fs.mkdir(testDir, { recursive: true });
        
        // Generate test files
        for (let i = 0; i < 20; i++) {
            const content = `
export class TestClass${i} {
    private value: number = ${i};
    
    constructor() {
        this.initialize();
    }
    
    private initialize(): void {
        console.log('Initializing TestClass${i}');
    }
    
    public getValue(): number {
        return this.value;
    }
    
    public process(data: string): string {
        return data.toUpperCase();
    }
}

export function helperFunction${i}(input: any): boolean {
    return input !== null && input !== undefined;
}

export interface TestInterface${i} {
    id: number;
    name: string;
    process(): void;
}

export type TestType${i} = string | number | boolean;

const testVariable${i} = new TestClass${i}();
testVariable${i}.process('test');
`;
            await fs.writeFile(path.join(testDir, `test${i}.ts`), content);
        }
        
        // Index files benchmark
        await this.benchmark('AST: Index 20 TypeScript files', async () => {
            const tempAst = new ASTIndex();
            for (let i = 0; i < 20; i++) {
                await tempAst.indexFile(path.join(testDir, `test${i}.ts`));
            }
        }, 10);
        
        // Setup for search benchmarks
        for (let i = 0; i < 20; i++) {
            await ast.indexFile(path.join(testDir, `test${i}.ts`));
        }
        
        // Search benchmarks
        await this.benchmark('AST: Search symbols', async () => {
            ast.searchSymbols('TestClass');
        });
        
        await this.benchmark('AST: Search exact match', async () => {
            ast.searchSymbols('TestClass5', { exact: true });
        });
        
        await this.benchmark('AST: Find references', async () => {
            ast.findReferences('helperFunction10');
        });
        
        await this.benchmark('AST: Get call hierarchy', async () => {
            ast.getCallHierarchy('process');
        });
        
        await this.benchmark('AST: Get type hierarchy', async () => {
            ast.getTypeHierarchy('TestInterface10');
        });
        
        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
    }
    
    async benchmarkDocumentStore() {
        console.log('\n🔷 Document Store Benchmarks\n');
        
        const storePath = path.join(__dirname, 'test-docs');
        await fs.mkdir(storePath, { recursive: true });
        const store = new DocumentStore(storePath);
        await store.initialize();
        
        // Prepare test data
        const chatId = 'chat_benchmark';
        const documents = [];
        
        for (let i = 0; i < 100; i++) {
            documents.push({
                content: `This is document ${i} with some sample content for testing`,
                type: i % 3 === 0 ? 'code' : i % 3 === 1 ? 'markdown' : 'text',
                metadata: {
                    tags: [`tag${i % 5}`, `category${i % 3}`],
                    author: `user${i % 10}`
                }
            });
        }
        
        // Add documents benchmark
        await this.benchmark('DocStore: Add 100 documents', async () => {
            for (const doc of documents.slice(0, 10)) {
                await store.addDocument(chatId, doc.content, doc.type, doc.metadata);
            }
        }, 10);
        
        // Search benchmarks
        await this.benchmark('DocStore: Search documents', async () => {
            await store.searchDocuments('document sample content');
        });
        
        await this.benchmark('DocStore: Search with filters', async () => {
            await store.searchDocuments('content', {
                type: 'code',
                tags: ['tag2']
            });
        });
        
        // Session operations
        const session = {
            id: 'session_test',
            title: 'Test Session',
            created: new Date(),
            updated: new Date(),
            messages: Array(50).fill(null).map((_, i) => ({
                id: `msg_${i}`,
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `Message ${i}`,
                timestamp: new Date()
            })),
            documents: [],
            tags: ['benchmark', 'test']
        };
        
        await this.benchmark('DocStore: Save session', async () => {
            await store.saveSession(session);
        });
        
        // Cleanup
        await fs.rm(storePath, { recursive: true, force: true });
    }
    
    async benchmarkIntegration() {
        console.log('\n🔷 Integration Benchmarks\n');
        
        // Combined operations that use multiple systems
        const db = new GraphDatabase();
        const vector = new VectorStore();
        const ast = new ASTIndex();
        
        // Simulate indexing a codebase with all systems
        await this.benchmark('Integration: Index codebase (Graph + Vector + AST)', async () => {
            // Add file nodes to graph
            for (let i = 0; i < 10; i++) {
                db.addNode({
                    id: `file_${i}`,
                    type: 'file',
                    properties: { name: `file${i}.ts`, size: 1000 + i * 100 }
                });
                
                // Add to vector store
                await vector.addDocument(`File ${i} content with code`, {
                    filePath: `file${i}.ts`,
                    type: 'code'
                });
            }
            
            // Add relationships
            for (let i = 0; i < 5; i++) {
                db.addEdge({
                    id: `import_${i}`,
                    from: `file_${i}`,
                    to: `file_${i + 1}`,
                    type: 'imports'
                });
            }
        }, 10);
        
        // Complex search across systems
        await this.benchmark('Integration: Multi-system search', async () => {
            // Search in vector store
            const vectorResults = await vector.search('code content');
            
            // For each result, find in graph
            for (const result of vectorResults.slice(0, 5)) {
                const fileId = result.document.metadata.filePath?.replace('.ts', '');
                if (fileId) {
                    db.getNodeEdges(`file_${fileId}`, 'both');
                }
            }
        });
    }
    
    printResults() {
        console.log('\n' + '='.repeat(80));
        console.log('\n📈 Benchmark Results Summary\n');
        console.log('='.repeat(80));
        
        // Group results
        const categories = {
            'Graph Database': Object.keys(this.results).filter(k => k.includes('Graph:')),
            'Vector Store': Object.keys(this.results).filter(k => k.includes('Vector:')),
            'AST Index': Object.keys(this.results).filter(k => k.includes('AST:')),
            'Document Store': Object.keys(this.results).filter(k => k.includes('DocStore:')),
            'Integration': Object.keys(this.results).filter(k => k.includes('Integration:'))
        };
        
        for (const [category, tests] of Object.entries(categories)) {
            if (tests.length === 0) continue;
            
            console.log(`\n${category}:`);
            console.log('-'.repeat(70));
            console.log('Operation                              | Avg (ms) | Median | P95    |');
            console.log('-'.repeat(70));
            
            for (const test of tests) {
                const result = this.results[test];
                const name = test.replace(/^[^:]+:\s*/, '').padEnd(36);
                console.log(`${name} | ${result.avg.toFixed(2).padStart(8)} | ${result.median.toFixed(2).padStart(6)} | ${result.p95.toFixed(2).padStart(6)} |`);
            }
        }
        
        // Performance insights
        console.log('\n📊 Performance Insights:\n');
        
        // Graph DB insights
        const graphAddNodes = this.results['Graph: Add 1000 nodes'];
        if (graphAddNodes) {
            const nodesPerMs = 1000 / graphAddNodes.avg;
            console.log(`• Graph DB: Can add ${nodesPerMs.toFixed(0)} nodes/ms`);
        }
        
        // Vector store insights
        const vectorAdd = this.results['Vector: Add 1000 documents'];
        if (vectorAdd) {
            const docsPerMs = 1000 / vectorAdd.avg;
            console.log(`• Vector Store: Can index ${docsPerMs.toFixed(0)} documents/ms`);
        }
        
        const vectorSearch = this.results['Vector: Simple search'];
        if (vectorSearch) {
            console.log(`• Vector Search: ${vectorSearch.avg < 50 ? '🟢 Fast' : vectorSearch.avg < 200 ? '🟡 Moderate' : '🔴 Slow'} (${vectorSearch.avg.toFixed(2)}ms avg)`);
        }
        
        // AST insights
        const astIndex = this.results['AST: Index 20 TypeScript files'];
        if (astIndex) {
            const filesPerSecond = (20 / astIndex.avg) * 1000;
            console.log(`• AST Indexing: ~${filesPerSecond.toFixed(0)} files/second`);
        }
        
        console.log('\n✨ Benchmark complete!');
    }
}

// Run benchmark
if (require.main === module) {
    const benchmark = new AdvancedBenchmark();
    benchmark.run().catch(console.error);
}