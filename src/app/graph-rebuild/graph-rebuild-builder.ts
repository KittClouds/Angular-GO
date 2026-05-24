import type { RegisteredEntity } from '../lib/registry';
import type {
    BuildGraphRebuildSnapshotInput,
    GraphRebuildChunk,
    GraphRebuildDropReasons,
    GraphRebuildEdge,
    GraphRebuildEntityAnchor,
    GraphRebuildNode,
    GraphRebuildRelationship,
    GraphRebuildRelationshipHint,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';
import { deriveGraphRebuildFacts } from './graph-rebuild-derived-facts';
import { buildGraphRebuildEmbeddingTargets } from './graph-rebuild-embedding-targets';
import { buildGraphAwareLinkSuggestions } from './graph-rebuild-link-suggestions';
import { buildGraphRebuildStructuralPostProcess } from './graph-rebuild-structural-postprocess';
import {
    buildGraphRebuildAliasResolver,
    normalizeGraphRebuildCandidate,
    prepareGraphRebuildAnchors,
} from './graph-rebuild-anchor-hygiene';

export { buildGraphRebuildAliasResolver, normalizeGraphRebuildCandidate };

export function buildGraphRebuildSnapshot(input: BuildGraphRebuildSnapshotInput): GraphRebuildSnapshot {
    const builtAt = input.builtAt ?? Date.now();
    const chunks = normalizeChunks(input.chunks || []);
    const chunksByNote = groupChunksByNote(chunks);
    const entitiesById = new Map(input.entities.map((entity) => [entity.id, entity]));
    const resolver = buildGraphRebuildAliasResolver(input.entities);
    const allowedNotes = new Set(input.noteIds || []);
    const hygiene = prepareGraphRebuildAnchors({
        occurrences: input.occurrences,
        entitiesById,
        resolver,
        chunksByNote,
        allowedNotes,
        builtAt,
    });
    const { mentions, entityAnchors, dropReasons: drops } = hygiene;

    const nodes = buildNodes(entityAnchors, entitiesById);
    const cooccurrenceEdges = buildEdges(entityAnchors, drops);
    const derived = deriveGraphRebuildFacts(chunks, entityAnchors, input.noteTexts || {});
    const edges = [...cooccurrenceEdges, ...derived.edges]
        .sort((left, right) => right.weight - left.weight || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    const relationships = applyRelationshipHints([...cooccurrenceEdges.map(edgeToRelationship), ...derived.relationships], input.relationshipHints || []);
    const structuralPostProcess = buildGraphRebuildStructuralPostProcess(nodes, edges);
    const acceptedRelationships = relationships.filter((relationship) => relationship.status === 'accepted').length;
    const reviewRelationships = relationships.filter((relationship) => relationship.status === 'review').length;
    const rejectedRelationships = relationships.filter((relationship) => relationship.status === 'rejected').length;
    const graphAwareLinkSuggestions = buildGraphAwareLinkSuggestions(nodes, edges, relationships, structuralPostProcess);
    const embeddingTargets = buildGraphRebuildEmbeddingTargets(
        input,
        chunks,
        entityAnchors,
        nodes,
        relationships,
        derived.events,
        derived.temporalEdges,
        derived.causalEdges,
        derived.memoryState,
    );
    const noteIds = input.noteIds ? [...input.noteIds] : unique([
        ...chunks.map((chunk) => chunk.noteId),
        ...entityAnchors.map((anchor) => anchor.noteId),
    ]);

    return {
        schemaVersion: 'phoenix-graph-rebuild/v1',
        id: `graph-rebuild:${input.scopeKind}:${input.scopeId}:${builtAt}`,
        source: 'phoenix-graph-rebuild',
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        noteIds,
        builtAt,
        chunks,
        mentions,
        entityAnchors,
        relationships,
        events: derived.events,
        episodes: derived.episodes,
        temporalEdges: derived.temporalEdges,
        causalEdges: derived.causalEdges,
        memoryState: derived.memoryState,
        embeddingTargets,
        embeddingVectors: [],
        projectionRefs: [],
        nodes,
        edges,
        structuralPostProcess,
        graphAwareLinkSuggestions,
        counters: {
            entities: input.entities.length,
            aliases: resolver.aliasCount,
            candidates: input.candidateCount ?? 0,
            mentions: mentions.length,
            acceptedAnchors: entityAnchors.length,
            chunks: chunks.length,
            relationshipCandidates: relationships.length,
            relationships: relationships.length,
            acceptedRelationships,
            reviewRelationships,
            rejectedRelationships,
            events: derived.events.length,
            episodes: derived.episodes.length,
            temporalEdges: derived.temporalEdges.length,
            causalEdges: derived.causalEdges.length,
            memoryState: derived.memoryState.length,
            embeddingTargets: embeddingTargets.length,
            embeddingVectors: 0,
            projectionRefs: 0,
            nodes: nodes.length,
            edges: edges.length,
            structuralComponents: structuralPostProcess.components.length,
            structuralHubs: structuralPostProcess.hubEntityIds.length,
            structuralBridgeEdges: structuralPostProcess.bridgeEdgeIds.length,
            graphAwareLinkSuggestions: graphAwareLinkSuggestions.length,
            meaningFrameChunks: chunks.filter((chunk) => Boolean(chunk.meaningFrame)).length,
            eventAspects: derived.events.filter((event) => Boolean(event.aspect)).length,
            dropReasons: drops,
            resolution: hygiene.resolution,
        },
        resolutionSuggestions: hygiene.suggestions,
    };
}

function buildNodes(anchors: GraphRebuildEntityAnchor[], entitiesById: Map<string, RegisteredEntity>): GraphRebuildNode[] {
    const byEntity = new Map<string, GraphRebuildNode>();
    for (const anchor of anchors) {
        const entity = entitiesById.get(anchor.entityId);
        if (!entity) continue;
        const node = byEntity.get(entity.id) ?? {
            id: entity.id,
            entityId: entity.id,
            label: entity.label,
            kind: entity.kind,
            aliases: [...(entity.aliases || [])],
            anchorIds: [],
            noteIds: [],
            totalMentions: 0,
        };
        node.anchorIds.push(anchor.id);
        if (!node.noteIds.includes(anchor.noteId)) node.noteIds.push(anchor.noteId);
        node.totalMentions += 1;
        byEntity.set(entity.id, node);
    }
    return [...byEntity.values()].sort((left, right) => right.totalMentions - left.totalMentions || left.label.localeCompare(right.label));
}

function buildEdges(anchors: GraphRebuildEntityAnchor[], drops: GraphRebuildDropReasons): GraphRebuildEdge[] {
    const buckets = new Map<string, GraphRebuildEntityAnchor[]>();
    for (const anchor of anchors) {
        const key = anchor.chunkId || `note:${anchor.noteId}`;
        buckets.set(key, [...(buckets.get(key) || []), anchor]);
    }
    const byPair = new Map<string, GraphRebuildEdge>();
    for (const [scopeKey, bucket] of buckets) {
        const entityIds = unique(bucket.map((anchor) => anchor.entityId));
        if (entityIds.length < 2) {
            drops.singletonBucket += 1;
            continue;
        }
        for (let i = 0; i < entityIds.length; i += 1) {
            for (let j = i + 1; j < entityIds.length; j += 1) {
                upsertEdge(byPair, entityIds[i], entityIds[j], bucket, scopeKey);
            }
        }
    }
    return [...byPair.values()].sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
}

function upsertEdge(
    byPair: Map<string, GraphRebuildEdge>,
    leftId: string,
    rightId: string,
    bucket: GraphRebuildEntityAnchor[],
    scopeKey: string,
): void {
    const [sourceId, targetId] = [leftId, rightId].sort();
    const id = `${sourceId}:anchored-cooccurrence:${targetId}`;
    const evidence = bucket.filter((anchor) => anchor.entityId === sourceId || anchor.entityId === targetId).map((anchor) => anchor.id);
    const edge = byPair.get(id) ?? {
        id,
        sourceId,
        targetId,
        type: 'anchored-cooccurrence',
        weight: 0,
        confidence: 0,
        evidenceAnchorIds: [],
        scopeKeys: [],
        noteIds: [],
    };
    edge.weight += 1;
    edge.confidence = Math.min(1, edge.confidence + 0.2 + evidence.length * 0.08);
    edge.evidenceAnchorIds = unique([...edge.evidenceAnchorIds, ...evidence]);
    edge.scopeKeys = unique([...edge.scopeKeys, scopeKey]);
    edge.noteIds = unique([...edge.noteIds, ...bucket.map((anchor) => anchor.noteId)]);
    byPair.set(id, edge);
}

function edgeToRelationship(edge: GraphRebuildEdge): GraphRebuildRelationship {
    const adjudication = adjudicateEdge(edge);
    return {
        id: `relationship:${edge.id}`,
        sourceEntityId: edge.sourceId,
        targetEntityId: edge.targetId,
        relationType: edge.type === 'anchored-cooccurrence' ? 'co_occurs_with' : edge.type,
        evidenceAnchorIds: edge.evidenceAnchorIds,
        confidence: adjudication.score,
        status: adjudication.status,
        adjudicationSource: 'graph-rebuild-cooccurrence-policy',
        adjudicationScore: adjudication.score,
        rationale: adjudication.rationale,
        decisionEvidence: adjudication.evidence,
    };
}

function applyRelationshipHints(
    relationships: GraphRebuildRelationship[],
    hints: GraphRebuildRelationshipHint[],
): GraphRebuildRelationship[] {
    if (!hints.length || !relationships.length) return relationships;
    const byPair = new Map<string, GraphRebuildRelationshipHint>();
    for (const hint of hints) {
        for (const key of pairKeyVariants(hint.sourceId, hint.targetId)) {
            const current = byPair.get(key);
            if (!current || hint.confidence > current.confidence) byPair.set(key, hint);
        }
    }
    return relationships.map((relationship) => {
        const hint = byPair.get(pairKey(relationship.sourceEntityId, relationship.targetEntityId));
        if (!hint) return relationship;
        const relationType = hint.relationType || relationship.relationType;
        const confidence = clamp(hint.confidence, 0, 1);
        return {
            ...relationship,
            relationType,
            confidence,
            status: hint.status,
            adjudicationSource: hint.source,
            adjudicationScore: confidence,
            rationale: `${hint.status}: NLI adjudication matched this candidate pair`,
            decisionEvidence: unique([
                ...relationship.decisionEvidence,
                ...(hint.evidence || []),
                `nli_confidence:${confidence.toFixed(3)}`,
            ]),
        };
    });
}

function adjudicateEdge(edge: GraphRebuildEdge): { status: 'accepted' | 'review' | 'rejected'; score: number; rationale: string; evidence: string[] } {
    const evidenceCount = edge.evidenceAnchorIds.length;
    const scopeCount = edge.scopeKeys.length;
    const score = Math.min(1, Math.min(edge.weight / 5, 0.65) + Math.min(evidenceCount / 24, 0.25) + Math.min(scopeCount / 12, 0.1));
    const status = edge.weight >= 3 || score >= 0.62 ? 'accepted' : evidenceCount >= 2 && scopeCount >= 1 ? 'review' : 'rejected';
    const rationale = status === 'accepted'
        ? `accepted: co-occurrence repeated across ${scopeCount} bucket(s) with ${evidenceCount} anchor evidence refs`
        : status === 'review'
            ? 'review: one or two co-occurrence buckets; needs typed relation/NLI confirmation'
            : 'rejected: insufficient anchor evidence for a relationship candidate';
    return {
        status,
        score,
        rationale,
        evidence: [`weight:${edge.weight}`, `scope_count:${scopeCount}`, `anchor_evidence_count:${evidenceCount}`],
    };
}

function pairKeyVariants(left: string, right: string): string[] {
    const leftIds = idVariants(left);
    const rightIds = idVariants(right);
    const keys: string[] = [];
    for (const source of leftIds) {
        for (const target of rightIds) keys.push(pairKey(source, target));
    }
    return unique(keys);
}

function pairKey(left: string, right: string): string {
    return [left, right].sort().join('\u0000');
}

function idVariants(value: string): string[] {
    const raw = String(value || '').trim();
    if (!raw) return [];
    const variants = [raw];
    if (raw.startsWith('entity:')) variants.push(raw.slice('entity:'.length));
    const parts = raw.split(':').filter(Boolean);
    if (parts.length > 1) variants.push(parts[parts.length - 1]);
    return unique(variants);
}

function normalizeChunks(chunks: GraphRebuildChunk[]): GraphRebuildChunk[] {
    const seen = new Set<string>();
    return [...chunks]
        .filter((chunk) => chunk.id && chunk.noteId && validSpan(chunk.start, chunk.end))
        .sort((left, right) => left.noteId.localeCompare(right.noteId) || left.start - right.start || left.ordinal - right.ordinal)
        .filter((chunk) => {
            if (seen.has(chunk.id)) return false;
            seen.add(chunk.id);
            return true;
        });
}

function groupChunksByNote(chunks: GraphRebuildChunk[]): Map<string, GraphRebuildChunk[]> {
    const byNote = new Map<string, GraphRebuildChunk[]>();
    for (const chunk of chunks) {
        byNote.set(chunk.noteId, [...(byNote.get(chunk.noteId) || []), chunk]);
    }
    return byNote;
}

function validSpan(from: number, to: number): boolean {
    return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
