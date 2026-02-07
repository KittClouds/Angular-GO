export type GraphScope = 'note' | 'folder' | 'vault' | 'narrative';

/**
 * Scope mode for LLM memory recall queries.
 * - local_only: Only search within the exact scope
 * - bubble_up: Search scope + all ancestor scopes (via folder_hierarchy)
 * - global_fallback: Search locally first, fall back to global if no results
 */
export type ScopeMode = 'local_only' | 'bubble_up' | 'global_fallback';

export interface ScopeIdentifier {
    scope: GraphScope;
    id: string;
    groupId: string;
    mode?: ScopeMode;  // Query-time behavior modifier
}

export function buildScopeIdentifier(
    scope: GraphScope,
    id: string,
    mode: ScopeMode = 'local_only'
): ScopeIdentifier {
    // Vault is always global, narrative uses its root folder ID
    const groupId = scope === 'vault'
        ? 'vault:global'
        : scope === 'narrative'
            ? `narrative:${id}`
            : `${scope}:${id}`;
    return { scope, id, groupId, mode };
}

export function parseScopeIdentifier(groupId: string): ScopeIdentifier {
    const [scope, id] = groupId.split(':');
    return {
        scope: scope as GraphScope,
        id: id || 'global',
        groupId,
        mode: 'local_only',
    };
}

/**
 * Build a scoped query prefix for Datalog based on scope mode.
 * Returns the scope closure rule to prepend to queries.
 */
export function buildScopeClosureRule(scopeId: string, mode: ScopeMode): string {
    switch (mode) {
        case 'local_only':
            return `scope_closure[sid] <- [["${scopeId}"]]`;

        case 'bubble_up':
            return `
                scope_closure[sid] <- [["${scopeId}"]]
                scope_closure[parent_id] :=
                    scope_closure[child_id],
                    *folder_hierarchy{parent_id, child_id, invalid_at},
                    is_null(invalid_at)
            `;

        case 'global_fallback':
            // Global fallback is handled at the service layer, not in Datalog
            return `scope_closure[sid] <- [["${scopeId}"]]`;
    }
}


export interface CozoEpisode {
    id: string;
    noteId: string;
    createdAt: Date;
    validAt: Date;
    // Content removed: Cozo only stores graph metadata
    blockId?: string;

    groupId: string;
    scopeType: GraphScope;
    extractionMethod: 'regex' | 'llm' | 'manual';
    processedAt?: Date;
    sentenceIndex?: number;
    paragraphIndex?: number;
}

/**
 * In-memory episode with content for extraction processing
 */
export interface ExtractionEpisode extends CozoEpisode {
    contentText: string;
    contentJson?: object;
}


export const COZO_ENTITY_KINDS = [
    'CHARACTER',
    'LOCATION',
    'NPC',
    'ITEM',
    'FACTION',
    'SCENE',
    'EVENT',
    'CONCEPT',
    'ARC',
    'ACT',
    'CHAPTER',
    'BEAT',
    'TIMELINE',
    'NARRATIVE',
] as const;

export type CozoEntityKind = typeof COZO_ENTITY_KINDS[number];

export interface CozoEntity {
    id: string;
    name: string;
    entityKind: CozoEntityKind;
    entitySubtype?: string;
    groupId: string;
    scopeType: GraphScope;
    createdAt: Date;
    extractionMethod: 'regex' | 'llm' | 'manual';
    summary?: string;
    aliases: string[];
    canonicalNoteId?: string;
    frequency: number;
    degreeCentrality?: number;
    betweennessCentrality?: number;
    closenessCentrality?: number;
    communityId?: string;
    attributes?: Record<string, unknown>;
    temporalSpan?: CozoTemporalSpan;
    participants: string[];
    /** If set, this entity belongs to a specific narrative vault (isolated from other narratives) */
    narrativeId?: string;
}

export interface CozoMention {
    id: string;
    episodeId: string;
    entityId: string;
    context: string;
    charPosition: number;
    sentenceIndex?: number;
    confidence: number;
    extractionMethod: 'regex' | 'llm' | 'manual';
    createdAt: Date;
    updatedAt?: Date;
}

export interface CozoEntityEdge {
    id: string;
    sourceId: string;
    targetId: string;
    createdAt: Date;
    validAt: Date;
    invalidAt?: Date;
    groupId: string;
    scopeType: GraphScope;
    edgeType: string;
    fact?: string;
    episodeIds: string[];
    noteIds: string[];
    weight: number;
    pmiScore?: number;
    confidence: number;
    extractionMethods: string[];
}

