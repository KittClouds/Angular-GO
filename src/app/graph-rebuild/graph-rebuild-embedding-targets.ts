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

const MAX_EMBEDDING_TARGETS = 960;
const NOTE_TARGET_BUDGET = 32;
const ENTITY_TARGET_BUDGET = 320;
const RELATION_TARGET_BUDGET = 192;
const STORY_EDGE_TARGET_BUDGET = 128;
const EVENT_TARGET_BUDGET = 96;
const MEMORY_TARGET_BUDGET = 96;
const CHUNK_TARGET_BUDGET = 160;
const ANCHOR_TARGET_BUDGET = 192;

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
    const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
    const anchorsByEntityId = groupAnchorsByEntity(anchors);
    const anchorsByChunkId = groupAnchorsByChunk(anchors);
    const eventById = new Map(events.map((event) => [event.id, event]));
    const noteIds = input.noteIds?.length ? input.noteIds : unique([...chunks.map((chunk) => chunk.noteId), ...anchors.map((anchor) => anchor.noteId)]);
    for (const noteId of noteIds) targets.push({ id: `embed:note:${noteId}`, kind: 'note', sourceId: noteId, noteId, label: `Note ${noteId}`, text: noteText(input, noteId), evidenceIds: [] });
    for (const chunk of chunks) targets.push({ id: `embed:chunk:${chunk.id}`, kind: 'chunk', sourceId: chunk.id, noteId: chunk.noteId, chunkId: chunk.id, label: `Chunk ${chunk.ordinal + 1}`, text: chunkText(input, chunk, anchorsByChunkId.get(chunk.id) || [], nodeByEntityId), evidenceIds: [] });
    for (const node of nodes) targets.push({ id: `embed:entity:${node.entityId}`, kind: 'entity', sourceId: node.entityId, entityId: node.entityId, entityKind: node.kind, label: node.label, text: entityText(input, node, anchorsByEntityId.get(node.entityId) || []), evidenceIds: node.anchorIds });
    for (const anchor of anchors) targets.push({ id: `embed:anchor:${anchor.id}`, kind: 'anchor', sourceId: anchor.id, noteId: anchor.noteId, chunkId: anchor.chunkId, entityId: anchor.entityId, entityKind: nodeByEntityId.get(anchor.entityId)?.kind, label: anchor.surface, text: anchorText(input, anchor, nodeByEntityId.get(anchor.entityId)), evidenceIds: [anchor.id] });
    for (const relationship of relationships) {
        if (relationship.status === 'rejected') continue;
        const sourceLabel = entityLabel(relationship.sourceEntityId, nodeByEntityId);
        const targetLabel = entityLabel(relationship.targetEntityId, nodeByEntityId);
        targets.push({
            id: `embed:graph-fact:${relationship.id}`,
            kind: 'graphFact',
            sourceId: relationship.id,
            label: `${sourceLabel} ${relationship.relationType} ${targetLabel}`,
            text: relationshipText(input, relationship, nodeByEntityId, anchorById),
            evidenceIds: relationship.evidenceAnchorIds,
        });
    }
    for (const event of events) targets.push({ id: `embed:event:${event.id}`, kind: 'event', sourceId: event.id, noteId: event.noteId, chunkId: event.chunkId, entityId: event.entityIds[0], label: event.label, text: eventText(input, event, nodeByEntityId, anchorById), evidenceIds: event.evidenceAnchorIds });
    for (const edge of temporalEdges) targets.push(temporalTarget(input, edge, 'temporalFact', eventById, anchorById));
    for (const edge of causalEdges) targets.push(temporalTarget(input, edge, 'causalFact', eventById, anchorById));
    for (const state of memoryState) targets.push({ id: `embed:memory:${state.id}`, kind: 'memoryState', sourceId: state.id, noteId: state.noteId, entityId: state.entityId, label: state.key, text: memoryText(input, state, nodeByEntityId, anchorById), evidenceIds: state.evidenceIds });
    return selectEmbeddingTargets(targets, relationships, temporalEdges, causalEdges);
}

