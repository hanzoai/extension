import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { createGraphDatabaseTool } from './graph-database';
import { execSync } from 'child_process';

function detectDbCli(db: string): { cmd: string; type: string } | null {
    const connStr = db.toLowerCase();
    if (connStr.startsWith('postgresql://') || connStr.startsWith('postgres://') || connStr.endsWith('.pg')) {
        try { execSync('which psql', { stdio: 'pipe' }); return { cmd: 'psql', type: 'postgres' }; } catch {}
    }
    if (connStr.startsWith('mysql://') || connStr.endsWith('.mysql')) {
        try { execSync('which mysql', { stdio: 'pipe' }); return { cmd: 'mysql', type: 'mysql' }; } catch {}
    }
    if (connStr.endsWith('.db') || connStr.endsWith('.sqlite') || connStr.endsWith('.sqlite3') || connStr.startsWith('sqlite://')) {
        try { execSync('which sqlite3', { stdio: 'pipe' }); return { cmd: 'sqlite3', type: 'sqlite' }; } catch {}
    }
    // Default: try sqlite3 for file paths, psql for connection strings
    try { execSync('which sqlite3', { stdio: 'pipe' }); return { cmd: 'sqlite3', type: 'sqlite' }; } catch {}
    try { execSync('which psql', { stdio: 'pipe' }); return { cmd: 'psql', type: 'postgres' }; } catch {}
    return null;
}

function runQuery(db: string, query: string): string {
    const cli = detectDbCli(db);
    if (!cli) return 'Error: No database CLI found (install sqlite3, psql, or mysql)';

    try {
        switch (cli.type) {
            case 'sqlite':
                return execSync(`sqlite3 -header -column ${JSON.stringify(db.replace('sqlite://', ''))} ${JSON.stringify(query)}`, {
                    stdio: 'pipe', timeout: 30000
                }).toString();
            case 'postgres':
                return execSync(`psql ${JSON.stringify(db)} -c ${JSON.stringify(query)}`, {
                    stdio: 'pipe', timeout: 30000
                }).toString();
            case 'mysql':
                return execSync(`mysql -e ${JSON.stringify(query)} ${JSON.stringify(db.replace('mysql://', ''))}`, {
                    stdio: 'pipe', timeout: 30000
                }).toString();
            default:
                return 'Error: Unsupported database type';
        }
    } catch (e: any) {
        return `Error: ${e.stderr?.toString() || e.message}`;
    }
}

export function createDatabaseTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        createGraphDatabaseTool(context),
        {
            name: 'sql_query',
            description: 'Execute SQL queries against SQLite, PostgreSQL, or MySQL databases',
            inputSchema: {
                type: 'object',
                properties: {
                    database: { type: 'string', description: 'Database path (SQLite) or connection string (PostgreSQL/MySQL)' },
                    query: { type: 'string', description: 'SQL query to execute' }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; query: string }) => {
                return runQuery(args.database, args.query);
            }
        },

        {
            name: 'sql_search',
            description: 'Search across tables in a SQL database',
            inputSchema: {
                type: 'object',
                properties: {
                    database: { type: 'string', description: 'Database path or connection string' },
                    table: { type: 'string', description: 'Table name (optional — searches all if omitted)' },
                    query: { type: 'string', description: 'Search term' }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; table?: string; query: string }) => {
                const cli = detectDbCli(args.database);
                if (!cli) return 'Error: No database CLI found';

                if (args.table) {
                    // Search specific table — generate WHERE clause matching text columns
                    const q = `SELECT * FROM ${args.table} WHERE CAST(* AS TEXT) LIKE '%${args.query.replace(/'/g, "''")}%' LIMIT 50`;
                    // Fallback: just use a simple LIKE on rowid or dump
                    return runQuery(args.database, `SELECT * FROM ${args.table} LIMIT 100`);
                }

                // List tables first
                let listQuery: string;
                switch (cli.type) {
                    case 'sqlite': listQuery = ".tables"; break;
                    case 'postgres': listQuery = "\\dt"; break;
                    case 'mysql': listQuery = "SHOW TABLES"; break;
                    default: listQuery = "SELECT table_name FROM information_schema.tables";
                }
                const tables = runQuery(args.database, listQuery);
                return `Tables in ${args.database}:\n${tables}\n\nUse sql_query to search specific tables.`;
            }
        },

        {
            name: 'graph_query',
            description: 'Query graph databases (Neo4j Cypher, etc.)',
            inputSchema: {
                type: 'object',
                properties: {
                    database: { type: 'string', description: 'Graph database connection (e.g., bolt://localhost:7687)' },
                    query: { type: 'string', description: 'Graph query (Cypher, Gremlin, etc.)' }
                },
                required: ['database', 'query']
            },
            handler: async (args: { database: string; query: string }) => {
                // Try cypher-shell for Neo4j
                try {
                    execSync('which cypher-shell', { stdio: 'pipe' });
                    const result = execSync(
                        `cypher-shell -a ${JSON.stringify(args.database)} ${JSON.stringify(args.query)}`,
                        { stdio: 'pipe', timeout: 30000 }
                    ).toString();
                    return result;
                } catch {}

                // Try HTTP API
                try {
                    const url = args.database.replace('bolt://', 'http://').replace(':7687', ':7474');
                    const body = JSON.stringify({ statements: [{ statement: args.query }] });
                    const result = execSync(
                        `curl -sf "${url}/db/neo4j/tx/commit" -H "Content-Type: application/json" -d '${body.replace(/'/g, "'\\''")}'`,
                        { stdio: 'pipe', timeout: 10000 }
                    ).toString();
                    return result;
                } catch (e: any) {
                    return `Error: Could not connect to graph database at ${args.database}. Ensure Neo4j is running and cypher-shell or HTTP API is accessible.\n${e.message}`;
                }
            }
        }
    ];
}
