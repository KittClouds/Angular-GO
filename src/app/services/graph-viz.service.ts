/**
 * GraphVizService - Transforms graph data for 3d-force-graph visualization
 * 
 * Converts GoKitt/CozoDB graph structures into the { nodes, links } format
 * expected by 3d-force-graph library.
 * 
 * Uses EntityColorStore for consistent entity coloring across the app.
 */

import { Injectable, inject } from '@angular/core';
import type { GoKittGraphData } from './gokitt.service';
import { graphRegistry } from '../lib/cozo/graph';
import { entityColorStore, DEFAULT_ENTITY_COLORS } from '../lib/store/entityColorStore';
import type { EntityKind } from '../lib/Scanner/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types for 3d-force-graph consumption
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNode {
    id: string;
    name: string;          // Display label
    val?: number;          // Node size (based on mentions)
    color?: string;        // Hex color from EntityColorStore
    kind?: string;         // Entity kind for grouping
    group?: number;        // Numeric group for clustering
    narrativeId?: string;  // Scope
}

export interface GraphLink {
    source: string;        // Source node ID
    target: string;        // Target node ID
    type?: string;         // Edge type (KNOWS, VISITS, etc.)
    color?: string;        // Hex color for edge
    curvature?: number;    // For parallel edges
    value?: number;        // Edge weight/confidence
}

export interface ForceGraphData {
    nodes: GraphNode[];
    links: GraphLink[];
    stats?: GraphStats;
}

export interface GraphStats {
    totalNodes: number;
    totalLinks: number;
    kindCounts: Record<string, number>;
    typeCounts: Record<string, number>;
}

