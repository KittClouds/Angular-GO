import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';
import type {
    GraphRebuildChunk,
    GraphRebuildCandidate,
    GraphRebuildDropReasons,
    GraphRebuildEntityAnchor,
    GraphRebuildMention,
    GraphRebuildResolutionCounters,
    GraphRebuildResolutionSuggestion,
} from './graph-rebuild-snapshot';

export interface GraphRebuildAliasResolver {
    aliasCount: number;
    bySurface: Map<string, RegisteredEntity>;
    ambiguousSurfaces: Set<string>;
    resolve(surface: string): RegisteredEntity | null;
    resolveWithMethod(surface: string): GraphRebuildResolvedEntity | null;
}

export interface GraphRebuildResolvedEntity {
    entity: RegisteredEntity;
    method: 'label' | 'alias';
}

export interface GraphRebuildAnchorHygieneInput {
    occurrences: EntityOccurrence[];
    entitiesById: Map<string, RegisteredEntity>;
    resolver: GraphRebuildAliasResolver;
    chunksByNote: Map<string, GraphRebuildChunk[]>;
    allowedNotes: Set<string>;
    builtAt: number;
}

export interface GraphRebuildAnchorHygieneResult {
    mentions: GraphRebuildMention[];
    entityAnchors: GraphRebuildEntityAnchor[];
    dropReasons: GraphRebuildDropReasons;
    resolution: GraphRebuildResolutionCounters;
    suggestions: GraphRebuildResolutionSuggestion[];
}

interface SurfaceClaim {
    entity: RegisteredEntity;
    method: 'label' | 'alias';
}