function selectEmbeddingTargets(
    targets: GraphRebuildEmbeddingTarget[],
    relationships: GraphRebuildRelationship[],
    temporalEdges: GraphRebuildTemporalEdge[],
    causalEdges: GraphRebuildCausalEdge[],
): GraphRebuildEmbeddingTarget[] {
    if (targets.length <= MAX_EMBEDDING_TARGETS) return targets;
    const selected = new Map<string, GraphRebuildEmbeddingTarget>();
    const byKind = groupTargetsByKind(targets);
    const entityById = new Map((byKind.get('entity') || []).map((target) => [target.entityId || target.sourceId, target]));
    const eventById = new Map((byKind.get('event') || []).map((target) => [target.sourceId, target]));
    const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
    const storyEdgeById = new Map([...temporalEdges, ...causalEdges].map((edge) => [edge.id, edge]));

    const addGroup = (group: Array<GraphRebuildEmbeddingTarget | undefined>): boolean => {
        const missing = group.filter((target): target is GraphRebuildEmbeddingTarget => !!target && !selected.has(target.id));
        if (selected.size + missing.length > MAX_EMBEDDING_TARGETS) return false;
        for (const target of missing) selected.set(target.id, target);
        return true;
    };
    const addMany = (values: GraphRebuildEmbeddingTarget[], budget: number): void => {
        for (const target of values.slice(0, budget)) addGroup([target]);
    };

    addMany(ranked(byKind.get('note') || []), NOTE_TARGET_BUDGET);
    addMany(ranked(byKind.get('entity') || []), ENTITY_TARGET_BUDGET);
    for (const target of ranked(byKind.get('graphfact') || []).slice(0, RELATION_TARGET_BUDGET)) {
        const relationship = relationshipById.get(target.sourceId);
        addGroup([
            target,
            relationship ? entityById.get(relationship.sourceEntityId) : undefined,
            relationship ? entityById.get(relationship.targetEntityId) : undefined,
        ]);
    }
    for (const target of ranked([...(byKind.get('temporalfact') || []), ...(byKind.get('causalfact') || [])]).slice(0, STORY_EDGE_TARGET_BUDGET)) {
        const edge = storyEdgeById.get(target.sourceId);
        addGroup([
            target,
            edge ? eventById.get(edge.sourceId) : undefined,
            edge ? eventById.get(edge.targetId) : undefined,
        ]);
    }
    addMany(ranked(byKind.get('event') || []), EVENT_TARGET_BUDGET);
    for (const target of ranked(byKind.get('memorystate') || []).slice(0, MEMORY_TARGET_BUDGET)) {
        addGroup([target, target.entityId ? entityById.get(target.entityId) : undefined]);
    }
    addMany(ranked(byKind.get('chunk') || []), CHUNK_TARGET_BUDGET);
    for (const target of representativeAnchors(byKind.get('anchor') || []).slice(0, ANCHOR_TARGET_BUDGET)) {
        addGroup([target, target.entityId ? entityById.get(target.entityId) : undefined]);
    }
    return [...selected.values()];
}

function groupTargetsByKind(targets: GraphRebuildEmbeddingTarget[]): Map<string, GraphRebuildEmbeddingTarget[]> {
    const groups = new Map<string, GraphRebuildEmbeddingTarget[]>();
    for (const target of targets) {
        const kind = normalizeKind(target.kind);
        groups.set(kind, [...(groups.get(kind) || []), target]);
    }
    return groups;
}

function representativeAnchors(targets: GraphRebuildEmbeddingTarget[]): GraphRebuildEmbeddingTarget[] {
    const perEntity = new Map<string, GraphRebuildEmbeddingTarget[]>();
    for (const target of ranked(targets)) {
        const key = target.entityId || target.sourceId;
        const bucket = perEntity.get(key) || [];
        if (bucket.length >= 3) continue;
        bucket.push(target);
        perEntity.set(key, bucket);
    }
    return [...perEntity.values()].flat().sort(targetOrder);
}

