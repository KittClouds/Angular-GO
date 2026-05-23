import type {
    GraphRebuildChunk,
    GraphRebuildEdge,
    GraphRebuildEntityAnchor,
    GraphRebuildEpisode,
    GraphRebuildEvent,
    GraphRebuildMemoryState,
    GraphRebuildRelationship,
    GraphRebuildTemporalEdge,
} from './graph-rebuild-snapshot';

export interface DerivedGraphRebuildFacts {
    relationships: GraphRebuildRelationship[];
    edges: GraphRebuildEdge[];
    events: GraphRebuildEvent[];
    episodes: GraphRebuildEpisode[];
    temporalEdges: GraphRebuildTemporalEdge[];
    causalEdges: GraphRebuildTemporalEdge[];
    memoryState: GraphRebuildMemoryState[];
}

interface EntityInChunk {
    id: string;
    firstStart: number;
    firstEnd: number;
    anchorIds: string[];
}

export function deriveGraphRebuildFacts(
    chunks: GraphRebuildChunk[],
    anchors: GraphRebuildEntityAnchor[],
    noteTexts: Record<string, string>,
): DerivedGraphRebuildFacts {
    const byChunk = new Map<string, GraphRebuildEntityAnchor[]>();
    for (const anchor of anchors) {
        if (!anchor.chunkId) continue;
        byChunk.set(anchor.chunkId, [...(byChunk.get(anchor.chunkId) || []), anchor]);
    }
    const relationships: GraphRebuildRelationship[] = [];
    const events: GraphRebuildEvent[] = [];
    const memoryState: GraphRebuildMemoryState[] = [];
    const edgeMap = new Map<string, GraphRebuildEdge>();
    const memorySeen = new Set<string>();

    for (const chunk of chunks) {
        const bucket = byChunk.get(chunk.id) || [];
        const entities = uniqueEntities(bucket);
        if (!entities.length) continue;
        const chunkText = (noteTexts[chunk.noteId] || '').slice(chunk.start, chunk.end);
        const lower = chunkText.toLowerCase();
        deriveRelationships(chunk, lower, entities, relationships, edgeMap);
        deriveEvent(chunk, lower, entities, events);
        deriveMemory(chunk, lower, entities, memorySeen, memoryState);
    }
    const edges = [...edgeMap.values()].sort((left, right) => right.weight - left.weight || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
    const episodes = buildEpisodes(events);
    const temporalEdges = buildTemporalEdges(events);
    const causalEdges = buildCausalEdges(events, chunks, noteTexts);
    return { relationships, edges, events, episodes, temporalEdges, causalEdges, memoryState };
}

function uniqueEntities(bucket: GraphRebuildEntityAnchor[]): EntityInChunk[] {
    const byEntity = new Map<string, EntityInChunk>();
    for (const anchor of bucket) {
        const current = byEntity.get(anchor.entityId);
        if (current) {
            current.anchorIds = unique([...current.anchorIds, anchor.id]);
            current.firstStart = Math.min(current.firstStart, anchor.sourceStart);
            current.firstEnd = Math.min(current.firstEnd, anchor.sourceEnd);
            continue;
        }
        byEntity.set(anchor.entityId, {
            id: anchor.entityId,
            firstStart: anchor.sourceStart,
            firstEnd: anchor.sourceEnd,
            anchorIds: [anchor.id],
        });
    }
    return [...byEntity.values()].sort((left, right) => left.firstStart - right.firstStart);
}

function deriveRelationships(
    chunk: GraphRebuildChunk,
    lower: string,
    entities: EntityInChunk[],
    relationships: GraphRebuildRelationship[],
    edgeMap: Map<string, GraphRebuildEdge>,
): void {
    if (entities.length < 2) return;
    for (let i = 0; i < entities.length; i += 1) {
        for (let j = i + 1; j < entities.length; j += 1) {
            const left = entities[i];
            const right = entities[j];
            const relationType = inferRelationType(pairWindow(lower, chunk, left, right));
            if (!relationType) continue;
            const evidence = unique([...left.anchorIds, ...right.anchorIds]);
            const id = `typed:${chunk.noteId}:${chunk.ordinal}:${left.id}:${relationType}:${right.id}`;
            const confidence = relationConfidence(relationType);
            relationships.push({
                id,
                sourceEntityId: left.id,
                targetEntityId: right.id,
                relationType,
                evidenceAnchorIds: evidence,
                confidence,
                status: 'accepted',
                adjudicationSource: 'graph-rebuild-typed-cue-policy',
                adjudicationScore: confidence,
                rationale: `accepted: anchored chunk cue promoted ${relationType} fact`,
                decisionEvidence: [`chunk:${chunk.id}`, `cue:${relationType}`],
            });
            upsertTypedEdge(edgeMap, left.id, right.id, relationType, evidence, chunk.id);
        }
    }
}

function pairWindow(lower: string, chunk: GraphRebuildChunk, left: EntityInChunk, right: EntityInChunk): string {
    const start = Math.min(left.firstStart, right.firstStart);
    const end = Math.max(left.firstEnd, right.firstEnd);
    const localStart = Math.max(0, start - chunk.start);
    const localEnd = Math.max(localStart, end - chunk.start);
    return lower.slice(Math.max(0, localStart - 160), Math.min(lower.length, localEnd + 160));
}

function inferRelationType(text: string): string | null {
    if (hasAny(text, [' father', ' daughter', ' grandfather', ' family'])) return 'family_or_house_tie';
    if (hasAny(text, ['command', 'admiral', 'phantom', 'military'])) return 'command_or_service_tie';
    if (hasAny(text, ['approved', 'approval', 'accepted', 'agreed', 'proceed'])) return 'approves_or_accepts';
    if (hasAny(text, ['packet', 'release', 'terms', 'warning', 'coercion'])) return 'discusses_release_terms';
    if (hasAny(text, ['kiss', 'took his hand', 'stood beside', 'close enough'])) return 'intimate_or_close_contact';
    if (hasAny(text, ['looked at', 'watched', 'saw ', 'noticed'])) return 'observes';
    if (hasAny(text, ['gave', 'handed', 'took it from', 'received'])) return 'transfers_or_receives';
    if (hasAny(text, ['entered', 'arrived', 'came in', 'stood near'])) return 'scene_presence';
    return null;
}

function relationConfidence(type: string): number {
    if (type === 'family_or_house_tie' || type === 'command_or_service_tie' || type === 'approves_or_accepts') return 0.82;
    if (type === 'transfers_or_receives' || type === 'intimate_or_close_contact') return 0.76;
    if (type === 'discusses_release_terms') return 0.70;
    return 0.64;
}

function upsertTypedEdge(edgeMap: Map<string, GraphRebuildEdge>, left: string, right: string, type: string, evidence: string[], scopeKey: string): void {
    const [sourceId, targetId] = [left, right].sort();
    const id = `${sourceId}:${type}:${targetId}`;
    const edge = edgeMap.get(id) || { id, sourceId, targetId, type, weight: 0, confidence: 0, evidenceAnchorIds: [], scopeKeys: [], noteIds: [] };
    edge.weight += 1;
    edge.confidence = Math.min(1, edge.confidence + 0.25);
    edge.evidenceAnchorIds = unique([...edge.evidenceAnchorIds, ...evidence]);
    edge.scopeKeys = unique([...edge.scopeKeys, scopeKey]);
    edge.noteIds = unique([...edge.noteIds, ...evidence.map((id) => id.split(':')[0]).filter(Boolean)]);
    edgeMap.set(id, edge);
}

function deriveEvent(chunk: GraphRebuildChunk, lower: string, entities: EntityInChunk[], events: GraphRebuildEvent[]): void {
    const type = inferEventType(lower);
    if (!type) return;
    const picked = entities.slice(0, 6);
    events.push({
        id: `event:${chunk.noteId}:${chunk.ordinal}:${type}`,
        noteId: chunk.noteId,
        chunkId: chunk.id,
        label: `${type} in chunk ${chunk.ordinal + 1}`,
        entityIds: unique(picked.map((entity) => entity.id)),
        evidenceAnchorIds: unique(picked.flatMap((entity) => entity.anchorIds)),
        confidence: 0.68,
    });
}

function inferEventType(text: string): string | null {
    if (hasAny(text, ['approved', 'signed', 'proceed'])) return 'approval_event';
    if (hasAny(text, ['warn', 'coercion', 'risk', 'prohibited'])) return 'warning_event';
    if (hasAny(text, ['entered', 'arrived', 'came in', 'opened the door'])) return 'arrival_event';
    if (hasAny(text, ['asked', 'answered', 'said', 'spoke', 'read'])) return 'dialogue_event';
    if (hasAny(text, ['kiss', 'took his hand', 'handed', 'gave'])) return 'contact_or_transfer_event';
    if (hasAny(text, ['stood', 'watched', 'looked', 'turned'])) return 'positioning_event';
    return null;
}

function deriveMemory(chunk: GraphRebuildChunk, lower: string, entities: EntityInChunk[], seen: Set<string>, memory: GraphRebuildMemoryState[]): void {
    const key = inferMemoryKey(lower);
    if (!key) return;
    for (const entity of entities.slice(0, 4)) {
        const id = `memory:${entity.id}:${key}:${chunk.ordinal}`;
        if (seen.has(id)) continue;
        seen.add(id);
        memory.push({ id, entityId: entity.id, noteId: chunk.noteId, key, value: `chunk:${chunk.ordinal} cue:${key}`, evidenceIds: [...entity.anchorIds] });
    }
}

function inferMemoryKey(text: string): string | null {
    if (hasAny(text, ['diamond', 'sapphire', 'black rank', 'queen'])) return 'rank_or_status';
    if (hasAny(text, ['family', 'father', 'grandfather', 'daughter'])) return 'family_context';
    if (hasAny(text, ['phantom', 'admiral', 'command', 'military'])) return 'service_context';
    if (hasAny(text, ['approved', 'accepted', 'agreed', 'proceed'])) return 'decision_state';
    if (hasAny(text, ['germany', 'atlas', 'barish', 'clayne', 'blazefell'])) return 'affiliation_context';
    return null;
}

function buildEpisodes(events: GraphRebuildEvent[]): GraphRebuildEpisode[] {
    const episodes: GraphRebuildEpisode[] = [];
    for (let index = 0; index < events.length; index += 12) {
        const group = events.slice(index, index + 12);
        episodes.push({
            id: `episode:${group[0]?.noteId || 'unknown'}:${episodes.length}`,
            noteId: group[0]?.noteId || '',
            eventIds: group.map((event) => event.id),
            entityIds: unique(group.flatMap((event) => event.entityIds)),
            label: `Episode ${episodes.length + 1}`,
        });
    }
    return episodes;
}

function buildTemporalEdges(events: GraphRebuildEvent[]): GraphRebuildTemporalEdge[] {
    return events.slice(1).map((event, index) => ({
        id: `temporal:${events[index].id}:${event.id}`,
        sourceId: events[index].id,
        targetId: event.id,
        relationType: 'before',
        evidenceIds: [events[index].id, event.id],
        confidence: Math.max(0.62, 0.74 - index * 0.0001),
    }));
}

function buildCausalEdges(events: GraphRebuildEvent[], chunks: GraphRebuildChunk[], noteTexts: Record<string, string>): GraphRebuildTemporalEdge[] {
    const byChunk = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const out: GraphRebuildTemporalEdge[] = [];
    for (let index = 1; index < events.length; index += 1) {
        const previous = events[index - 1];
        const current = events[index];
        if (!previous || !current) continue;
        const chunk = current.chunkId ? byChunk.get(current.chunkId) : null;
        const text = chunk ? (noteTexts[chunk.noteId] || '').slice(chunk.start, chunk.end).toLowerCase() : '';
        if (!hasAny(text, ['because', 'therefore', 'which meant', 'that meant', 'so '])) continue;
        out.push({ id: `causal:${previous.id}:${current.id}`, sourceId: previous.id, targetId: current.id, relationType: 'causes_or_explains', evidenceIds: [previous.id, current.id], confidence: 0.66 });
    }
    return out;
}

function hasAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
}

function unique<T>(values: T[]): T[] {
    return [...new Set(values)];
}