export interface CozoNarrativeHierarchy {
    id: string;
    parentId: string;
    childId: string;
    parentKind: CozoEntityKind;
    childKind: CozoEntityKind;
    sequenceOrder?: number;
    createdAt: Date;
}

export interface CozoCausalLink {
    id: string;
    triggerEventId: string;
    causedEventId: string;
    causalType: 'triggers' | 'prevents' | 'enables';
    confidence: number;
    createdAt: Date;
}

export type TemporalGranularity =
    | 'precise'
    | 'datetime'
    | 'date'
    | 'relative'
    | 'sequential'
    | 'abstract';

export type TimeOfDay =
    | 'dawn'
    | 'morning'
    | 'afternoon'
    | 'evening'
    | 'night'
    | 'midnight';

export type DurationUnit =
    | 'seconds'
    | 'minutes'
    | 'hours'
    | 'days'
    | 'weeks'
    | 'months'
    | 'years';

export type TimeSource =
    | 'explicit'
    | 'inferred'
    | 'contextual'
    | 'manual'
    | 'parsed';

export interface CozoTemporalPoint {
    id: string;
    entityId: string;
    granularity: TemporalGranularity;
    timestamp?: Date;
    relativeToEventId?: string;
    offsetValue?: number;
    offsetUnit?: DurationUnit;
    offsetDirection?: 'before' | 'after';
    chapter?: number;
    act?: number;
    scene?: number;
    sequence?: number;
    timeOfDay?: TimeOfDay;
    displayText: string;
    originalText?: string;
    confidence: number;
    source: TimeSource;
    locked: boolean;
    parsedFromNoteId?: string;
    parsedFromOffset?: number;
}

export interface CozoTemporalSpan {
    start: CozoTemporalPoint;
    end?: CozoTemporalPoint;
    duration?: {
        value: number;
        unit: DurationUnit;
    };
}

export interface CozoCommunity {
    id: string;
    groupId: string;
    scopeType: GraphScope;
    summary?: string;
    memberCount: number;
    topEntities: string[];
    createdAt: Date;
    computedAt?: Date;
}

export interface CozoCommunityMember {
    communityId: string;
    entityId: string;
    membershipScore?: number;
    addedAt: Date;
}

export interface CozoGraphStats {
    id: string;
    scopeType: GraphScope;
    scopeId: string;
    groupId: string;
    entityCount: number;
    edgeCount: number;
    episodeCount: number;
    avgDegree: number;
    density: number;
    computedAt: Date;
}

export type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'failed';

export interface CozoScopeProcessingState {
    scopeType: GraphScope;
    scopeId: string;
    groupId: string;
    lastProcessedAt?: Date;
    status: ProcessingStatus;
    progressPct: number;
    currentStep?: string;
    errorMessage?: string;
}

export interface CozoQueryResult<T = unknown> {
    ok: boolean;
    rows?: T[];
    headers?: string[];
    took?: number;
    message?: string;
}


export function mapRowToEntity(row: unknown[]): CozoEntity {
    return {
        id: row[0] as string,
        name: row[1] as string,
        entityKind: row[2] as CozoEntityKind,
        entitySubtype: row[3] as string | undefined,
        groupId: row[4] as string,
        scopeType: row[5] as GraphScope,
        createdAt: new Date(row[6] as number),
        extractionMethod: row[7] as 'regex' | 'llm' | 'manual',
        summary: row[8] as string | undefined,
        aliases: row[9] as string[],
        canonicalNoteId: row[10] as string | undefined,
        frequency: row[11] as number,
        degreeCentrality: row[12] as number | undefined,
        betweennessCentrality: row[13] as number | undefined,
        closenessCentrality: row[14] as number | undefined,
        communityId: row[15] as string | undefined,
        attributes: row[16] as Record<string, unknown> | undefined,
        temporalSpan: row[17] as CozoTemporalSpan | undefined,
        participants: row[18] as string[],
        narrativeId: row[19] as string | undefined,
    };
}

