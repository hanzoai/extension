/**
 * Lightweight in-memory graph database for code analysis
 * Inspired by Graphene but implemented in TypeScript
 */

export interface GraphNode {
    id: string;
    type: string;
    properties: Record<string, any>;
}

export interface GraphEdge {
    id: string;
    from: string;
    to: string;
    type: string;
    properties?: Record<string, any>;
}

export interface GraphQuery {
    type?: string;
    properties?: Record<string, any>;
    connected?: {
        type: string;
        direction?: 'in' | 'out' | 'both';
    };
}

export class GraphDatabase {
    private nodes: Map<string, GraphNode> = new Map();
    private edges: Map<string, GraphEdge> = new Map();
    private nodeIndex: Map<string, Set<string>> = new Map(); // type -> node ids
    private edgeIndex: Map<string, Set<string>> = new Map(); // from/to -> edge ids
    
    constructor() {}

    // Node operations
    addNode(node: GraphNode): void {
        this.nodes.set(node.id, node);
        
        // Update type index
        if (!this.nodeIndex.has(node.type)) {
            this.nodeIndex.set(node.type, new Set());
        }
        this.nodeIndex.get(node.type)!.add(node.id);
    }

    getNode(id: string): GraphNode | undefined {
        return this.nodes.get(id);
    }

    updateNode(id: string, updates: Partial<GraphNode>): void {
        const node = this.nodes.get(id);
        if (node) {
            Object.assign(node.properties, updates.properties || {});
            if (updates.type && updates.type !== node.type) {
                // Update type index
                this.nodeIndex.get(node.type)?.delete(id);
                node.type = updates.type;
                if (!this.nodeIndex.has(node.type)) {
                    this.nodeIndex.set(node.type, new Set());
                }
                this.nodeIndex.get(node.type)!.add(id);
            }
        }
    }

    deleteNode(id: string): void {
        const node = this.nodes.get(id);
        if (node) {
            // Remove from type index
            this.nodeIndex.get(node.type)?.delete(id);
            
            // Remove connected edges
            const connectedEdges = this.getEdges({ from: id }).concat(this.getEdges({ to: id }));
            connectedEdges.forEach(edge => this.deleteEdge(edge.id));
            
            this.nodes.delete(id);
        }
    }

    // Edge operations
    addEdge(edge: GraphEdge): void {
        this.edges.set(edge.id, edge);
        
        // Update edge index
        const fromKey = `from:${edge.from}`;
        const toKey = `to:${edge.to}`;
        
        if (!this.edgeIndex.has(fromKey)) {
            this.edgeIndex.set(fromKey, new Set());
        }
        if (!this.edgeIndex.has(toKey)) {
            this.edgeIndex.set(toKey, new Set());
        }
        
        this.edgeIndex.get(fromKey)!.add(edge.id);
        this.edgeIndex.get(toKey)!.add(edge.id);
    }

    getEdge(id: string): GraphEdge | undefined {
        return this.edges.get(id);
    }

    deleteEdge(id: string): void {
        const edge = this.edges.get(id);
        if (edge) {
            this.edgeIndex.get(`from:${edge.from}`)?.delete(id);
            this.edgeIndex.get(`to:${edge.to}`)?.delete(id);
            this.edges.delete(id);
        }
    }

    // Query operations
    queryNodes(query: GraphQuery): GraphNode[] {
        let results: GraphNode[] = [];
        
        if (query.type) {
            const nodeIds = this.nodeIndex.get(query.type) || new Set();
            results = Array.from(nodeIds).map(id => this.nodes.get(id)!);
        } else {
            results = Array.from(this.nodes.values());
        }
        
        // Filter by properties
        if (query.properties) {
            results = results.filter(node => {
                return Object.entries(query.properties!).every(([key, value]) => {
                    return node.properties[key] === value;
                });
            });
        }
        
        // Filter by connections
        if (query.connected) {
            results = results.filter(node => {
                const edges = this.getNodeEdges(node.id, query.connected!.direction);
                return edges.some(edge => edge.type === query.connected!.type);
            });
        }
        
        return results;
    }

    getEdges(filter?: { from?: string; to?: string; type?: string }): GraphEdge[] {
        let results: GraphEdge[] = [];
        
        if (filter?.from) {
            const edgeIds = this.edgeIndex.get(`from:${filter.from}`) || new Set();
            results = Array.from(edgeIds).map(id => this.edges.get(id)!);
        } else if (filter?.to) {
            const edgeIds = this.edgeIndex.get(`to:${filter.to}`) || new Set();
            results = Array.from(edgeIds).map(id => this.edges.get(id)!);
        } else {
            results = Array.from(this.edges.values());
        }
        
        if (filter?.type) {
            results = results.filter(edge => edge.type === filter.type);
        }
        
        return results;
    }