function ranked(targets: GraphRebuildEmbeddingTarget[]): GraphRebuildEmbeddingTarget[] {
    return [...targets].sort(targetOrder);
}

function targetOrder(left: GraphRebuildEmbeddingTarget, right: GraphRebuildEmbeddingTarget): number {
    return targetScore(right) - targetScore(left) || left.id.localeCompare(right.id);
}

function targetScore(target: GraphRebuildEmbeddingTarget): number {
    const kind = normalizeKind(target.kind);
    let score =
        kind === 'entity' ? 900 :
        kind === 'graphfact' ? 840 :
        kind === 'causalfact' ? 830 :
        kind === 'temporalfact' ? 810 :
        kind === 'event' ? 780 :
        kind === 'memorystate' ? 720 :
        kind === 'note' ? 680 :
        kind === 'chunk' ? 620 :
        kind === 'anchor' ? 540 : 500;
    const text = `${target.label} ${target.text}`.toLowerCase();
    if (text.includes('[accepted]')) score += 90;
    if (text.includes('[review]')) score += 34;
    if (/command|authority|causal|cause|because|before|after|temporal|approved|accepted|warn|co_occurs_with/.test(text)) score += 44;
    if (/chunk_role:(authority_chain|evidence_block|transition)/.test(text)) score += 36;
    if (/meaning_cues:|entity_priors:/.test(text)) score += 18;
    if (/evidence_context:/.test(text)) score += 42;
    if (/source:(manual_tag|accepted_suggestion|dictionary_match|machine_evidence|machine_suggestion)/.test(text)) score += 24;
    const mentionMatch = text.match(/mentions:(\d+)/);
    if (mentionMatch) score += Math.min(64, Number(mentionMatch[1]) * 2);
    const confidenceMatch = text.match(/confidence:([0-9.]+)/);
    if (confidenceMatch) score += Math.round(clamp(Number(confidenceMatch[1]), 0, 1) * 48);
    score += Math.min(48, target.evidenceIds.length * 6);
    if (target.entityKind) score += 8;
    return score;
}

function normalizeKind(kind: string): string {
    return String(kind || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[-_\s]+/g, '');
}

function temporalTarget(
    input: BuildGraphRebuildSnapshotInput,
    edge: GraphRebuildTemporalEdge,
    kind: string,
    eventById: Map<string, GraphRebuildEvent>,
    anchorById: Map<string, GraphRebuildEntityAnchor>,
): GraphRebuildEmbeddingTarget {
    const source = eventById.get(edge.sourceId);
    const target = eventById.get(edge.targetId);
    return {
        id: `embed:${kind}:${edge.id}`,
        kind,
        sourceId: edge.id,
        label: edge.relationType,
        text: limitText([
            `${source?.label || edge.sourceId} ${edge.relationType} ${target?.label || edge.targetId}`,
            `confidence:${edge.confidence.toFixed(2)}`,
            ...evidenceContexts(input, edge.evidenceIds, anchorById, 4).map((context) => `evidence_context:${context}`),
        ].filter(Boolean).join('\n'), 1800),
        evidenceIds: edge.evidenceIds,
    };
}

function noteText(input: BuildGraphRebuildSnapshotInput, noteId: string): string {
    const text = input.noteTexts?.[noteId]?.trim();
    return text ? text.slice(0, 12000) : `note:${noteId}`;
}

function chunkText(
    input: BuildGraphRebuildSnapshotInput,
    chunk: GraphRebuildChunk,
    anchors: GraphRebuildEntityAnchor[],
    nodeByEntityId: Map<string, GraphRebuildNode>,
): string {
    const text = input.noteTexts?.[chunk.noteId];
    const slice = text?.slice(chunk.start, chunk.end).trim();
    const fallback = slice || `${chunk.noteId}:${chunk.start}-${chunk.end}`;
    const frameSummary = summarizeMeaningFrame(chunk.meaningFrame);
    const entitySummary = unique(anchors.map((anchor) => entityLabel(anchor.entityId, nodeByEntityId))).slice(0, 16).join(', ');
    return limitText([
        fallback,
        frameSummary,
        entitySummary ? `entities:${entitySummary}` : '',
    ].filter(Boolean).join('\n\n'), 2600);
}

