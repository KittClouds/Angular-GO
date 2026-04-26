/**
 * Shared types index.
 * Use these app-facing types instead of importing persistence-specific internals.
 */

export type {
    EntityKind,
    GraphScope,
    ExtractionMethod,
    ConfidenceLevel,
} from './entity';

export {
    ENTITY_KINDS,
    isEntityKind,
    getEntityKindLabel,
} from './entity';

export type {
    Span,
    SpanKind,
    SpanStatus,
    SpanCreator,
    Wormhole,
    WormholeMode,
    SpanMention,
    MatchType,
    MentionStatus,
} from './span';
