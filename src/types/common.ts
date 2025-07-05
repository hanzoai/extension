/**
 * Common type definitions used across the extension
 */

// File and directory types
export interface FileNode {
    path: string;
    name: string;
    type: 'file';
    size?: number;
    modified?: Date;
    content?: string;
}

export interface DirectoryNode {
    path: string;
    name: string;
    type: 'directory';
    children?: Array<FileNode | DirectoryNode>;
}

export type FileSystemNode = FileNode | DirectoryNode;

// Search result types
export interface BaseSearchResult {
    type: string;
    path?: string;
    content?: string;
    score?: number;
    metadata?: Record<string, any>;
}

export interface TextSearchResult extends BaseSearchResult {
    type: 'text';
    line: number;
    column: number;
    match: string;
}

export interface SymbolSearchResult extends BaseSearchResult {
    type: 'symbol';
    symbolType: 'class' | 'function' | 'interface' | 'variable' | 'method';
    symbolName: string;
}

export interface FileSearchResult extends BaseSearchResult {
    type: 'file';
    fileName: string;
}

export interface GitSearchResult extends BaseSearchResult {
    type: 'git';
    hash: string;
    author: string;
    date: string;
    message: string;
}

export type SearchResult = TextSearchResult | SymbolSearchResult | FileSearchResult | GitSearchResult;

// Todo types
export interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    created?: number;
    updated?: number;
    tags?: string[];
}

// Configuration types
export interface ExtensionConfig {
    apiKey?: string;
    apiEndpoint?: string;
    enableTelemetry?: boolean;
    maxConcurrentRequests?: number;
    timeout?: number;
}

// Error types
export class ExtensionError extends Error {
    constructor(
        message: string,
        public code: string,
        public details?: any
    ) {
        super(message);
        this.name = 'ExtensionError';
    }
}

// Utility types
export type AsyncFunction<T = any, R = any> = (...args: T[]) => Promise<R>;
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type ValueOf<T> = T[keyof T];