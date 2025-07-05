/**
 * AST-based symbolic search and indexing
 * Provides semantic code search capabilities
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs/promises';
import { GraphDatabase, GraphNode, GraphEdge } from './graph-db';

export interface Symbol {
    name: string;
    kind: ts.SyntaxKind;
    kindName: string;
    filePath: string;
    line: number;
    column: number;
    documentation?: string;
    type?: string;
    modifiers?: string[];
    parent?: string;
}

export interface ImportInfo {
    from: string;
    imports: string[];
    filePath: string;
    line: number;
}

export interface FunctionCall {
    name: string;
    arguments: number;
    filePath: string;
    line: number;
    column: number;
}

export class ASTIndex {
    private symbols: Map<string, Symbol[]> = new Map();
    private imports: Map<string, ImportInfo[]> = new Map();
    private calls: Map<string, FunctionCall[]> = new Map();
    private fileSymbols: Map<string, Symbol[]> = new Map();
    private graphDb: GraphDatabase;
    
    constructor() {
        this.graphDb = new GraphDatabase();
    }
    
    /**
     * Index a TypeScript/JavaScript file
     */
    async indexFile(filePath: string): Promise<void> {
        const content = await fs.readFile(filePath, 'utf-8');
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true
        );
        
        // Clear existing symbols for this file
        this.fileSymbols.delete(filePath);
        const fileSymbolsList: Symbol[] = [];
        
        // Add file node to graph
        this.graphDb.addNode({
            id: filePath,
            type: 'file',
            properties: {
                name: path.basename(filePath),
                extension: path.extname(filePath),
                lines: sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1
            }
        });
        
        // Visit all nodes in the AST
        const visit = (node: ts.Node) => {
            // Extract symbols
            if (this.isNamedDeclaration(node)) {
                const symbol = this.extractSymbol(node, sourceFile, filePath);
                if (symbol) {
                    fileSymbolsList.push(symbol);
                    this.addSymbol(symbol);
                    
                    // Add symbol node to graph
                    const symbolId = `${filePath}:${symbol.name}:${symbol.line}`;
                    this.graphDb.addNode({
                        id: symbolId,
                        type: 'symbol',
                        properties: {
                            name: symbol.name,
                            kind: symbol.kindName,
                            filePath: symbol.filePath,
                            line: symbol.line,
                            type: symbol.type || 'unknown'
                        }
                    });
                    
                    // Link symbol to file
                    this.graphDb.addEdge({
                        id: `edge_${symbolId}_file`,
                        from: filePath,
                        to: symbolId,
                        type: 'contains'
                    });
                }
            }
            
            // Extract imports
            if (ts.isImportDeclaration(node)) {
                const importInfo = this.extractImport(node, sourceFile, filePath);
                if (importInfo) {
                    this.addImport(importInfo);
                    
                    // Add import edge in graph
                    if (importInfo.from.startsWith('.')) {
                        const resolvedPath = path.resolve(path.dirname(filePath), importInfo.from);
                        this.graphDb.addEdge({
                            id: `edge_import_${filePath}_${resolvedPath}`,
                            from: filePath,
                            to: resolvedPath,
                            type: 'imports'
                        });
                    }
                }
            }
            
            // Extract function calls
            if (ts.isCallExpression(node)) {
                const call = this.extractCall(node, sourceFile, filePath);
                if (call) {
                    this.addCall(call);
                }
            }
            
            ts.forEachChild(node, visit);
        };
        
        visit(sourceFile);
        this.fileSymbols.set(filePath, fileSymbolsList);
    }
    
    /**
     * Index a directory recursively
     */
    async indexDirectory(dirPath: string, extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                await this.indexDirectory(fullPath, extensions);
            } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
                try {
                    await this.indexFile(fullPath);
                } catch (error) {
                    console.error(`Error indexing ${fullPath}:`, error);
                }
            }
        }
    }
    
    /**
     * Search for symbols by name
     */
    searchSymbols(query: string, options?: {
        kind?: ts.SyntaxKind | ts.SyntaxKind[];
        exact?: boolean;
        caseSensitive?: boolean;
    }): Symbol[] {
        const results: Symbol[] = [];
        const { kind, exact = false, caseSensitive = false } = options || {};
        
        const normalizedQuery = caseSensitive ? query : query.toLowerCase();
        const kinds = Array.isArray(kind) ? kind : (kind ? [kind] : null);
        
        for (const [name, symbols] of this.symbols) {
            const normalizedName = caseSensitive ? name : name.toLowerCase();
            
            // Check name match
            const matches = exact 
                ? normalizedName === normalizedQuery
                : normalizedName.includes(normalizedQuery);
                
            if (matches) {
                for (const symbol of symbols) {
                    // Check kind filter
                    if (kinds && !kinds.includes(symbol.kind)) {
                        continue;
                    }
                    results.push(symbol);
                }
            }
        }
        
        return results;
    }
    
    /**
     * Find all references to a symbol
     */
    findReferences(symbolName: string, filePath?: string): Array<{
        filePath: string;
        line: number;
        column: number;
        type: 'declaration' | 'import' | 'call';
    }> {
        const references: Array<{
            filePath: string;
            line: number;
            column: number;
            type: 'declaration' | 'import' | 'call';
        }> = [];
        
        // Find declarations
        const symbols = this.symbols.get(symbolName) || [];
        for (const symbol of symbols) {
            if (!filePath || symbol.filePath === filePath) {
                references.push({
                    filePath: symbol.filePath,
                    line: symbol.line,
                    column: symbol.column,
                    type: 'declaration'
                });
            }
        }
        
        // Find imports
        for (const importList of this.imports.values()) {
            for (const importInfo of importList) {
                if (importInfo.imports.includes(symbolName)) {
                    references.push({
                        filePath: importInfo.filePath,
                        line: importInfo.line,
                        column: 0,
                        type: 'import'
                    });
                }
            }
        }
        
        // Find calls
        const calls = this.calls.get(symbolName) || [];
        for (const call of calls) {
            references.push({
                filePath: call.filePath,
                line: call.line,
                column: call.column,
                type: 'call'
            });
        }
        
        return references;
    }
    
    /**
     * Find symbol definition
     */
    findDefinition(symbolName: string, fromFile: string): Symbol | null {
        // First check local file
        const fileSymbols = this.fileSymbols.get(fromFile) || [];
        const localSymbol = fileSymbols.find(s => s.name === symbolName);
        if (localSymbol) return localSymbol;
        
        // Check imports
        const fileImports = Array.from(this.imports.values())
            .flat()
            .filter(imp => imp.filePath === fromFile);
            
        for (const imp of fileImports) {
            if (imp.imports.includes(symbolName)) {
                // Try to resolve the import
                if (imp.from.startsWith('.')) {
                    const resolvedPath = path.resolve(path.dirname(fromFile), imp.from);
                    const importedSymbols = this.fileSymbols.get(resolvedPath) || [];
                    const imported = importedSymbols.find(s => s.name === symbolName);
                    if (imported) return imported;
                }
            }
        }
        
        // Global search as fallback
        const allSymbols = this.symbols.get(symbolName) || [];
        return allSymbols[0] || null;
    }
    
    /**
     * Get call hierarchy for a function
     */
    getCallHierarchy(functionName: string): {
        callers: Array<{ symbol: Symbol; calls: FunctionCall[] }>;
        callees: string[];
    } {
        const callers: Array<{ symbol: Symbol; calls: FunctionCall[] }> = [];
        const callees = new Set<string>();
        
        // Find all calls to this function
        const calls = this.calls.get(functionName) || [];
        
        // Group calls by containing function
        const callsByFile = new Map<string, FunctionCall[]>();
        for (const call of calls) {
            if (!callsByFile.has(call.filePath)) {
                callsByFile.set(call.filePath, []);
            }
            callsByFile.get(call.filePath)!.push(call);
        }
        
        // Find containing functions for each call
        for (const [filePath, fileCalls] of callsByFile) {
            const fileSymbols = this.fileSymbols.get(filePath) || [];
            
            for (const call of fileCalls) {
                // Find the function containing this call
                const containingFunction = fileSymbols
                    .filter(s => s.kind === ts.SyntaxKind.FunctionDeclaration ||
                               s.kind === ts.SyntaxKind.MethodDeclaration ||
                               s.kind === ts.SyntaxKind.ArrowFunction)
                    .find(s => s.line <= call.line);
                    
                if (containingFunction) {
                    const existing = callers.find(c => 
                        c.symbol.name === containingFunction.name &&
                        c.symbol.filePath === containingFunction.filePath
                    );
                    
                    if (existing) {
                        existing.calls.push(call);
                    } else {
                        callers.push({
                            symbol: containingFunction,
                            calls: [call]
                        });
                    }
                }
            }
        }
        
        // Find functions called by this function
        // This would require more detailed AST analysis
        // For now, return empty array
        
        return {
            callers,
            callees: Array.from(callees)
        };
    }
    
    /**
     * Get type hierarchy
     */
    getTypeHierarchy(typeName: string): {
        parents: Symbol[];
        children: Symbol[];
        implementations: Symbol[];
    } {
        const typeSymbols = (this.symbols.get(typeName) || [])
            .filter(s => s.kind === ts.SyntaxKind.ClassDeclaration ||
                        s.kind === ts.SyntaxKind.InterfaceDeclaration);
                        
        const parents: Symbol[] = [];
        const children: Symbol[] = [];
        const implementations: Symbol[] = [];
        
        // Find inheritance relationships using graph
        for (const typeSymbol of typeSymbols) {
            const nodeId = `${typeSymbol.filePath}:${typeSymbol.name}:${typeSymbol.line}`;
            
            // Find parent relationships
            const parentEdges = this.graphDb.getEdges({ from: nodeId, type: 'extends' });
            for (const edge of parentEdges) {
                const parentNode = this.graphDb.getNode(edge.to);
                if (parentNode) {
                    const parentSymbol = this.findSymbolFromNode(parentNode);
                    if (parentSymbol) parents.push(parentSymbol);
                }
            }
            
            // Find child relationships
            const childEdges = this.graphDb.getEdges({ to: nodeId, type: 'extends' });
            for (const edge of childEdges) {
                const childNode = this.graphDb.getNode(edge.from);
                if (childNode) {
                    const childSymbol = this.findSymbolFromNode(childNode);
                    if (childSymbol) children.push(childSymbol);
                }
            }
            
            // Find implementations
            if (typeSymbol.kind === ts.SyntaxKind.InterfaceDeclaration) {
                const implEdges = this.graphDb.getEdges({ to: nodeId, type: 'implements' });
                for (const edge of implEdges) {
                    const implNode = this.graphDb.getNode(edge.from);
                    if (implNode) {
                        const implSymbol = this.findSymbolFromNode(implNode);
                        if (implSymbol) implementations.push(implSymbol);
                    }
                }
            }
        }
        
        return { parents, children, implementations };
    }
    
    /**
     * Get file dependencies
     */
    getFileDependencies(filePath: string): {
        imports: string[];
        importedBy: string[];
    } {
        const imports: string[] = [];
        const importedBy: string[] = [];
        
        // Get direct imports
        const importEdges = this.graphDb.getEdges({ from: filePath, type: 'imports' });
        for (const edge of importEdges) {
            imports.push(edge.to);
        }
        
        // Get files that import this one
        const importedByEdges = this.graphDb.getEdges({ to: filePath, type: 'imports' });
        for (const edge of importedByEdges) {
            importedBy.push(edge.from);
        }
        
        return { imports, importedBy };
    }
    
    /**
     * Get statistics
     */
    getStats(): {
        totalFiles: number;
        totalSymbols: number;
        symbolsByKind: Record<string, number>;
        totalImports: number;
        totalCalls: number;
        graphStats: any;
    } {
        const symbolsByKind: Record<string, number> = {};
        let totalSymbols = 0;
        
        for (const symbols of this.symbols.values()) {
            totalSymbols += symbols.length;
            for (const symbol of symbols) {
                symbolsByKind[symbol.kindName] = (symbolsByKind[symbol.kindName] || 0) + 1;
            }
        }
        
        let totalImports = 0;
        for (const imports of this.imports.values()) {
            totalImports += imports.length;
        }
        
        let totalCalls = 0;
        for (const calls of this.calls.values()) {
            totalCalls += calls.length;
        }
        
        return {
            totalFiles: this.fileSymbols.size,
            totalSymbols,
            symbolsByKind,
            totalImports,
            totalCalls,
            graphStats: this.graphDb.getStats()
        };
    }
    
    /**
     * Clear the index
     */
    clear(): void {
        this.symbols.clear();
        this.imports.clear();
        this.calls.clear();
        this.fileSymbols.clear();
        this.graphDb.clear();
    }
    
    // Private helper methods
    
    private isNamedDeclaration(node: ts.Node): boolean {
        return ts.isFunctionDeclaration(node) ||
               ts.isClassDeclaration(node) ||
               ts.isInterfaceDeclaration(node) ||
               ts.isTypeAliasDeclaration(node) ||
               ts.isEnumDeclaration(node) ||
               ts.isVariableDeclaration(node) ||
               ts.isMethodDeclaration(node) ||
               ts.isPropertyDeclaration(node) ||
               ts.isGetAccessorDeclaration(node) ||
               ts.isSetAccessorDeclaration(node);
    }
    
    private extractSymbol(node: ts.Node, sourceFile: ts.SourceFile, filePath: string): Symbol | null {
        let name: string | undefined;
        let kind = node.kind;
        
        // Extract name based on node type
        if ('name' in node && (node as any).name && ts.isIdentifier((node as any).name)) {
            name = ((node as any).name as ts.Identifier).text;
        } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            name = node.name.text;
        }
        
        if (!name) return null;
        
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        
        const symbol: Symbol = {
            name,
            kind,
            kindName: ts.SyntaxKind[kind],
            filePath,
            line: line + 1,
            column: character + 1
        };
        
        // Extract additional information
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
            symbol.type = 'function';
        } else if (ts.isClassDeclaration(node)) {
            symbol.type = 'class';
        } else if (ts.isInterfaceDeclaration(node)) {
            symbol.type = 'interface';
        } else if (ts.isTypeAliasDeclaration(node)) {
            symbol.type = 'type';
        } else if (ts.isEnumDeclaration(node)) {
            symbol.type = 'enum';
        }
        
        // Extract modifiers
        if ('modifiers' in node && (node as any).modifiers) {
            symbol.modifiers = (node as any).modifiers.map((m: any) => ts.SyntaxKind[m.kind].toLowerCase());
        }
        
        return symbol;
    }
    
    private extractImport(node: ts.ImportDeclaration, sourceFile: ts.SourceFile, filePath: string): ImportInfo | null {
        if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
            return null;
        }
        
        const from = node.moduleSpecifier.text;
        const imports: string[] = [];
        
        if (node.importClause) {
            // Default import
            if (node.importClause.name) {
                imports.push(node.importClause.name.text);
            }
            
            // Named imports
            if (node.importClause.namedBindings) {
                if (ts.isNamedImports(node.importClause.namedBindings)) {
                    for (const element of node.importClause.namedBindings.elements) {
                        imports.push(element.name.text);
                    }
                } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                    imports.push(node.importClause.namedBindings.name.text);
                }
            }
        }
        
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        
        return {
            from,
            imports,
            filePath,
            line: line + 1
        };
    }
    
    private extractCall(node: ts.CallExpression, sourceFile: ts.SourceFile, filePath: string): FunctionCall | null {
        let name: string | undefined;
        
        if (ts.isIdentifier(node.expression)) {
            name = node.expression.text;
        } else if (ts.isPropertyAccessExpression(node.expression) && 
                   ts.isIdentifier(node.expression.name)) {
            name = node.expression.name.text;
        }
        
        if (!name) return null;
        
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.pos);
        
        return {
            name,
            arguments: node.arguments.length,
            filePath,
            line: line + 1,
            column: character + 1
        };
    }
    
    private addSymbol(symbol: Symbol): void {
        if (!this.symbols.has(symbol.name)) {
            this.symbols.set(symbol.name, []);
        }
        this.symbols.get(symbol.name)!.push(symbol);
    }
    
    private addImport(importInfo: ImportInfo): void {
        const key = importInfo.filePath;
        if (!this.imports.has(key)) {
            this.imports.set(key, []);
        }
        this.imports.get(key)!.push(importInfo);
    }
    
    private addCall(call: FunctionCall): void {
        if (!this.calls.has(call.name)) {
            this.calls.set(call.name, []);
        }
        this.calls.get(call.name)!.push(call);
    }
    
    private findSymbolFromNode(node: GraphNode): Symbol | null {
        const { name, filePath, line } = node.properties;
        const fileSymbols = this.fileSymbols.get(filePath) || [];
        return fileSymbols.find(s => s.name === name && s.line === line) || null;
    }
}