export function mapRowToEntityEdge(row: unknown[]): CozoEntityEdge {
    return {
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        createdAt: new Date(row[3] as number),
        validAt: new Date(row[4] as number),
        invalidAt: row[5] ? new Date(row[5] as number) : undefined,
        groupId: row[6] as string,
        scopeType: row[7] as GraphScope,
        edgeType: row[8] as string,
        fact: row[9] as string | undefined,
        episodeIds: row[10] as string[],
        noteIds: row[11] as string[],
        weight: row[12] as number,
        pmiScore: row[13] as number | undefined,
        confidence: row[14] as number,
        extractionMethods: row[15] as string[],
    };
}

export interface CozoFolderHierarchyEdge {
    id: string;
    parentId: string;
    childId: string;
    createdAt: Date;
    validAt: Date;
    invalidAt?: Date;
    groupId: string;
    scopeType: GraphScope;
    edgeType: string;
    inverseType: string;
    parentEntityKind?: string;
    childEntityKind?: string;
    confidence: number;
    extractionMethods: string[];
    narrativeId: string;
}

export interface CozoNetworkInstance {
    id: string;
    name: string;
    schemaId: string;
    networkKind: string;
    networkSubtype?: string;
    rootFolderId: string;
    rootEntityId?: string;
    namespace: string;
    description?: string;
    tags: string[];
    memberCount: number;
    relationshipCount: number;
    maxDepth: number;
    createdAt: Date;
    updatedAt: Date;
    groupId: string;
    scopeType: GraphScope;
    narrativeId: string;
}

export interface CozoNetworkMembership {
    id: string;
    networkId: string;
    entityId: string;
    role?: string;
    joinedAt: Date;
    leftAt?: Date;
    isRoot: boolean;
    depthLevel: number;
    createdAt: Date;
    updatedAt: Date;
    groupId: string;
    extractionMethods: string[];
    narrativeId: string;
}

export interface CozoNetworkRelationship {
    id: string;
    networkId: string;
    sourceId: string;
    targetId: string;
    relationshipCode: string;
    inverseCode?: string;
    startDate?: Date;
    endDate?: Date;
    strength: number;
    notes?: string;
    attributes?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    groupId: string;
    scopeType: GraphScope;
    confidence: number;
    extractionMethods: string[];
    narrativeId: string;
}

export type UnifiedEdgeSource = 'entity_edge' | 'folder_hierarchy' | 'network_relationship';

export interface CozoUnifiedEdge {
    id: string;
    sourceId: string;
    targetId: string;
    edgeType: string;
    confidence: number;
    sources: string[];
    groupId: string;
    edgeSource: UnifiedEdgeSource;
    direction?: 'outgoing' | 'incoming';
    narrativeId?: string;
}

export function mapRowToFolderHierarchyEdge(row: unknown[]): CozoFolderHierarchyEdge {
    return {
        id: row[0] as string,
        parentId: row[1] as string,
        childId: row[2] as string,
        createdAt: new Date(row[3] as number),
        validAt: new Date(row[4] as number),
        invalidAt: row[5] ? new Date(row[5] as number) : undefined,
        groupId: row[6] as string,
        scopeType: row[7] as GraphScope,
        edgeType: row[8] as string,
        inverseType: row[9] as string,
        parentEntityKind: row[10] as string | undefined,
        childEntityKind: row[11] as string | undefined,
        confidence: row[12] as number,
        extractionMethods: row[13] as string[],
        narrativeId: row[14] as string,
    };
}

export function mapRowToNetworkInstance(row: unknown[]): CozoNetworkInstance {
    return {
        id: row[0] as string,
        name: row[1] as string,
        schemaId: row[2] as string,
        networkKind: row[3] as string,
        networkSubtype: row[4] as string | undefined,
        rootFolderId: row[5] as string,
        rootEntityId: row[6] as string | undefined,
        namespace: row[7] as string,
        description: row[8] as string | undefined,
        tags: row[9] as string[],
        memberCount: row[10] as number,
        relationshipCount: row[11] as number,
        maxDepth: row[12] as number,
        createdAt: new Date(row[13] as number),
        updatedAt: new Date(row[14] as number),
        groupId: row[15] as string,
        scopeType: row[16] as GraphScope,
        narrativeId: row[17] as string,
    };
}

