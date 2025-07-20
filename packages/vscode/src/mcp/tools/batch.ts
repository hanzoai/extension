import * as vscode from 'vscode';

interface BatchOperation {
    tool: string;
    args: any;
    continue_on_error?: boolean;
}

interface BatchResult {
    success: boolean;
    results: Array<{
        tool: string;
        success: boolean;
        result?: any;
        error?: string;
        duration_ms: number;
    }>;
    total_duration_ms: number;
    failed_count: number;
    succeeded_count: number;
}

export class BatchTools {
    private context: vscode.ExtensionContext;
    private toolHandlers: Map<string, (args: any) => Promise<any>> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Register tool handlers from other tool classes
    registerToolHandler(name: string, handler: (args: any) => Promise<any>) {
        this.toolHandlers.set(name, handler);
    }

    getTools() {
        return [
            {
                name: 'batch',
                description: 'Execute multiple tools atomically in sequence. If any fails, subsequent tools are not executed unless continue_on_error is true.',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        operations: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    tool: {
                                        type: 'string',
                                        description: 'Tool name to execute'
                                    },
                                    args: {
                                        type: 'object',
                                        description: 'Arguments for the tool'
                                    },
                                    continue_on_error: {
                                        type: 'boolean',
                                        description: 'Continue execution even if this operation fails'
                                    }
                                },
                                required: ['tool', 'args']
                            },
                            description: 'List of operations to execute'
                        },
                        parallel: {
                            type: 'boolean',
                            description: 'Execute operations in parallel (default: false)'
                        },
                        stop_on_error: {
                            type: 'boolean',
                            description: 'Stop execution on first error (default: true)'
                        },
                        timeout_ms: {
                            type: 'number',
                            description: 'Total timeout for all operations in milliseconds'
                        }
                    },
                    required: ['operations']
                },
                handler: this.batchHandler.bind(this)
            },
            {
                name: 'batch_search',
                description: 'Perform multiple search operations efficiently',
                inputSchema: {
                    type: 'object' as const,
                    properties: {
                        searches: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: {
                                        type: 'string',
                                        enum: ['grep', 'symbols', 'files', 'git'],
                                        description: 'Type of search'
                                    },
                                    pattern: {
                                        type: 'string',
                                        description: 'Search pattern'
                                    },
                                    path: {
                                        type: 'string',
                                        description: 'Path to search in'
                                    },
                                    options: {
                                        type: 'object',
                                        description: 'Additional search options'
                                    }
                                },
                                required: ['type', 'pattern']
                            },
                            description: 'List of searches to perform'
                        },
                        combine_results: {
                            type: 'boolean',
                            description: 'Combine all results into a single list'
                        },
                        deduplicate: {
                            type: 'boolean',
                            description: 'Remove duplicate results'
                        }
                    },
                    required: ['searches']
                },
                handler: this.batchSearchHandler.bind(this)
            }
        ];
    }

    private async batchHandler(args: any): Promise<BatchResult> {
        const operations: BatchOperation[] = args.operations;
        const parallel = args.parallel || false;
        const stopOnError = args.stop_on_error !== false;
        const timeoutMs = args.timeout_ms;
        
        const startTime = Date.now();
        const results: BatchResult['results'] = [];
        let failedCount = 0;
        let succeededCount = 0;

        try {
            if (parallel) {
                // Execute all operations in parallel
                const promises = operations.map(async (op) => {
                    const opStartTime = Date.now();
                    try {
                        const handler = this.toolHandlers.get(op.tool);
                        if (!handler) {
                            throw new Error(`Unknown tool: ${op.tool}`);
                        }
                        
                        const result = await this.executeWithTimeout(
                            handler(op.args),
                            timeoutMs ? timeoutMs / operations.length : undefined
                        );
                        
                        succeededCount++;
                        return {
                            tool: op.tool,
                            success: true,
                            result,
                            duration_ms: Date.now() - opStartTime
                        };
                    } catch (error: any) {
                        failedCount++;
                        return {
                            tool: op.tool,
                            success: false,
                            error: error.message,
                            duration_ms: Date.now() - opStartTime
                        };
                    }
                });
                
                const parallelResults = await Promise.all(promises);
                results.push(...parallelResults);
            } else {
                // Execute operations sequentially
                for (const op of operations) {
                    const opStartTime = Date.now();
                    
                    // Check timeout
                    if (timeoutMs && (Date.now() - startTime) > timeoutMs) {
                        results.push({
                            tool: op.tool,
                            success: false,
                            error: 'Batch operation timeout exceeded',
                            duration_ms: Date.now() - opStartTime
                        });
                        failedCount++;
                        break;
                    }
                    
                    try {
                        const handler = this.toolHandlers.get(op.tool);
                        if (!handler) {
                            throw new Error(`Unknown tool: ${op.tool}`);
                        }
                        
                        const remainingTime = timeoutMs ? timeoutMs - (Date.now() - startTime) : undefined;
                        const result = await this.executeWithTimeout(handler(op.args), remainingTime);
                        
                        results.push({
                            tool: op.tool,
                            success: true,
                            result,
                            duration_ms: Date.now() - opStartTime
                        });
                        succeededCount++;
                    } catch (error: any) {
                        results.push({
                            tool: op.tool,
                            success: false,
                            error: error.message,
                            duration_ms: Date.now() - opStartTime
                        });
                        failedCount++;
                        
                        if (stopOnError && !op.continue_on_error) {
                            break;
                        }
                    }
                }
            }
            
            return {
                success: failedCount === 0,
                results,
                total_duration_ms: Date.now() - startTime,
                failed_count: failedCount,
                succeeded_count: succeededCount
            };
        } catch (error: any) {
            return {
                success: false,
                results,
                total_duration_ms: Date.now() - startTime,
                failed_count: failedCount + 1,
                succeeded_count: succeededCount
            };
        }
    }

    private async batchSearchHandler(args: any): Promise<any> {
        const searches = args.searches;
        const combineResults = args.combine_results || false;
        const deduplicate = args.deduplicate || false;
        
        // Map search types to tool names
        const searchToolMap: Record<string, string> = {
            'grep': 'grep',
            'symbols': 'symbols',
            'files': 'find_files',
            'git': 'git_search'
        };
        
        // Convert searches to batch operations
        const operations = searches.map((search: any) => ({
            tool: searchToolMap[search.type] || search.type,
            args: {
                pattern: search.pattern,
                path: search.path,
                ...search.options
            }
        }));
        
        // Execute batch
        const batchResult = await this.batchHandler({
            operations,
            parallel: true
        });
        
        if (!batchResult.success) {
            return batchResult;
        }
        
        // Process results
        let allResults: any[] = [];
        const resultsByType: Record<string, any[]> = {};
        
        for (let i = 0; i < searches.length; i++) {
            const search = searches[i];
            const result = batchResult.results[i];
            
            if (result.success && result.result) {
                const items = this.extractSearchResults(result.result);
                
                if (!resultsByType[search.type]) {
                    resultsByType[search.type] = [];
                }
                resultsByType[search.type].push(...items);
                allResults.push(...items);
            }
        }
        
        // Deduplicate if requested
        if (deduplicate && combineResults) {
            allResults = this.deduplicateResults(allResults);
        }
        
        return {
            success: true,
            results: combineResults ? allResults : resultsByType,
            total_results: allResults.length,
            search_count: searches.length,
            duration_ms: batchResult.total_duration_ms
        };
    }

    private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
        if (!timeoutMs) {
            return promise;
        }
        
        return Promise.race([
            promise,
            new Promise<T>((_, reject) => 
                setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
            )
        ]);
    }

    private extractSearchResults(result: any): any[] {
        // Extract results based on the structure
        if (Array.isArray(result)) {
            return result;
        }
        if (result.results && Array.isArray(result.results)) {
            return result.results;
        }
        if (result.files && Array.isArray(result.files)) {
            return result.files;
        }
        if (result.matches && Array.isArray(result.matches)) {
            return result.matches;
        }
        return [];
    }

    private deduplicateResults(results: any[]): any[] {
        const seen = new Set<string>();
        const deduped: any[] = [];
        
        for (const result of results) {
            // Create a unique key for each result
            const key = JSON.stringify(
                result.file || result.path || result.symbol || result
            );
            
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(result);
            }
        }
        
        return deduped;
    }
}