export interface GraphQueryOptions {
    narrativeId?: string;
    maxNodes?: number;
    includeOrphans?: boolean;
    kindFilter?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity Kind → Numeric Group mapping (for clustering)
// ─────────────────────────────────────────────────────────────────────────────

const KIND_TO_GROUP: Record<string, number> = {
    CHARACTER: 1,
    NPC: 1,
    CREATURE: 1,
    LOCATION: 2,
    FACTION: 3,
    ORGANIZATION: 3,
    NETWORK: 3,
    ITEM: 4,
    EVENT: 5,
    SCENE: 5,
    BEAT: 5,
    CONCEPT: 6,
    NARRATIVE: 7,
    ARC: 7,
    ACT: 7,
    CHAPTER: 7,
    TIMELINE: 8,
    CUSTOM: 9,
    UNKNOWN: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// HSL → Hex conversion (for WebGL compatibility)
// ─────────────────────────────────────────────────────────────────────────────

function hslToHex(hslString: string): string {
    // Parse "280 70% 60%" format
    const parts = hslString.split(' ');
    if (parts.length < 3) return '#64748b'; // Slate fallback

    const h = parseFloat(parts[0]) / 360;
    const s = parseFloat(parts[1].replace('%', '')) / 100;
    const l = parseFloat(parts[2].replace('%', '')) / 100;

    let r: number, g: number, b: number;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (x: number) => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphVizService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class GraphVizService {
    // Cache hex colors converted from EntityColorStore
    private colorCache: Map<string, string> = new Map();

    constructor() {
        console.log('[GraphVizService] Initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Color Management (uses EntityColorStore)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get hex color for an entity kind
     * Uses EntityColorStore for consistency, converts HSL → Hex for WebGL
     */
    getNodeColor(kind: string): string {
        const normalizedKind = kind?.toUpperCase() || 'UNKNOWN';

        // Check cache first
        if (this.colorCache.has(normalizedKind)) {
            return this.colorCache.get(normalizedKind)!;
        }

        // Get HSL from EntityColorStore and convert to hex
        const hsl = entityColorStore.getRawHsl(normalizedKind as EntityKind);
        const hex = hslToHex(hsl);

        this.colorCache.set(normalizedKind, hex);
        return hex;
    }

    /**
     * Get hex color for an edge type
     * Default: slate gray, can be customized per type
     */
    getEdgeColor(type?: string): string {
        // Default edge color - semi-transparent slate
        return '#94a3b8';
    }

    /**
     * Clear color cache (call if EntityColorStore changes)
     */
    refreshColors(): void {
        this.colorCache.clear();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Transform GoKitt Scan Result → ForceGraphData
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Transform a GoKitt scan result into 3d-force-graph format
     * @param scanResult - Result from GoKittService.scan()
     */
    fromScanResult(scanResult: any): ForceGraphData {
        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const kindCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};

        if (!scanResult?.graph) {
            console.warn('[GraphVizService.fromScanResult] No graph in scan result');
            return { nodes, links, stats: { totalNodes: 0, totalLinks: 0, kindCounts, typeCounts } };
        }

        const graphNodes = scanResult.graph.nodes || scanResult.graph.Nodes || {};
        const graphEdges = scanResult.graph.edges || scanResult.graph.Edges || [];

        // Build ID mapping for edge resolution
        const idMapping = new Map<string, string>();

        // Process nodes
        for (const [id, node] of Object.entries(graphNodes) as [string, any][]) {
            const label = node.Label || node.label || id;
            const kind = (node.Kind || node.kind || 'UNKNOWN').toUpperCase();
            const mentions = node.Mentions || node.mentions || node.MentionCount || 1;

            // Track kind counts
            kindCounts[kind] = (kindCounts[kind] || 0) + 1;

            idMapping.set(id, id);

            nodes.push({
                id,
                name: label,
                kind,
                val: Math.max(1, Math.log(mentions + 1) * 3), // Log scale for size
                color: this.getNodeColor(kind),
                group: KIND_TO_GROUP[kind] ?? 0,
            });
        }

        // Process edges
        for (const edge of graphEdges) {
            const sourceId = edge.Source || edge.source;
            const targetId = edge.Target || edge.target;
            const edgeType = (edge.Type || edge.type || 'RELATED_TO').toUpperCase();
            const confidence = edge.Confidence ?? edge.confidence ?? 1;

            // Track type counts
            typeCounts[edgeType] = (typeCounts[edgeType] || 0) + 1;

            // Only add edge if both nodes exist
            if (idMapping.has(sourceId) && idMapping.has(targetId)) {
                links.push({
                    source: sourceId,
                    target: targetId,
                    type: edgeType,
                    color: this.getEdgeColor(edgeType),
                    value: confidence,
                });
            }
        }

        const stats: GraphStats = {
            totalNodes: nodes.length,
            totalLinks: links.length,
            kindCounts,
            typeCounts,
        };

        console.log('[GraphVizService.fromScanResult] Transformed:', stats);

        return { nodes, links, stats };
    }

    /**
     * Transform GoKittGraphData (from signal) directly into ForceGraphData
     * This is the PRIMARY method for graph visualization
     */
    fromGoKittData(graphData: GoKittGraphData): ForceGraphData {
        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const kindCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};

        // Build ID mapping for edge resolution
        const idMapping = new Set<string>();

        // Process nodes
        for (const [id, node] of Object.entries(graphData.nodes)) {
            const label = node.Label || node.label || id;
            const kind = (node.Kind || node.kind || 'UNKNOWN').toUpperCase();

            // Track kind counts
            kindCounts[kind] = (kindCounts[kind] || 0) + 1;
            idMapping.add(id);

            nodes.push({
                id,
                name: label,
                kind,
                val: 3, // Default size
                color: this.getNodeColor(kind),
                group: KIND_TO_GROUP[kind] ?? 0,
            });
        }

        // Process edges
        for (const edge of graphData.edges) {
            const sourceId = edge.Source || edge.source || '';
            const targetId = edge.Target || edge.target || '';
            const edgeType = (edge.Type || edge.type || edge.relation || 'RELATED_TO').toUpperCase();
            const confidence = edge.Confidence ?? edge.confidence ?? edge.weight ?? 1;

            // Track type counts
            typeCounts[edgeType] = (typeCounts[edgeType] || 0) + 1;

            // Only add edge if both nodes exist
            if (idMapping.has(sourceId) && idMapping.has(targetId)) {
                links.push({
                    source: sourceId,
                    target: targetId,
                    type: edgeType,
                    color: this.getEdgeColor(edgeType),
                    value: confidence,
                });
            } else {
                console.warn(`[GraphVizService.fromGoKittData] Skipping edge: ${sourceId} → ${targetId} (node not found)`);
            }
        }

        const stats: GraphStats = {
            totalNodes: nodes.length,
            totalLinks: links.length,
            kindCounts,
            typeCounts,
        };

        console.log('[GraphVizService.fromGoKittData] Transformed:', stats);

        return { nodes, links, stats };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Transform CozoDB → ForceGraphData (FALLBACK)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get full graph from CozoDB
     * @param options - Query options for filtering
     */
    fromCozoDB(options?: GraphQueryOptions): ForceGraphData {
        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const kindCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};

        // Get all entities from CozoDB
        const allEntities = graphRegistry.getAllEntities();
        const entityIds = new Set<string>();

        console.log(`[GraphVizService.fromCozoDB] Total entities from CozoDB: ${allEntities.length}`);

        for (const entity of allEntities) {
            // Apply filters
            if (options?.narrativeId && entity.narrativeId !== options.narrativeId) {
                continue;
            }
            if (options?.kindFilter && !options.kindFilter.includes(entity.kind)) {
                continue;
            }
            if (options?.maxNodes && nodes.length >= options.maxNodes) {
                break;
            }

            const kind = entity.kind.toUpperCase();
            kindCounts[kind] = (kindCounts[kind] || 0) + 1;
            entityIds.add(entity.id);

            nodes.push({
                id: entity.id,
                name: entity.label,
                kind,
                val: Math.max(1, Math.log((entity.totalMentions || 1) + 1) * 3),
                color: this.getNodeColor(kind),
                group: KIND_TO_GROUP[kind] ?? 0,
                narrativeId: entity.narrativeId,
            });
        }

        // Get all relationships
        const allRelationships = graphRegistry.getAllRelationshipsSync();
        console.log(`[GraphVizService.fromCozoDB] Total relationships from CozoDB: ${allRelationships.length}`);

        for (const rel of allRelationships) {
            // Apply filters
            if (options?.narrativeId && rel.narrativeId !== options.narrativeId) {
                continue;
            }

            // Only include edges where both nodes are in the graph
            const hasSource = entityIds.has(rel.sourceId);
            const hasTarget = entityIds.has(rel.targetId);
            if (!hasSource || !hasTarget) {
                console.warn(`[GraphVizService] Edge filtered: ${rel.type} | source(${rel.sourceId}): ${hasSource}, target(${rel.targetId}): ${hasTarget}`);
                if (!options?.includeOrphans) continue;
            }

            const edgeType = rel.type.toUpperCase();
            typeCounts[edgeType] = (typeCounts[edgeType] || 0) + 1;

            links.push({
                source: rel.sourceId,
                target: rel.targetId,
                type: edgeType,
                color: this.getEdgeColor(edgeType),
                value: rel.confidence,
            });
        }

        const stats: GraphStats = {
            totalNodes: nodes.length,
            totalLinks: links.length,
            kindCounts,
            typeCounts,
        };

        console.log('[GraphVizService.fromCozoDB] Loaded:', stats);

        return { nodes, links, stats };
    }

    /**
     * Convenience method: Get full graph
     */
    getFullGraph(): ForceGraphData {
        return this.fromCozoDB();
    }

    /**
     * Convenience method: Get graph scoped to a narrative
     */
    getScopedGraph(narrativeId: string): ForceGraphData {
        return this.fromCozoDB({ narrativeId });
    }
}
