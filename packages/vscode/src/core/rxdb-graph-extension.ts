/**
 * Graph Database extension for RxDB
 * Adds graph capabilities to the unified backend
 */

import { RxCollection, RxDocument } from 'rxdb';

// Graph-specific schemas
export const graphSchemas = {
    nodes: {
        version: 0,
        primaryKey: 'id',
        type: 'object',
        properties: {
            id: { type: 'string', maxLength: 200 },
            type: { type: 'string' },
            label: { type: 'string' },
            properties: { type: 'object' },
            // For code analysis
            filePath: { type: 'string' },
            line: { type: 'number' },
            column: { type: 'number' },
            // Embedding for semantic graph search
            embedding: {
                type: 'array',
                items: { type: 'number' }
            },
            created: { type: 'number' },
            updated: { type: 'number' }
        },
        required: ['id', 'type'],
        indexes: ['type', 'filePath', 'created'],
        methods: {
            // Get all edges for this node
            async getEdges(this: RxDocument): Promise<any[]> {
                const edges = await this.collection.database.collections.edges
                    .find()
                    .or([
                        { from: (this as any).id },
                        { to: (this as any).id }
                    ])
                    .exec();
                return edges;
            },
            
            // Get connected nodes
            async getConnected(this: RxDocument, direction: 'in' | 'out' | 'both' = 'both'): Promise<any[]> {
                const edges = await (this as any).getEdges();
                const nodeIds = new Set<string>();
                
                edges.forEach((edge: any) => {
                    if (direction === 'out' || direction === 'both') {
                        if (edge.from === (this as any).id) nodeIds.add(edge.to);
                    }
                    if (direction === 'in' || direction === 'both') {
                        if (edge.to === (this as any).id) nodeIds.add(edge.from);
                    }
                });
                
                const nodes = await Promise.all(
                    Array.from(nodeIds).map(id => 
                        this.collection.findOne(id).exec()
                    )
                );
                
                return nodes.filter(n => n);
            }
        }
    },
    
    edges: {
        version: 0,
        primaryKey: 'id',
        type: 'object',
        properties: {
            id: { type: 'string', maxLength: 200 },
            from: { 
                type: 'string',
                ref: 'nodes'
            },
            to: { 
                type: 'string',
                ref: 'nodes'
            },
            type: { type: 'string' },
            weight: { type: 'number' },
            properties: { type: 'object' },
            created: { type: 'number' }
        },
        required: ['id', 'from', 'to', 'type'],
        indexes: [
            'type',
            'from',
            'to',
            ['from', 'type'],
            ['to', 'type']
        ]
    }
};

// Graph algorithms
export class GraphAlgorithms {
    private nodes: RxCollection;
    private edges: RxCollection;
    
    constructor(nodes: RxCollection, edges: RxCollection) {
        this.nodes = nodes;
        this.edges = edges;
    }
    
    /**
     * Find shortest path between two nodes (Dijkstra)
     */
    async findShortestPath(startId: string, endId: string): Promise<any[] | null> {
        const distances = new Map<string, number>();
        const previous = new Map<string, string | null>();
        const unvisited = new Set<string>();
        
        // Initialize
        const allNodes = await this.nodes.find().exec();
        allNodes.forEach(node => {
            distances.set(node.id, Infinity);
            previous.set(node.id, null);
            unvisited.add(node.id);
        });
        
        distances.set(startId, 0);
        
        while (unvisited.size > 0) {
            // Find unvisited node with smallest distance
            let current: string | null = null;
            let minDistance = Infinity;
            
            for (const nodeId of unvisited) {
                const distance = distances.get(nodeId)!;
                if (distance < minDistance) {
                    current = nodeId;
                    minDistance = distance;
                }
            }
            
            if (!current || minDistance === Infinity) break;
            if (current === endId) break;
            
            unvisited.delete(current);
            
            // Get neighbors
            const edges = await this.edges
                .find()
                .where('from')
                .eq(current)
                .exec();
                
            for (const edge of edges) {
                if (!unvisited.has(edge.to)) continue;
                
                const alt = distances.get(current)! + (edge.weight || 1);
                if (alt < distances.get(edge.to)!) {
                    distances.set(edge.to, alt);
                    previous.set(edge.to, current);
                }
            }
        }
        
        // Reconstruct path
        if (previous.get(endId) === null && endId !== startId) {
            return null;
        }
        
        const path: string[] = [];
        let current: string | null = endId;
        
        while (current !== null) {
            path.unshift(current);
            current = previous.get(current) || null;
        }
        
        // Get node objects
        const nodeObjects = await Promise.all(
            path.map(id => this.nodes.findOne(id).exec())
        );
        
        return nodeObjects.filter(n => n);
    }
    