function entityText(
    input: BuildGraphRebuildSnapshotInput,
    node: GraphRebuildNode,
    anchors: GraphRebuildEntityAnchor[],
): string {
    const aliases = node.aliases.length ? `aliases:${node.aliases.join(', ')}` : '';
    return limitText([
        node.label,
        aliases,
        `kind:${node.kind} mentions:${node.totalMentions} notes:${node.noteIds.length}`,
        ...representativeAnchorContexts(input, anchors, 4).map((context) => `evidence_context:${context}`),
    ].filter(Boolean).join('\n'), 1800);
}

function anchorText(
    input: BuildGraphRebuildSnapshotInput,
    anchor: GraphRebuildEntityAnchor,
    node: GraphRebuildNode | undefined,
): string {
    return limitText([
        anchor.surface,
        `entity:${node?.label || anchor.entityId}`,
        `kind:${node?.kind || ''} source:${anchor.source} confidence:${anchor.confidence.toFixed(2)}`,
        `evidence_context:${anchorContext(input, anchor)}`,
    ].filter(Boolean).join('\n'), 900);
}

function relationshipText(
    input: BuildGraphRebuildSnapshotInput,
    relationship: GraphRebuildRelationship,
    nodeByEntityId: Map<string, GraphRebuildNode>,
    anchorById: Map<string, GraphRebuildEntityAnchor>,
): string {
    const sourceLabel = entityLabel(relationship.sourceEntityId, nodeByEntityId);
    const targetLabel = entityLabel(relationship.targetEntityId, nodeByEntityId);
    return limitText([
        `${sourceLabel} ${relationship.relationType} ${targetLabel} [${relationship.status}]`,
        `confidence:${relationship.confidence.toFixed(2)} source:${relationship.adjudicationSource}`,
        relationship.rationale,
        relationship.decisionEvidence.length ? `decision:${relationship.decisionEvidence.slice(0, 6).join(' ')}` : '',
        ...evidenceContexts(input, relationship.evidenceAnchorIds, anchorById, 4).map((context) => `evidence_context:${context}`),
    ].filter(Boolean).join('\n'), 2200);
}

function eventText(
    input: BuildGraphRebuildSnapshotInput,
    event: GraphRebuildEvent,
    nodeByEntityId: Map<string, GraphRebuildNode>,
    anchorById: Map<string, GraphRebuildEntityAnchor>,
): string {
    const entitySummary = event.entityIds.map((id) => entityLabel(id, nodeByEntityId)).join(', ');
    const base = [
        event.label,
        entitySummary ? `entities:${entitySummary}` : '',
        `confidence:${event.confidence.toFixed(2)}`,
    ];
    if (!event.aspect) {
        return limitText([
            ...base,
            ...evidenceContexts(input, event.evidenceAnchorIds, anchorById, 4).map((context) => `evidence_context:${context}`),
        ].filter(Boolean).join('\n'), 1800);
    }
    const cues = event.aspect.cues.length ? ` cues:${event.aspect.cues.join(',')}` : '';
    return limitText([
        ...base,
        `aspect:${event.aspect.kind} completion:${event.aspect.completion}${cues}`,
        ...evidenceContexts(input, event.evidenceAnchorIds, anchorById, 4).map((context) => `evidence_context:${context}`),
    ].filter(Boolean).join('\n'), 1800);
}

