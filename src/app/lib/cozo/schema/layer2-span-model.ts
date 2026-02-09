/**
 * Span-First Data Model Schemas for CozoDB
 *
 * These relations support the immutable facts layer:
 * - Spans: Immutable text facts with Web Annotation selectors
 * - Wormholes: Binding contracts between spans (cross-world links)
 * - SpanMentions: Span → candidate entity evidence
 *
 * See: docs/cozo-span-migration-plan.md for full design rationale
 */

/**
 * Spans Relation
 *
 * An immutable fact representing a text span in a document.
 * Uses Web Annotation selectors for position.
 *
 * Indexes:
 * - Primary: id (key attribute)
 * - By note: note_id
 * - By world + position: world_id, start, end
 * - By content hash: content_hash (for deduplication)
 * - By status: status
 */
export const SPANS_SCHEMA = `:create spans {
    id: String =>
    world_id: String,
    note_id: String,
    narrative_id: String?,
    start: Int,
    end: Int,
    text: String,
    content_hash: String,
    span_kind: String,
    status: String,
    created_by: String,
    created_at: Float,
    updated_at: Float
}`;

/**
 * Wormholes Relation
 *
 * A binding contract between two spans. Spans can be in the same
 * or different documents. Wormholes are NOT entity-to-entity.
 *
 * Indexes:
 * - Primary: id (key attribute)
 * - By source span: src_span_id
 * - By destination span: dst_span_id
 * - By span pair: src_span_id + dst_span_id (unique)
 */
export const WORMHOLES_SCHEMA = `:create wormholes {
    id: String =>
    src_span_id: String,
    dst_span_id: String,
    mode: String,
    confidence: Float,
    rationale: String?,
    wormhole_type: String?,
    bidirectional: Bool,
    created_at: Float,
    updated_at: Float
}`;

/**
 * Span Mentions Relation
 *
 * Links a Span to a candidate Entity. The span is ground truth;
 * entity linkage is derived/optional.
 *
 * Evidence vector is flattened for Cozo (ev_* fields).
 *
 * Indexes:
 * - Primary: id (key attribute)
 * - By span: span_id
 * - By entity: candidate_entity_id
 * - By span + entity: span_id + candidate_entity_id (unique)
 */
export const SPAN_MENTIONS_SCHEMA = `:create span_mentions {
    id: String =>
    span_id: String,
    candidate_entity_id: String?,
    match_type: String,
    confidence: Float,
    ev_frequency: Float?,
    ev_capital_ratio: Float?,
    ev_context_score: Float?,
    ev_cooccurrence: Float?,
    status: String,
    created_at: Float,
    updated_at: Float
}`;

/**
 * TypeScript interfaces for Span model
 */
export interface CozoSpan {
    id: string;
    world_id: string;
    note_id: string;
    narrative_id?: string;
    start: number;
    end: number;
    text: string;
    content_hash: string;
    span_kind: 'entity' | 'claim' | 'quote' | 'note';
    status: 'active' | 'detached' | 'reanchored';
    created_by: 'user' | 'scanner' | 'llm';
    created_at: number;
    updated_at: number;
}

export interface CozoWormhole {
    id: string;
    src_span_id: string;
    dst_span_id: string;
    mode: 'user' | 'suggested' | 'auto';
    confidence: number;
    rationale?: string;
    wormhole_type?: string;
    bidirectional: boolean;
    created_at: number;
    updated_at: number;
}

export interface CozoSpanMention {
    id: string;
    span_id: string;
    candidate_entity_id?: string;
    match_type: 'exact' | 'alias' | 'fuzzy' | 'inferred';
    confidence: number;
    ev_frequency?: number;
    ev_capital_ratio?: number;
    ev_context_score?: number;
    ev_cooccurrence?: number;
    status: 'pending' | 'accepted' | 'rejected';
    created_at: number;
    updated_at: number;
}