    /**
     * Find connected components
     */
    async findConnectedComponents(): Promise<any[][]> {
        const visited = new Set<string>();
        const components: any[][] = [];
        const allNodes = await this.nodes.find().exec();
        
        for (const node of allNodes) {
            if (!visited.has(node.id)) {
                const component = await this.dfs(node.id, visited);
                if (component.length > 0) {
                    components.push(component);
                }
            }
        }
        
        return components;
    }
    
    private async dfs(startId: string, visited: Set<string>): Promise<any[]> {
        const stack = [startId];
        const component: any[] = [];
        
        while (stack.length > 0) {
            const nodeId = stack.pop()!;
            if (visited.has(nodeId)) continue;
            
            visited.add(nodeId);
            const node = await this.nodes.findOne(nodeId).exec();
            if (node) {
                component.push(node);
                
                // Get connected nodes
                const edges = await this.edges
                    .find()
                    .or([
                        { from: nodeId },
                        { to: nodeId }
                    ])
                    .exec();
                    
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
    
    /**
     * Page Rank algorithm
     */
    async pageRank(iterations: number = 50, damping: number = 0.85): Promise<Map<string, number>> {
        const nodes = await this.nodes.find().exec();
        const nodeCount = nodes.length;
        const ranks = new Map<string, number>();
        
        // Initialize ranks
        nodes.forEach(node => {
            ranks.set(node.id, 1 / nodeCount);
        });
        
        // Iterate
        for (let i = 0; i < iterations; i++) {
            const newRanks = new Map<string, number>();
            
            for (const node of nodes) {
                let rank = (1 - damping) / nodeCount;
                
                // Get incoming edges
                const incomingEdges = await this.edges
                    .find()
                    .where('to')
                    .eq(node.id)
                    .exec();
                    
                for (const edge of incomingEdges) {
                    const fromNode = await this.nodes.findOne(edge.from).exec();
                    if (fromNode) {
                        // Count outgoing edges from source
                        const outgoingEdges = await this.edges
                            .find()
                            .where('from')
                            .eq(edge.from)
                            .exec();
                        const outgoingCount = outgoingEdges.length;
                            
                        rank += damping * (ranks.get(edge.from) || 0) / Math.max(outgoingCount, 1);
                    }
                }
                
                newRanks.set(node.id, rank);
            }
            
            // Update ranks
            newRanks.forEach((rank, id) => ranks.set(id, rank));
        }
        
        return ranks;
    }
    
    /**
     * Find clusters using Louvain community detection
     */
    async findCommunities(): Promise<Map<string, number>> {
        // Simplified community detection
        const communities = new Map<string, number>();
        const nodes = await this.nodes.find().exec();
        
        // Initialize each node in its own community
        nodes.forEach((node, index) => {
            communities.set(node.id, index);
        });
        
        // Iterative optimization (simplified)
        let improved = true;
        while (improved) {
            improved = false;
            
            for (const node of nodes) {
                const neighbors = await node.getConnected();
                const neighborCommunities = new Map<number, number>();
                
                // Count community occurrences in neighbors
                for (const neighbor of neighbors) {
                    const community = communities.get(neighbor.id);
                    if (community !== undefined) {
                        neighborCommunities.set(
                            community,
                            (neighborCommunities.get(community) || 0) + 1
                        );
                    }
                }
                
                // Find most common community
                let maxCount = 0;
                let bestCommunity = communities.get(node.id)!;
                
                neighborCommunities.forEach((count, community) => {
                    if (count > maxCount) {
                        maxCount = count;
                        bestCommunity = community;
                    }
                });
                
                // Update if different
                if (bestCommunity !== communities.get(node.id)) {
                    communities.set(node.id, bestCommunity);
                    improved = true;
                }
            }
        }
        
        return communities;
    }
}