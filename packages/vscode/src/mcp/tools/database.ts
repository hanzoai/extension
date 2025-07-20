import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { createGraphDatabaseTool } from './graph-database';

export function createDatabaseTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        createGraphDatabaseTool(context),
        {
            name: 'sql_query',
            description: 'Execute SQL queries',
            inputSchema: {
                type: 'object',
                properties: {
                    database: {
                        type: 'string',
                        description: 'Database name or connection string'
                    },
                    query: {
                        type: 'string',
                        description: 'SQL query to execute'
                    }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; query: string }) => {
                // TODO: Implement SQL query execution
                return 'SQL database support coming soon';
            }
        },
        
        {
            name: 'sql_search',
            description: 'Search in SQL databases',
            inputSchema: {
                type: 'object',
                properties: {
                    database: {
                        type: 'string',
                        description: 'Database name'
                    },
                    table: {
                        type: 'string',
                        description: 'Table name'
                    },
                    query: {
                        type: 'string',
                        description: 'Search query'
                    }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; table?: string; query: string }) => {
                // TODO: Implement SQL search
                return 'SQL search coming soon';
            }
        },
        
        {
            name: 'graph_query',
            description: 'Query graph databases',
            inputSchema: {
                type: 'object',
                properties: {
                    database: {
                        type: 'string',
                        description: 'Graph database name'
                    },
                    query: {
                        type: 'string',
                        description: 'Graph query (Cypher, Gremlin, etc.)'
                    }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; query: string }) => {
                // TODO: Implement graph database queries
                return 'Graph database support coming soon';
            }
        }
    ];
}