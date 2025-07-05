# Embedding Server Architecture

## Overview

The Hanzo Extension uses a flexible embedding architecture that supports both local and cloud embedding generation for vector search capabilities.

## What is an Embedding Server?

An embedding server converts text into high-dimensional numerical vectors (embeddings) that capture semantic meaning. These vectors enable:

- **Semantic Search**: Find documents by meaning, not just keywords
- **Similarity Matching**: Find related documents
- **Clustering**: Group similar content
- **Classification**: Categorize content automatically

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Query    │────▶│ Embedding Server │────▶│ Vector (float[])│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ├── Local (ONNX)
                               ├── OpenAI API
                               ├── Cohere API
                               └── Hanzo Cloud

┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  RxDB + SQLite  │────▶│  Vector Search   │────▶│ Ranked Results  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Embedding Server Options

### 1. Local Embedding Server (Default)

Uses ONNX Runtime to run embedding models locally:

```typescript
const localServer = new LocalEmbeddingServer();
await localServer.initialize();

// Model: all-MiniLM-L6-v2
// Dimensions: 384
// Speed: ~10ms per embedding
// Privacy: 100% local, no data leaves your machine
```

**Supported Models**:
- `all-MiniLM-L6-v2` (384d) - Balanced performance
- `all-mpnet-base-v2` (768d) - Higher quality
- `paraphrase-MiniLM-L3-v2` (384d) - Faster, multilingual

**Advantages**:
- Complete privacy
- No API costs
- Works offline
- Fast for small batches

### 2. OpenAI Embedding Server

Uses OpenAI's embedding API:

```typescript
const openaiServer = new CloudEmbeddingServer('openai', apiKey);

// Model: text-embedding-ada-002
// Dimensions: 1536
// Speed: ~100ms per embedding (network dependent)
// Cost: $0.0001 per 1K tokens
```

**Advantages**:
- State-of-the-art quality
- No local compute required
- Handles any text length

### 3. Cohere Embedding Server

Uses Cohere's embedding API:

```typescript
const cohereServer = new CloudEmbeddingServer('cohere', apiKey);

// Model: embed-english-v2.0
// Dimensions: 4096
// Speed: ~100ms per embedding
// Cost: $0.0001 per 1K tokens
```

**Advantages**:
- Very high dimensional embeddings
- Good for specialized domains
- Multiple language models

### 4. Hanzo Cloud Embedding Server

Uses Hanzo's optimized embedding service:

```typescript
const hanzoServer = new CloudEmbeddingServer('hanzo', apiKey);

// Model: hanzo-embed-v1
// Dimensions: 768
// Speed: ~50ms per embedding
// Cost: Included with Hanzo Cloud
```

**Advantages**:
- Optimized for code and technical content
- Integrated with other Hanzo services
- Included in Hanzo Cloud subscription

## RxDB as Unified SQL + Vector Store

RxDB with SQLite backend provides both relational and vector capabilities:

### SQL Features
- Relational queries with indexes
- Complex filtering and sorting
- Aggregations and joins
- ACID transactions
- Full-text search

### Vector Features
- Store embeddings as array fields
- Cosine similarity calculations
- K-nearest neighbor search
- Hybrid search (SQL + Vector)
- Automatic embedding generation

### Example Schema

```typescript
const schema = {
    properties: {
        // Regular SQL fields
        id: { type: 'string', primary: true },
        title: { type: 'string' },
        author: { type: 'string' },
        created: { type: 'number' },
        
        // Vector embedding
        embedding: {
            type: 'array',
            items: { type: 'number' },
            maxItems: 1536  // Max dimensions
        },
        
        // Content for embedding
        content: { type: 'string' }
    },
    indexes: ['author', 'created', 'type']
};
```

## Usage Examples

### 1. Basic Vector Search

```typescript
// Initialize with local embeddings
const backend = new UnifiedRxDBBackend(storagePath);
await backend.initialize();

// Add document (embedding generated automatically)
await backend.documents.insert({
    id: 'doc1',
    content: 'How to implement authentication in React',
    type: 'tutorial'
});

// Search by meaning
const results = await backend.vectorSearch('React security best practices');
```

### 2. Hybrid Search (SQL + Vector)

```typescript
// Combine SQL filters with vector search
const results = await backend.hybridSearch(
    'authentication patterns',  // Vector search query
    {
        type: 'tutorial',       // SQL filter
        author: 'john',         // SQL filter
        dateRange: {            // SQL filter
            start: Date.now() - 30 * 24 * 60 * 60 * 1000,
            end: Date.now()
        }
    },
    0.7  // Weight for vector search (0-1)
);
```

### 3. Find Similar Documents

```typescript
// Find documents similar to a specific one
const doc = await backend.documents.findOne('doc1').exec();
const similar = await doc.findSimilar(10);  // Top 10 similar
```

### 4. SQL Aggregations

```typescript
// Count documents by type
const stats = await backend.aggregate([
    {
        $group: {
            _id: 'type',
            count: { $sum: 1 },
            avgTokens: { $avg: '$metadata.tokens' }
        }
    }
]);
```

## Performance Characteristics

### Local Embeddings
- **Latency**: 5-20ms per embedding
- **Throughput**: 50-200 embeddings/second
- **Memory**: 100-500MB for model
- **CPU**: Uses all available cores

### Cloud Embeddings
- **Latency**: 50-200ms per embedding
- **Throughput**: Limited by API rate limits
- **Batch size**: Up to 100 texts per request
- **Cost**: $0.0001-0.001 per 1K tokens

### Vector Search Performance
- **Search time**: O(n) for brute force
- **With indexing**: O(log n) for approximate search
- **Memory**: ~4KB per document (384d embedding)
- **Accuracy**: 95%+ recall with proper indexing

## Configuration

### Environment Variables

```bash
# Embedding provider selection
HANZO_EMBEDDING_PROVIDER=local  # local | openai | cohere | hanzo

# API keys for cloud providers
OPENAI_API_KEY=sk-...
COHERE_API_KEY=...
HANZO_API_KEY=...

# Local model selection
HANZO_LOCAL_EMBEDDING_MODEL=all-MiniLM-L6-v2

# Performance tuning
HANZO_EMBEDDING_BATCH_SIZE=32
HANZO_EMBEDDING_CACHE_SIZE=1000
```

### VS Code Settings

```json
{
    "hanzo.embedding": {
        "provider": "local",
        "model": "all-MiniLM-L6-v2",
        "batchSize": 32,
        "cacheEnabled": true,
        "cacheSize": 1000
    }
}
```

## Best Practices

1. **Choose the Right Provider**
   - Local: Privacy-sensitive data, offline usage
   - Cloud: Large scale, best quality

2. **Optimize Batch Processing**
   - Batch multiple texts together
   - Use async/await properly
   - Implement caching

3. **Storage Optimization**
   - Use appropriate dimensions (384 often sufficient)
   - Consider quantization for large datasets
   - Index frequently searched fields

4. **Hybrid Search Strategy**
   - Use SQL filters to reduce candidates
   - Apply vector search on filtered results
   - Adjust weights based on use case

## Future Enhancements

1. **Vector Indexing**: HNSW or IVF indexes for faster search
2. **Fine-tuned Models**: Domain-specific embeddings
3. **Multi-modal**: Image and code embeddings
4. **Streaming**: Real-time embedding generation
5. **Edge Deployment**: WebAssembly models