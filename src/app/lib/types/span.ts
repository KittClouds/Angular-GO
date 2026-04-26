/**
 * Span types for use across the application.
 * These represent immutable text facts with Web Annotation selectors.
 */

/**
 * Span represents an immutable text span in a document.
 * Uses Web Annotation selectors for position.
 */
export interface Span {
    id: string;
    worldId: string;
    noteId: string;
    narrativeId?: string;
    start: number;
    end: number;
    text: string;
    contentHash: string;
    spanKind: SpanKind;
    status: SpanStatus;
    createdBy: SpanCreator;
    createdAt: number;
    updatedAt: number;
}

/**
 * Kinds of spans that can be extracted.
 */
export type SpanKind = 'entity' | 'claim' | 'quote' | 'note';

/**
 * Span lifecycle status.
 */
export type SpanStatus = 'active' | 'detached' | 'reanchored';

/**
 * Who created the span.
 */
export type SpanCreator = 'user' | 'scanner' | 'llm';

/**
 * Wormhole represents a binding contract between two spans.
 * Spans can be in the same or different documents.
 */
export interface Wormhole {
    id: string;
    srcSpanId: string;
    dstSpanId: string;
    mode: WormholeMode;
    confidence: number;
    rationale?: string;
    wormholeType?: string;
    bidirectional: boolean;
    createdAt: number;
    updatedAt: number;
}

/**
 * How the wormhole was created.
 */
export type WormholeMode = 'user' | 'suggested' | 'auto';

/**
 * SpanMention links a Span to a candidate Entity.
 * The span is ground truth; entity linkage is derived/optional.
 */
export interface SpanMention {
    id: string;
    spanId: string;
    candidateEntityId?: string;
    matchType: MatchType;
    confidence: number;
    evFrequency?: number;
    evCapitalRatio?: number;
    evContextScore?: number;
    evCooccurrence?: number;
    status: MentionStatus;
    createdAt: number;
    updatedAt: number;
}

/**
 * How the entity was matched to the span.
 */
export type MatchType = 'exact' | 'alias' | 'fuzzy' | 'inferred';

/**
 * Status of the entity linkage.
 */
export type MentionStatus = 'pending' | 'accepted' | 'rejected';
