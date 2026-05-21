import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';
import type {
    BuildGraphRebuildSnapshotInput,
    GraphRebuildCandidate,
    GraphRebuildChunk,
    GraphRebuildDropReasons,
    GraphRebuildEdge,
    GraphRebuildEmbeddingTarget,
    GraphRebuildEntityAnchor,
    GraphRebuildMention,
    GraphRebuildNode,
    GraphRebuildRelationship,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';

export interface GraphRebuildAliasResolver {
    aliasCount: number;
    bySurface: Map<string, RegisteredEntity>;
    resolve(surface: string): RegisteredEntity | null;
}

export function buildGraphRebuildAliasResolver(entities: RegisteredEntity[]): GraphRebuildAliasResolver {
    const bySurface = new Map<string, RegisteredEntity>();
    let aliasCount = 0;
    for (const entity of entities) {
        addSurface(bySurface, entity.label, entity);
        for (const alias of entity.aliases || []) {
            if (addSurface(bySurface, alias, entity)) aliasCount += 1;
        }
    }
    return {
        aliasCount,
        bySurface,
        resolve: (surface: string) => bySurface.get(normalizeSurface(surface)) ?? null,
    };
}

export function normalizeGraphRebuildCandidate(candidate: GraphRebuildCandidate): GraphRebuildCandidate {
    const label = compactSurface(candidate.label);
    const aliases = uniqueSurfaces(candidate.aliases || []).filter((alias) => normalizeSurface(alias) !== normalizeSurface(label));
    return {
        label,
        kind: compactSurface(candidate.kind || 'UNKNOWN').toUpperCase(),
        aliases,
        confidence: clamp(Number(candidate.confidence ?? 0.75), 0, 1),
    };
}

export function buildGraphRebuildSnapshot(input: BuildGraphRebuildSnapshotInput): GraphRebuildSnapshot {
    const builtAt = input.builtAt ?? Date.now();
    const chunks = normalizeChunks(input.chunks || []);
    const chunksByNote = groupChunksByNote(chunks);
    const entitiesById = new Map(input.entities.map((entity) => [entity.id, entity]));
    const resolver = buildGraphRebuildAliasResolver(input.entities);
    const allowedNotes = new Set(input.noteIds || []);
    const drops: GraphRebuildDropReasons = { missingEntity: 0, invalidSpan: 0, duplicateAnchor: 0, singletonBucket: 0, missingChunk: 0 };
    const seenAnchors = new Set<string>();
    const mentions: GraphRebuildMention[] = [];
    const entityAnchors: GraphRebuildEntityAnchor[] = [];

    for (const occurrence of input.occurrences) {
        if (allowedNotes.size && !allowedNotes.has(occurrence.noteId)) continue;
        const mention = occurrenceToMention(occurrence);
        const entity = entitiesById.get(occurrence.entityId) ?? resolver.resolve(occurrence.surface);
        if (!entity) {
            drops.missingEntity += 1;
            mentions.push({ ...mention, status: 'dropped' });
            continue;
        }
        if (!validSpan(occurrence.sourceStart, occurrence.sourceEnd)) {
            drops.invalidSpan += 1;
            mentions.push({ ...mention, entityId: entity.id, status: 'dropped' });
            continue;
        }
        const chunkId = mention.chunkId || findChunkId(chunksByNote.get(occurrence.noteId) || [], occurrence);
        if (!chunkId && chunks.length) drops.missingChunk += 1;
        const id = anchorId(occurrence, entity.id);
        if (seenAnchors.has(id)) {
            drops.duplicateAnchor += 1;
            mentions.push({ ...mention, entityId: entity.id, chunkId, status: 'dropped' });
            continue;
        }
        seenAnchors.add(id);
        const anchor: GraphRebuildEntityAnchor = {
            ...mention,
            id,
            entityId: entity.id,
            chunkId,
            status: 'accepted',
            generation: occurrence.generation || builtAt,
        };
        mentions.push(anchor);
        entityAnchors.push(anchor);
    }

    const nodes = buildNodes(entityAnchors, entitiesById);
    const edges = buildEdges(entityAnchors, drops);
    const relationships = edges.map(edgeToRelationship);
    const embeddingTargets = buildEmbeddingTargets(input, chunks, entityAnchors, nodes, edges);
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
        events: [],
        episodes: [],
        temporalEdges: [],
        causalEdges: [],
        memoryState: [],
        embeddingTargets,
        embeddingVectors: [],
        projectionRefs: [],
        nodes,
        edges,
        counters: {
            entities: input.entities.length,
            aliases: resolver.aliasCount,
            candidates: input.candidateCount ?? 0,
            mentions: mentions.length,
            acceptedAnchors: entityAnchors.length,
            chunks: chunks.length,
            relationships: relationships.length,
            events: 0,
            episodes: 0,
            temporalEdges: 0,
            causalEdges: 0,
            memoryState: 0,
            embeddingTargets: embeddingTargets.length,
            embeddingVectors: 0,
            projectionRefs: 0,
            nodes: nodes.length,
            edges: edges.length,
            dropReasons: drops,
        },
    };
}