function memoryText(
    input: BuildGraphRebuildSnapshotInput,
    state: GraphRebuildMemoryState,
    nodeByEntityId: Map<string, GraphRebuildNode>,
    anchorById: Map<string, GraphRebuildEntityAnchor>,
): string {
    return limitText([
        `${entityLabel(state.entityId, nodeByEntityId)} ${state.key} ${state.value}`,
        `memory_key:${state.key}`,
        ...evidenceContexts(input, state.evidenceIds, anchorById, 3).map((context) => `evidence_context:${context}`),
    ].filter(Boolean).join('\n'), 1400);
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function groupAnchorsByEntity(anchors: GraphRebuildEntityAnchor[]): Map<string, GraphRebuildEntityAnchor[]> {
    const groups = new Map<string, GraphRebuildEntityAnchor[]>();
    for (const anchor of anchors) groups.set(anchor.entityId, [...(groups.get(anchor.entityId) || []), anchor]);
    return groups;
}

function groupAnchorsByChunk(anchors: GraphRebuildEntityAnchor[]): Map<string, GraphRebuildEntityAnchor[]> {
    const groups = new Map<string, GraphRebuildEntityAnchor[]>();
    for (const anchor of anchors) {
        if (!anchor.chunkId) continue;
        groups.set(anchor.chunkId, [...(groups.get(anchor.chunkId) || []), anchor]);
    }
    return groups;
}

function representativeAnchorContexts(
    input: BuildGraphRebuildSnapshotInput,
    anchors: GraphRebuildEntityAnchor[],
    max: number,
): string[] {
    const out: string[] = [];
    const seenScopes = new Set<string>();
    for (const anchor of [...anchors].sort(anchorOrder)) {
        const scope = anchor.chunkId || `${anchor.noteId}:${Math.floor(anchor.sourceStart / 1200)}`;
        if (seenScopes.has(scope) && out.length < max - 1) continue;
        seenScopes.add(scope);
        out.push(anchorContext(input, anchor));
        if (out.length >= max) break;
    }
    return out;
}

function evidenceContexts(
    input: BuildGraphRebuildSnapshotInput,
    evidenceIds: string[],
    anchorById: Map<string, GraphRebuildEntityAnchor>,
    max: number,
): string[] {
    const contexts: string[] = [];
    const seen = new Set<string>();
    for (const evidenceId of evidenceIds) {
        const anchor = anchorById.get(evidenceId);
        if (!anchor) continue;
        const context = anchorContext(input, anchor);
        if (seen.has(context)) continue;
        seen.add(context);
        contexts.push(context);
        if (contexts.length >= max) break;
    }
    return contexts;
}

function anchorContext(input: BuildGraphRebuildSnapshotInput, anchor: GraphRebuildEntityAnchor): string {
    const text = input.noteTexts?.[anchor.noteId] || '';
    if (!text) return anchor.surface;
    const radius = 150;
    const start = Math.max(0, anchor.sourceStart - radius);
    const end = Math.min(text.length, anchor.sourceEnd + radius);
    return squash(text.slice(start, end)) || anchor.surface;
}

function entityLabel(entityId: string, nodeByEntityId: Map<string, GraphRebuildNode>): string {
    return nodeByEntityId.get(entityId)?.label || entityId;
}

function anchorOrder(left: GraphRebuildEntityAnchor, right: GraphRebuildEntityAnchor): number {
    return anchorQuality(right) - anchorQuality(left)
        || left.noteId.localeCompare(right.noteId)
        || left.sourceStart - right.sourceStart
        || left.id.localeCompare(right.id);
}

function anchorQuality(anchor: GraphRebuildEntityAnchor): number {
    let score = clamp(anchor.confidence, 0, 1) * 100;
    if (anchor.source === 'manual_tag' || anchor.source === 'accepted_suggestion') score += 50;
    if (anchor.source === 'dictionary_match') score += 40;
    if (anchor.source === 'machine_suggestion' || anchor.source === 'machine_evidence') score += 36;
    if (anchor.chunkId) score += 10;
    score += Math.min(16, anchor.surface.length);
    return score;
}

function limitText(value: string, max: number): string {
    const text = squash(value);
    if (text.length <= max) return text;
    const head = Math.floor(max * 0.72);
    const tail = Math.max(120, max - head - 7);
    return `${text.slice(0, head)} ... ${text.slice(text.length - tail)}`;
}

function squash(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