export function buildGraphRebuildAliasResolver(entities: RegisteredEntity[]): GraphRebuildAliasResolver {
    const bySurface = new Map<string, RegisteredEntity>();
    const claims = new Map<string, SurfaceClaim[]>();
    let aliasCount = 0;
    for (const entity of entities) {
        addSurfaceClaim(claims, entity.label, entity, 'label');
        for (const alias of entity.aliases || []) {
            if (addSurfaceClaim(claims, alias, entity, 'alias')) aliasCount += 1;
        }
    }
    const ambiguousSurfaces = new Set<string>();
    for (const [surface, surfaceClaims] of claims) {
        const uniqueEntityIds = new Set(surfaceClaims.map((claim) => claim.entity.id));
        if (uniqueEntityIds.size > 1) {
            ambiguousSurfaces.add(surface);
            continue;
        }
        bySurface.set(surface, surfaceClaims[0].entity);
    }
    return {
        aliasCount,
        bySurface,
        ambiguousSurfaces,
        resolve: (surface: string) => bySurface.get(normalizeSurface(surface)) ?? null,
        resolveWithMethod: (surface: string) => {
            const normalized = normalizeSurface(surface);
            if (!normalized || ambiguousSurfaces.has(normalized)) return null;
            const claim = claims.get(normalized)?.[0];
            return claim ? { entity: claim.entity, method: claim.method } : null;
        },
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

export function prepareGraphRebuildAnchors(input: GraphRebuildAnchorHygieneInput): GraphRebuildAnchorHygieneResult {
    const dropReasons: GraphRebuildDropReasons = { missingEntity: 0, invalidSpan: 0, duplicateAnchor: 0, singletonBucket: 0, missingChunk: 0 };
    const resolution: GraphRebuildResolutionCounters = {
        resolvedById: 0,
        resolvedByLabel: 0,
        resolvedByAlias: 0,
        ambiguousSurfaces: 0,
        kindConflicts: 0,
        possibleAliases: 0,
        droppedDuplicateSpans: 0,
    };
    const seenAnchors = new Set<string>();
    const spanOwners = new Map<string, string>();
    const mentions: GraphRebuildMention[] = [];
    const entityAnchors: GraphRebuildEntityAnchor[] = [];
    const suggestions: GraphRebuildResolutionSuggestion[] = [];

    for (const occurrence of input.occurrences) {
        if (input.allowedNotes.size && !input.allowedNotes.has(occurrence.noteId)) continue;
        const mention = occurrenceToMention(occurrence);
        if (!validSpan(occurrence.sourceStart, occurrence.sourceEnd)) {
            dropReasons.invalidSpan += 1;
            mentions.push({ ...mention, status: 'dropped' });
            continue;
        }

        const resolved = resolveOccurrence(occurrence, input.entitiesById, input.resolver, resolution, suggestions);
        if (!resolved) {
            dropReasons.missingEntity += 1;
            mentions.push({ ...mention, status: 'dropped' });
            continue;
        }

        const chunkId = resolveChunkId(input.chunksByNote.get(occurrence.noteId) || [], mention.chunkId, occurrence);
        if (!chunkId && input.chunksByNote.size) dropReasons.missingChunk += 1;
        const canonicalMention = { ...mention, entityId: resolved.entity.id, chunkId };
        const spanKey = `${occurrence.noteId}:${occurrence.sourceStart}:${occurrence.sourceEnd}`;
        const spanOwner = spanOwners.get(spanKey);
        if (spanOwner && spanOwner !== resolved.entity.id) {
            suggestions.push(suggestion('possible_split', occurrence, [spanOwner, resolved.entity.id], 'same span resolved to multiple entities'));
            mentions.push({ ...canonicalMention, status: 'dropped' });
            continue;
        }
        spanOwners.set(spanKey, resolved.entity.id);

        const id = anchorId(occurrence, resolved.entity.id);
        if (seenAnchors.has(id)) {
            dropReasons.duplicateAnchor += 1;
            resolution.droppedDuplicateSpans += 1;
            mentions.push({ ...canonicalMention, status: 'dropped' });
            continue;
        }
        seenAnchors.add(id);
        const anchor: GraphRebuildEntityAnchor = {
            ...canonicalMention,
            id,
            status: 'accepted',
            generation: occurrence.generation || input.builtAt,
        };
        mentions.push(anchor);
        entityAnchors.push(anchor);
    }

    return { mentions, entityAnchors, dropReasons, resolution, suggestions: uniqueSuggestions(suggestions) };
}

function resolveOccurrence(
    occurrence: EntityOccurrence,
    entitiesById: Map<string, RegisteredEntity>,
    resolver: GraphRebuildAliasResolver,
    resolution: GraphRebuildResolutionCounters,
    suggestions: GraphRebuildResolutionSuggestion[],
): GraphRebuildResolvedEntity | null {
    const byId = entitiesById.get(occurrence.entityId);
    if (byId) {
        resolution.resolvedById += 1;
        recordKindConflict(occurrence, byId, resolution, suggestions);
        return { entity: byId, method: 'label' };
    }
    const normalized = normalizeSurface(occurrence.surface);
    if (normalized && resolver.ambiguousSurfaces.has(normalized)) {
        resolution.ambiguousSurfaces += 1;
        suggestions.push(suggestion('ambiguous_surface', occurrence, [], 'surface matches multiple registered labels or aliases'));
        return null;
    }
    const resolved = resolver.resolveWithMethod(occurrence.surface);
    if (!resolved) return null;
    if (resolved.method === 'label') resolution.resolvedByLabel += 1;
    else {
        resolution.resolvedByAlias += 1;
        resolution.possibleAliases += 1;
        suggestions.push(suggestion('possible_alias', occurrence, [resolved.entity.id], 'surface resolved through a registered alias'));
    }
    recordKindConflict(occurrence, resolved.entity, resolution, suggestions);
    return resolved;
}

function recordKindConflict(
    occurrence: EntityOccurrence,
    entity: RegisteredEntity,
    resolution: GraphRebuildResolutionCounters,
    suggestions: GraphRebuildResolutionSuggestion[],
): void {
    const observed = compactSurface(occurrence.entityKind).toUpperCase();
    const canonical = compactSurface(entity.kind as string).toUpperCase();
    if (!observed || !canonical || observed === canonical) return;
    resolution.kindConflicts += 1;
    suggestions.push(suggestion('kind_conflict', occurrence, [entity.id], `candidate kind ${observed} conflicts with canonical ${canonical}`));
}

function occurrenceToMention(occurrence: EntityOccurrence): GraphRebuildMention {
    return {
        id: occurrence.id,
        noteId: occurrence.noteId,
        chunkId: chunkIdFromOccurrence(occurrence),
        surface: compactSurface(occurrence.surface),
        sourceStart: occurrence.sourceStart,
        sourceEnd: occurrence.sourceEnd,
        source: occurrence.source,
        confidence: clamp(Number(occurrence.confidence || 0), 0, 1),
        entityId: occurrence.entityId,
        status: 'candidate',
    };
}

function addSurfaceClaim(claims: Map<string, SurfaceClaim[]>, surface: string, entity: RegisteredEntity, method: 'label' | 'alias'): boolean {
    const normalized = normalizeSurface(surface);
    if (!normalized) return false;
    const current = claims.get(normalized) || [];
    if (current.some((claim) => claim.entity.id === entity.id)) return false;
    claims.set(normalized, [...current, { entity, method }]);
    return true;
}

function resolveChunkId(
    chunks: GraphRebuildChunk[],
    candidateChunkId: string | undefined,
    occurrence: EntityOccurrence,
): string | undefined {
    if (candidateChunkId && chunks.some((chunk) => chunk.id === candidateChunkId)) return candidateChunkId;
    return findChunkId(chunks, occurrence);
}

function findChunkId(chunks: GraphRebuildChunk[], occurrence: EntityOccurrence): string | undefined {
    const direct = chunks.find((chunk) => occurrence.sourceStart >= chunk.start && occurrence.sourceEnd <= chunk.end);
    if (direct) return direct.id;
    return chunks.find((chunk) => occurrence.sourceStart >= chunk.start && occurrence.sourceStart < chunk.end)?.id;
}

function anchorId(occurrence: EntityOccurrence, entityId: string): string {
    return `${occurrence.noteId}:${entityId}:${occurrence.sourceStart}:${occurrence.sourceEnd}`;
}

function chunkIdFromOccurrence(occurrence: EntityOccurrence): string | undefined {
    const metadata = occurrence as EntityOccurrence & { chunkId?: string; blockId?: string };
    return metadata.chunkId || metadata.blockId || undefined;
}

function suggestion(
    kind: GraphRebuildResolutionSuggestion['kind'],
    occurrence: EntityOccurrence,
    entityIds: string[],
    rationale: string,
): GraphRebuildResolutionSuggestion {
    return {
        id: `resolution:${kind}:${occurrence.noteId}:${occurrence.sourceStart}:${occurrence.sourceEnd}:${normalizeSurface(occurrence.surface)}`,
        kind,
        surface: compactSurface(occurrence.surface),
        noteId: occurrence.noteId,
        sourceStart: occurrence.sourceStart,
        sourceEnd: occurrence.sourceEnd,
        entityIds,
        status: 'review',
        rationale,
    };
}

function uniqueSuggestions(values: GraphRebuildResolutionSuggestion[]): GraphRebuildResolutionSuggestion[] {
    const seen = new Set<string>();
    return values.filter((value) => {
        if (seen.has(value.id)) return false;
        seen.add(value.id);
        return true;
    });
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
