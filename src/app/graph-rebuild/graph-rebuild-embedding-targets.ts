import type {
    BuildGraphRebuildSnapshotInput,
    GraphRebuildCausalEdge,
    GraphRebuildChunk,
    GraphRebuildEmbeddingTarget,
    GraphRebuildEntityAnchor,
    GraphRebuildEvent,
    GraphRebuildMemoryState,
    GraphRebuildNode,
    GraphRebuildRelationship,
    GraphRebuildTemporalEdge,
} from './graph-rebuild-snapshot';
import { summarizeMeaningFrame } from './graph-rebuild-meaning-frames';

export function buildGraphRebuildEmbeddingTargets(
    input: BuildGraphRebuildSnapshotInput,
    chunks: GraphRebuildChunk[],
    anchors: GraphRebuildEntityAnchor[],
    nodes: GraphRebuildNode[],
    relationships: GraphRebuildRelationship[],
    events: GraphRebuildEvent[],
    temporalEdges: GraphRebuildTemporalEdge[],
    causalEdges: GraphRebuildCausalEdge[],
    memoryState: GraphRebuildMemoryState[],
): GraphRebuildEmbeddingTarget[] {
    const targets: GraphRebuildEmbeddingTarget[] = [];
    const nodeByEntityId = new Map(nodes.map((node) => [node.entityId, node]));
    const noteIds = input.noteIds?.length ? input.noteIds : unique([...chunks.map((chunk) => chunk.noteId), ...anchors.map((anchor) => anchor.noteId)]);
    for (const noteId of noteIds) targets.push({ id: `embed:note:${noteId}`, kind: 'note', sourceId: noteId, noteId, label: `Note ${noteId}`, text: noteText(input, noteId), evidenceIds: [] });
    for (const chunk of chunks) targets.push({ id: `embed:chunk:${chunk.id}`, kind: 'chunk', sourceId: chunk.id, noteId: chunk.noteId, chunkId: chunk.id, label: `Chunk ${chunk.ordinal + 1}`, text: chunkText(input, chunk), evidenceIds: [] });
    for (const node of nodes) targets.push({ id: `embed:entity:${node.entityId}`, kind: 'entity', sourceId: node.entityId, entityId: node.entityId, entityKind: node.kind, label: node.label, text: [node.label, ...node.aliases].join(' '), evidenceIds: node.anchorIds });
    for (const anchor of anchors) targets.push({ id: `embed:anchor:${anchor.id}`, kind: 'anchor', sourceId: anchor.id, noteId: anchor.noteId, chunkId: anchor.chunkId, entityId: anchor.entityId, entityKind: nodeByEntityId.get(anchor.entityId)?.kind, label: anchor.surface, text: anchor.surface, evidenceIds: [anchor.id] });
    for (const relationship of relationships) {
        if (relationship.status === 'rejected') continue;
        targets.push({
            id: `embed:graph-fact:${relationship.id}`,
            kind: 'graphFact',
            sourceId: relationship.id,
            label: `${relationship.sourceEntityId} ${relationship.relationType} ${relationship.targetEntityId}`,
            text: `${relationship.sourceEntityId} ${relationship.relationType} ${relationship.targetEntityId} [${relationship.status}]`,
            evidenceIds: relationship.evidenceAnchorIds,
        });
    }
    for (const event of events) targets.push({ id: `embed:event:${event.id}`, kind: 'event', sourceId: event.id, noteId: event.noteId, chunkId: event.chunkId, entityId: event.entityIds[0], label: event.label, text: eventText(event), evidenceIds: event.evidenceAnchorIds });
    for (const edge of temporalEdges) targets.push(temporalTarget(edge, 'temporalFact'));
    for (const edge of causalEdges) targets.push(temporalTarget(edge, 'causalFact'));
    for (const state of memoryState) targets.push({ id: `embed:memory:${state.id}`, kind: 'memoryState', sourceId: state.id, noteId: state.noteId, entityId: state.entityId, label: state.key, text: `${state.key} ${state.value}`, evidenceIds: state.evidenceIds });
    return targets;
}

function temporalTarget(edge: GraphRebuildTemporalEdge, kind: string): GraphRebuildEmbeddingTarget {
    return {
        id: `embed:${kind}:${edge.id}`,
        kind,
        sourceId: edge.id,
        label: edge.relationType,
        text: `${edge.sourceId} ${edge.relationType} ${edge.targetId}`,
        evidenceIds: edge.evidenceIds,
    };
}

function noteText(input: BuildGraphRebuildSnapshotInput, noteId: string): string {
    const text = input.noteTexts?.[noteId]?.trim();
    return text ? text.slice(0, 12000) : `note:${noteId}`;
}

function chunkText(input: BuildGraphRebuildSnapshotInput, chunk: GraphRebuildChunk): string {
    const text = input.noteTexts?.[chunk.noteId];
    const slice = text?.slice(chunk.start, chunk.end).trim();
    const fallback = slice || `${chunk.noteId}:${chunk.start}-${chunk.end}`;
    const frameSummary = summarizeMeaningFrame(chunk.meaningFrame);
    return [fallback, frameSummary].filter(Boolean).join('\n\n');
}

function eventText(event: GraphRebuildEvent): string {
    if (!event.aspect) return event.label;
    const cues = event.aspect.cues.length ? ` cues:${event.aspect.cues.join(',')}` : '';
    return `${event.label}\naspect:${event.aspect.kind} completion:${event.aspect.completion}${cues}`;
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}
