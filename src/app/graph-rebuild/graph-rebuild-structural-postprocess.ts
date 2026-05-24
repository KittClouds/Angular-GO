import type {
    GraphRebuildEdge,
    GraphRebuildNode,
    GraphRebuildStructuralComponent,
    GraphRebuildStructuralEdge,
    GraphRebuildStructuralPostProcess,
} from './graph-rebuild-snapshot';

interface Neighbor {
    nodeId: string;
    edgeId: string;
}

export function buildGraphRebuildStructuralPostProcess(
    nodes: GraphRebuildNode[],
    edges: GraphRebuildEdge[],
): GraphRebuildStructuralPostProcess {
    const nodeIds = nodes.map((node) => node.id).sort();
    const nodeIdSet = new Set(nodeIds);
    const graph = buildAdjacency(nodeIdSet, edges);
    const componentByNode = new Map<string, string>();
    const components = buildComponents(nodeIds, graph, edges, componentByNode);
    const bridgeEdgeIds = findBridgeEdges(nodeIds, graph);
    const degreeByNode = new Map(nodeIds.map((id) => [id, graph.get(id)?.length || 0]));
    const hubFloor = Math.max(3, percentile([...degreeByNode.values()], 0.85));
    const structuralNodes = nodeIds.map((entityId) => {
        const degree = degreeByNode.get(entityId) || 0;
        const isBridgeNode = (graph.get(entityId) || []).some((neighbor) => bridgeEdgeIds.has(neighbor.edgeId));
        return {
            entityId,
            role: degree === 0
                ? 'isolated' as const
                : degree === 1
                    ? 'leaf' as const
                    : degree >= hubFloor
                        ? 'hub' as const
                        : isBridgeNode
                            ? 'bridge' as const
                            : 'connector' as const,
            degree,
            componentId: componentByNode.get(entityId) || `component:${entityId}`,
        };
    });
    const hubEntityIds = structuralNodes
        .filter((node) => node.role === 'hub')
        .map((node) => node.entityId)
        .sort();
    const structuralEdges = buildStructuralEdges(edges, componentByNode, bridgeEdgeIds, degreeByNode);

    return {
        schemaVersion: 'phoenix-graph-structure/v1',
        components,
        nodes: structuralNodes,
        edges: structuralEdges,
        hubEntityIds,
        bridgeEdgeIds: [...bridgeEdgeIds].sort(),
    };
}

function buildAdjacency(nodeIds: Set<string>, edges: GraphRebuildEdge[]): Map<string, Neighbor[]> {
    const graph = new Map<string, Neighbor[]>();
    for (const id of nodeIds) graph.set(id, []);
    for (const edge of edges) {
        if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId) || edge.sourceId === edge.targetId) continue;
        graph.get(edge.sourceId)?.push({ nodeId: edge.targetId, edgeId: edge.id });
        graph.get(edge.targetId)?.push({ nodeId: edge.sourceId, edgeId: edge.id });
    }
    for (const neighbors of graph.values()) {
        neighbors.sort((left, right) => left.nodeId.localeCompare(right.nodeId) || left.edgeId.localeCompare(right.edgeId));
    }
    return graph;
}

function buildComponents(
    nodeIds: string[],
    graph: Map<string, Neighbor[]>,
    edges: GraphRebuildEdge[],
    componentByNode: Map<string, string>,
): GraphRebuildStructuralComponent[] {
    const seen = new Set<string>();
    const components: GraphRebuildStructuralComponent[] = [];
    for (const root of nodeIds) {
        if (seen.has(root)) continue;
        const stack = [root];
        const members: string[] = [];
        seen.add(root);
        while (stack.length) {
            const nodeId = stack.pop()!;
            members.push(nodeId);
            for (const neighbor of graph.get(nodeId) || []) {
                if (seen.has(neighbor.nodeId)) continue;
                seen.add(neighbor.nodeId);
                stack.push(neighbor.nodeId);
            }
        }
        members.sort();
        const id = `component:${components.length}`;
        for (const nodeId of members) componentByNode.set(nodeId, id);
        const memberSet = new Set(members);
        const edgeIds = edges
            .filter((edge) => memberSet.has(edge.sourceId) && memberSet.has(edge.targetId))
            .map((edge) => edge.id)
            .sort();
        components.push({
            id,
            nodeIds: members,
            edgeIds,
            size: members.length,
            density: density(members.length, edgeIds.length),
        });
    }
    return components.sort((left, right) => right.size - left.size || left.id.localeCompare(right.id));
}

function findBridgeEdges(nodeIds: string[], graph: Map<string, Neighbor[]>): Set<string> {
    const visited = new Set<string>();
    const discovery = new Map<string, number>();
    const low = new Map<string, number>();
    const bridges = new Set<string>();
    let time = 0;

    const visit = (nodeId: string, parentEdgeId: string | null): void => {
        visited.add(nodeId);
        discovery.set(nodeId, time);
        low.set(nodeId, time);
        time += 1;
        for (const neighbor of graph.get(nodeId) || []) {
            if (neighbor.edgeId === parentEdgeId) continue;
            if (!visited.has(neighbor.nodeId)) {
                visit(neighbor.nodeId, neighbor.edgeId);
                low.set(nodeId, Math.min(low.get(nodeId)!, low.get(neighbor.nodeId)!));
                if (low.get(neighbor.nodeId)! > discovery.get(nodeId)!) bridges.add(neighbor.edgeId);
            } else {
                low.set(nodeId, Math.min(low.get(nodeId)!, discovery.get(neighbor.nodeId)!));
            }
        }
    };

    for (const nodeId of nodeIds) {
        if (!visited.has(nodeId)) visit(nodeId, null);
    }
    return bridges;
}

function buildStructuralEdges(
    edges: GraphRebuildEdge[],
    componentByNode: Map<string, string>,
    bridgeEdgeIds: Set<string>,
    degreeByNode: Map<string, number>,
): GraphRebuildStructuralEdge[] {
    return edges.map((edge) => {
        const bridge = bridgeEdgeIds.has(edge.id);
        const sourceDegree = degreeByNode.get(edge.sourceId) || 0;
        const targetDegree = degreeByNode.get(edge.targetId) || 0;
        return {
            edgeId: edge.id,
            role: bridge ? 'bridge' as const : sourceDegree >= 3 && targetDegree >= 3 ? 'backbone' as const : 'local' as const,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            componentId: componentByNode.get(edge.sourceId) || componentByNode.get(edge.targetId) || 'component:unknown',
        };
    }).sort((left, right) => left.role.localeCompare(right.role) || left.edgeId.localeCompare(right.edgeId));
}

function density(nodeCount: number, edgeCount: number): number {
    if (nodeCount < 2) return 0;
    return Number((edgeCount / ((nodeCount * (nodeCount - 1)) / 2)).toFixed(4));
}

function percentile(values: number[], quantile: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
    return sorted[index] || 0;
}