function occurrenceToMention(occurrence: EntityOccurrence): GraphRebuildMention {
    return {
        id: occurrence.id,
        noteId: occurrence.noteId,
        chunkId: chunkIdFromOccurrence(occurrence),
        surface: occurrence.surface,
        sourceStart: occurrence.sourceStart,
        sourceEnd: occurrence.sourceEnd,
        source: occurrence.source,
        confidence: clamp(Number(occurrence.confidence || 0), 0, 1),
        entityId: occurrence.entityId,
        status: 'candidate',
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
    return {
        id: `relationship:${edge.id}`,
        sourceEntityId: edge.sourceId,
        targetEntityId: edge.targetId,
        relationType: edge.type === 'anchored-cooccurrence' ? 'co_occurs_with' : edge.type,
        evidenceAnchorIds: edge.evidenceAnchorIds,
        confidence: edge.confidence,
    };
}

function buildEmbeddingTargets(
    input: BuildGraphRebuildSnapshotInput,
    chunks: GraphRebuildChunk[],
    anchors: GraphRebuildEntityAnchor[],
    nodes: GraphRebuildNode[],
    edges: GraphRebuildEdge[],
): GraphRebuildEmbeddingTarget[] {
    const targets: GraphRebuildEmbeddingTarget[] = [];
    const noteIds = input.noteIds?.length ? input.noteIds : unique([
        ...chunks.map((chunk) => chunk.noteId),
        ...anchors.map((anchor) => anchor.noteId),
    ]);
    for (const noteId of noteIds) {
        targets.push({
            id: `embed:note:${noteId}`,
            kind: 'note',
            sourceId: noteId,
            noteId,
            label: `Note ${noteId}`,
            text: `note:${noteId}`,
            evidenceIds: [],
        });
    }
    for (const chunk of chunks) {
        targets.push({
            id: `embed:chunk:${chunk.id}`,
            kind: 'chunk',
            sourceId: chunk.id,
            noteId: chunk.noteId,
            chunkId: chunk.id,
            label: `Chunk ${chunk.ordinal + 1}`,
            text: `${chunk.noteId}:${chunk.start}-${chunk.end}`,
            evidenceIds: [],
        });
    }
    for (const node of nodes) {
        targets.push({
            id: `embed:entity:${node.entityId}`,
            kind: 'entity',
            sourceId: node.entityId,
            entityId: node.entityId,
            label: node.label,
            text: [node.label, ...node.aliases].join(' '),
            evidenceIds: node.anchorIds,
        });
    }
    for (const anchor of anchors) {
        targets.push({
            id: `embed:anchor:${anchor.id}`,
            kind: 'anchor',
            sourceId: anchor.id,
            noteId: anchor.noteId,
            chunkId: anchor.chunkId,
            entityId: anchor.entityId,
            label: anchor.surface,
            text: anchor.surface,
            evidenceIds: [anchor.id],
        });
    }
    for (const edge of edges) {
        targets.push({
            id: `embed:graph-fact:${edge.id}`,
            kind: 'graphFact',
            sourceId: edge.id,
            label: `${edge.sourceId} ${edge.type} ${edge.targetId}`,
            text: `${edge.sourceId} ${edge.type} ${edge.targetId}`,
            evidenceIds: edge.evidenceAnchorIds,
        });
    }
    return targets;
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

function findChunkId(chunks: GraphRebuildChunk[], occurrence: EntityOccurrence): string | undefined {
    const direct = chunks.find((chunk) => occurrence.sourceStart >= chunk.start && occurrence.sourceEnd <= chunk.end);
    if (direct) return direct.id;
    return chunks.find((chunk) => occurrence.sourceStart >= chunk.start && occurrence.sourceStart < chunk.end)?.id;
}

function addSurface(index: Map<string, RegisteredEntity>, surface: string, entity: RegisteredEntity): boolean {
    const normalized = normalizeSurface(surface);
    if (!normalized || index.has(normalized)) return false;
    index.set(normalized, entity);
    return true;
}

function anchorId(occurrence: EntityOccurrence, entityId: string): string {
    return `${occurrence.noteId}:${entityId}:${occurrence.sourceStart}:${occurrence.sourceEnd}:${occurrence.source}`;
}

function chunkIdFromOccurrence(occurrence: EntityOccurrence): string | undefined {
    const metadata = occurrence as EntityOccurrence & { chunkId?: string; blockId?: string };
    return metadata.chunkId || metadata.blockId || undefined;
}

function validSpan(from: number, to: number): boolean {
    return Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from;
}

function uniqueSurfaces(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const compact = compactSurface(value);
        const normalized = normalizeSurface(compact);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(compact);
    }
    return result;
}

function compactSurface(value: string): string {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeSurface(value: string): string {
    return compactSurface(value).toLocaleLowerCase();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
