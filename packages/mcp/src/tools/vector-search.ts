/**
 * Vector search tools using LanceDB for multimodal storage
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { Tool, ToolResult } from '../types';
import lancedb from '@lancedb/lancedb';
import { pipeline } from '@xenova/transformers';

// Initialize embedding model
let embedder: any = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

// LanceDB connection cache
const dbConnections = new Map<string, any>();

async function getProjectDB(projectPath: string): Promise<any> {
  const dbPath = path.join(projectPath, '.hanzo', 'lancedb');
  
  if (!dbConnections.has(dbPath)) {
    // Ensure directory exists
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    
    // Connect to LanceDB
    const db = await lancedb.connect(dbPath);
    dbConnections.set(dbPath, db);
  }
  
  return dbConnections.get(dbPath);
}

export const vectorIndexTool: Tool = {
  name: 'vector_index',
  description: 'Index files or content into the vector database',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Content to index'
      },
      path: {
        type: 'string', 
        description: 'Path to file(s) to index'
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata to store'
      },
      projectPath: {
        type: 'string',
        description: 'Project path for the database',
        default: process.cwd()
      }
    }
  },
  handler: async (args) => {
    try {
      const db = await getProjectDB(args.projectPath || process.cwd());
      const model = await getEmbedder();
      
      // Prepare content to index
      let items: Array<{content: string, path?: string, metadata?: any}> = [];
      
      if (args.content) {
        items.push({
          content: args.content,
          path: args.path,
          metadata: args.metadata
        });
      } else if (args.path) {
        // Read file(s)
        const stats = await fs.stat(args.path);
        if (stats.isFile()) {
          const content = await fs.readFile(args.path, 'utf-8');
          items.push({
            content,
            path: args.path,
            metadata: args.metadata
          });
        } else {
          // TODO: Handle directory indexing
          return {
            content: [{
              type: 'text',
              text: 'Directory indexing not yet implemented'
            }],
            isError: true
          };
        }
      }
      
      // Create table if it doesn't exist
      let table;
      try {
        table = await db.openTable('documents');
      } catch {
        // Table doesn't exist, create it
        table = await db.createTable('documents', [
          { id: 0, content: '', path: '', embedding: [], metadata: {}, timestamp: new Date() }
        ]);
      }
      
      // Index each item
      const indexed = [];
      for (const item of items) {
        // Generate embedding
        const output = await model(item.content, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);
        
        // Add to database
        const record = {
          id: Date.now() + Math.random(),
          content: item.content,
          path: item.path || '',
          embedding,
          metadata: item.metadata || {},
          timestamp: new Date()
        };
        
        await table.add([record]);
        indexed.push(item.path || 'content');
      }
      
      return {
        content: [{
          type: 'text',
          text: `Indexed ${indexed.length} items into vector database:\n${indexed.join('\n')}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error indexing: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const vectorSearchTool: Tool = {
  name: 'vector_search',
  description: 'Search using semantic similarity in the vector database',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return',
        default: 10
      },
      projectPath: {
        type: 'string',
        description: 'Project path for the database',
        default: process.cwd()
      },
      filter: {
        type: 'object',
        description: 'Metadata filters'
      }
    },
    required: ['query']
  },
  handler: async (args) => {
    try {
      const db = await getProjectDB(args.projectPath || process.cwd());
      const model = await getEmbedder();
      
      // Open table
      let table;
      try {
        table = await db.openTable('documents');
      } catch {
        return {
          content: [{
            type: 'text',
            text: 'No documents indexed yet. Use vector_index first.'
          }]
        };
      }
      
      // Generate query embedding
      const output = await model(args.query, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);
      
      // Search
      let results = await table
        .search(queryEmbedding)
        .limit(args.limit || 10);
      
      // Apply filters if provided
      if (args.filter) {
        // TODO: Implement filtering
      }
      
      // Execute search
      const matches = await results.toArray();
      
      if (matches.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No matching documents found'
          }]
        };
      }
      
      // Format results
      const formatted = matches.map((match: any, i: number) => {
        const preview = match.content.substring(0, 200).replace(/\n/g, ' ');
        return `${i + 1}. [${match._distance.toFixed(3)}] ${match.path || 'content'}\n   ${preview}...`;
      });
      
      return {
        content: [{
          type: 'text',
          text: `Found ${matches.length} matches:\n\n${formatted.join('\n\n')}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error searching: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const vectorStatsTool: Tool = {
  name: 'vector_stats',
  description: 'Get statistics about the vector database',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project path for the database',
        default: process.cwd()
      }
    }
  },
  handler: async (args) => {
    try {
      const db = await getProjectDB(args.projectPath || process.cwd());
      
      try {
        const table = await db.openTable('documents');
        const count = await table.countRows();
        
        return {
          content: [{
            type: 'text',
            text: `Vector database statistics:\n- Documents: ${count}\n- Database path: ${path.join(args.projectPath || process.cwd(), '.hanzo/lancedb')}`
          }]
        };
      } catch {
        return {
          content: [{
            type: 'text',
            text: 'Vector database is empty. Use vector_index to add documents.'
          }]
        };
      }
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error getting stats: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Export all vector tools
export const vectorTools = [
  vectorIndexTool,
  vectorSearchTool,
  vectorStatsTool
];