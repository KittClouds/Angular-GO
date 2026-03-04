/**
 * GraphScanner — Calls GoKittService.scan() to build the narrative graph.
 * Extracts edges and pushes them to the Registry.
 * No ProseMirror dependency. No highlighting logic.
 */
import type { GoKittService, ProvenanceContext } from '../../services/gokitt.service';

export interface GraphNode {
    id: string;
    label: string;
    kind: string;
}

export interface GraphEdge {
    sourceId: string;
    targetId: string;
    relation: string;
}

export interface GraphResult {
    nodes: GraphNode[];
    edges: GraphEdge[];
    timingUs: number;
    raw: any; // Full result for consumers that need it
}

export interface GraphSink {
    /** Push a relationship into the Registry */
    upsertRelationship(rel: {
        source: string;
        target: string;
        type: string;
        sourceNote?: string;
    }): void;
}

export class GraphScanner {
    constructor(
        private readonly goKitt: GoKittService,
        private readonly sink: GraphSink,
    ) { }

    /**
     * Run the full Reality Layer scan (CST → Projection → Graph).
     * Extracts nodes and edges, pushes relationships to the sink.
     */
    async buildGraph(
        text: string,
        noteId: string,
        provenance?: ProvenanceContext,
    ): Promise<GraphResult> {
        if (!text || text.length === 0) {
            return { nodes: [], edges: [], timingUs: 0, raw: null };
        }

        try {
            const result = await this.goKitt.scan(text, provenance);

            if (!result || !result.graph) {
                return { nodes: [], edges: [], timingUs: result?.timing_us ?? 0, raw: result };
            }

            // Extract nodes
            const rawNodes = result.graph.Nodes || result.graph.nodes || {};
            const nodes: GraphNode[] = Object.values(rawNodes).map((n: any) => ({
                id: n.ID || n.id,
                label: n.Label || n.label || n.ID || n.id,
                kind: n.Kind || n.kind || 'Concept',
            }));

            // Extract edges and push to sink
            const rawEdges = result.graph.Edges || result.graph.edges || [];
            const edges: GraphEdge[] = [];

            for (const edge of rawEdges) {
                const sourceId = edge.Source?.ID || edge.Source;
                const targetId = edge.Target?.ID || edge.Target;
                const relType = edge.Relation;

                if (sourceId && targetId && relType) {
                    edges.push({ sourceId, targetId, relation: relType });

                    this.sink.upsertRelationship({
                        source: sourceId,
                        target: targetId,
                        type: relType,
                        sourceNote: noteId,
                    });
                }
            }

            console.log(`[GraphScanner] Built graph: ${nodes.length} nodes, ${edges.length} edges`);

            return {
                nodes,
                edges,
                timingUs: result.timing_us ?? 0,
                raw: result,
            };
        } catch (e) {
            console.error('[GraphScanner] Graph scan error:', e);
            return { nodes: [], edges: [], timingUs: 0, raw: null };
        }
    }
}