    getNodeEdges(nodeId: string, direction: 'in' | 'out' | 'both' = 'both'): GraphEdge[] {
        const edges: GraphEdge[] = [];
        
        if (direction === 'out' || direction === 'both') {
            const outEdges = this.edgeIndex.get(`from:${nodeId}`) || new Set();
            outEdges.forEach(id => {
                const edge = this.edges.get(id);
                if (edge) edges.push(edge);
            });
        }
        
        if (direction === 'in' || direction === 'both') {
            const inEdges = this.edgeIndex.get(`to:${nodeId}`) || new Set();
            inEdges.forEach(id => {
                const edge = this.edges.get(id);
                if (edge) edges.push(edge);
            });
        }
        
        return edges;
    }

    // Path finding
    findPath(fromId: string, toId: string, maxDepth: number = 10): GraphNode[] | null {
        const visited = new Set<string>();
        const queue: { node: string; path: string[] }[] = [{ node: fromId, path: [fromId] }];
        
        while (queue.length > 0) {
            const { node, path } = queue.shift()!;
            
            if (path.length > maxDepth) continue;
            if (visited.has(node)) continue;
            visited.add(node);
            
            if (node === toId) {
                return path.map(id => this.nodes.get(id)!);
            }
            
            const edges = this.getEdges({ from: node });
            for (const edge of edges) {
                if (!visited.has(edge.to)) {
                    queue.push({ node: edge.to, path: [...path, edge.to] });
                }
            }
        }
        
        return null;
    }

    // Subgraph extraction
    getSubgraph(nodeIds: string[], includeEdges: boolean = true): {
        nodes: GraphNode[];
        edges: GraphEdge[];
    } {
        const nodeSet = new Set(nodeIds);
        const nodes = nodeIds.map(id => this.nodes.get(id)).filter(n => n) as GraphNode[];
        const edges: GraphEdge[] = [];
        
        if (includeEdges) {
            for (const edge of this.edges.values()) {
                if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) {
                    edges.push(edge);
                }
            }
        }
        
        return { nodes, edges };
    }

    // Analytics
    getNodeDegree(nodeId: string): { in: number; out: number; total: number } {
        const inEdges = this.edgeIndex.get(`to:${nodeId}`)?.size || 0;
        const outEdges = this.edgeIndex.get(`from:${nodeId}`)?.size || 0;
        
        return {
            in: inEdges,
            out: outEdges,
            total: inEdges + outEdges
        };
    }

    getConnectedComponents(): GraphNode[][] {
        const visited = new Set<string>();
        const components: GraphNode[][] = [];
        
        for (const node of this.nodes.values()) {
            if (!visited.has(node.id)) {
                const component = this.dfs(node.id, visited);
                components.push(component);
            }
        }
        
        return components;
    }

    private dfs(startId: string, visited: Set<string>): GraphNode[] {
        const stack = [startId];
        const component: GraphNode[] = [];
        
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (visited.has(nodeId)) continue;
            
            visited.add(nodeId);
            const node = this.nodes.get(nodeId);
            if (node) {
                component.push(node);
                
                const edges = this.getNodeEdges(nodeId);
                for (const edge of edges) {
                    const nextId = edge.from === nodeId ? edge.to : edge.from;
                    if (!visited.has(nextId)) {
                        stack.push(nextId);
                    }
                }
            }
        }
        
        return component;
    }

    // Serialization
    toJSON(): string {
        return JSON.stringify({
            nodes: Array.from(this.nodes.values()),
            edges: Array.from(this.edges.values())
        });
    }

    static fromJSON(json: string): GraphDatabase {
        const data = JSON.parse(json);
        const db = new GraphDatabase();
        
        for (const node of data.nodes) {
            db.addNode(node);
        }
        
        for (const edge of data.edges) {
            db.addEdge(edge);
        }
        
        return db;
    }

    // Statistics
    getStats(): {
        nodeCount: number;
        edgeCount: number;
        nodeTypes: Record<string, number>;
        avgDegree: number;
    } {
        const nodeTypes: Record<string, number> = {};
        let totalDegree = 0;
        
        for (const [type, nodes] of this.nodeIndex) {
            nodeTypes[type] = nodes.size;
        }
        
        for (const node of this.nodes.values()) {
            totalDegree += this.getNodeDegree(node.id).total;
        }
        
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.size,
            nodeTypes,
            avgDegree: this.nodes.size > 0 ? totalDegree / this.nodes.size : 0
        };
    }

    clear(): void {
        this.nodes.clear();
        this.edges.clear();
        this.nodeIndex.clear();
        this.edgeIndex.clear();
    }
}