export function mapRowToNetworkMembership(row: unknown[]): CozoNetworkMembership {
    return {
        id: row[0] as string,
        networkId: row[1] as string,
        entityId: row[2] as string,
        role: row[3] as string | undefined,
        joinedAt: new Date(row[4] as number),
        leftAt: row[5] ? new Date(row[5] as number) : undefined,
        isRoot: row[6] as boolean,
        depthLevel: row[7] as number,
        createdAt: new Date(row[8] as number),
        updatedAt: new Date(row[9] as number),
        groupId: row[10] as string,
        extractionMethods: row[11] as string[],
        narrativeId: row[12] as string,
    };
}

export function mapRowToNetworkRelationship(row: unknown[]): CozoNetworkRelationship {
    return {
        id: row[0] as string,
        networkId: row[1] as string,
        sourceId: row[2] as string,
        targetId: row[3] as string,
        relationshipCode: row[4] as string,
        inverseCode: row[5] as string | undefined,
        startDate: row[6] ? new Date(row[6] as number) : undefined,
        endDate: row[7] ? new Date(row[7] as number) : undefined,
        strength: row[8] as number,
        notes: row[9] as string | undefined,
        attributes: row[10] as Record<string, unknown> | undefined,
        createdAt: new Date(row[11] as number),
        updatedAt: new Date(row[12] as number),
        groupId: row[13] as string,
        scopeType: row[14] as GraphScope,
        confidence: row[15] as number,
        extractionMethods: row[16] as string[],
        narrativeId: row[17] as string,
    };
}

export function mapRowToUnifiedEdge(row: unknown[]): CozoUnifiedEdge {
    return {
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        edgeType: row[3] as string,
        confidence: row[4] as number,
        sources: row[5] as string[],
        groupId: row[6] as string,
        edgeSource: row[7] as UnifiedEdgeSource,
        direction: row[8] as 'outgoing' | 'incoming' | undefined,
        narrativeId: row[9] as string | undefined,
    };
}

export type LinkType = 'mention' | 'explicit' | 'implicit';
export type MentionType = 'explicit' | 'implicit' | 'inferred';
export type LinkCreatedBy = 'user' | 'auto-extraction' | 'ai-inference';
export type PositionType = 'title' | 'heading' | 'body' | 'footnote';

export interface CozoBidirectionalLink {
    id: string;
    sourceId: string;
    targetId: string;
    linkType: LinkType;
    mentionType: MentionType;
    createdBy: LinkCreatedBy;

    context: string;
    charPosition: number;
    sentenceIndex?: number;

    positionType: PositionType;
    positionWeight: number;

    relevance: number;
    frequencyScore: number;
    contextScore: number;
    temporalScore: number;

    confidence: number;
    validated: boolean;

    createdAt: Date;
    updatedAt: Date;
}

export interface CozoEntityBacklink {
    id: string;
    entityId: string;
    noteId: string;

    mentionCount: number;
    avgRelevance: number;
    firstMentionPos: number;
    lastMentionPos: number;

    noteTitle: string;

    createdAt: Date;
    updatedAt: Date;
}

export interface EntityMentionEvent {
    type: 'entityMentioned' | 'entityRemoved';
    noteId: string;
    entityId: string;
    mention: {
        text: string;
        position: number;
        context: string;
        mentionType: MentionType;
        positionType: PositionType;
    };
    timestamp: number;
}

export function mapRowToBidirectionalLink(row: unknown[]): CozoBidirectionalLink {
    return {
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        linkType: row[3] as LinkType,
        mentionType: row[4] as MentionType,
        createdBy: row[5] as LinkCreatedBy,
        context: row[6] as string,
        charPosition: row[7] as number,
        sentenceIndex: row[8] as number | undefined,
        positionType: row[9] as PositionType,
        positionWeight: row[10] as number,
        relevance: row[11] as number,
        frequencyScore: row[12] as number,
        contextScore: row[13] as number,
        temporalScore: row[14] as number,
        confidence: row[15] as number,
        validated: row[16] as boolean,
        createdAt: new Date(row[17] as number),
        updatedAt: new Date(row[18] as number),
    };
}

export function mapRowToEntityBacklink(row: unknown[]): CozoEntityBacklink {
    return {
        id: row[0] as string,
        entityId: row[1] as string,
        noteId: row[2] as string,
        mentionCount: row[3] as number,
        avgRelevance: row[4] as number,
        firstMentionPos: row[5] as number,
        lastMentionPos: row[6] as number,
        noteTitle: row[7] as string,
        createdAt: new Date(row[8] as number),
        updatedAt: new Date(row[9] as number),
    };
}
