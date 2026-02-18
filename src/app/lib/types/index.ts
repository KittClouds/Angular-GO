/**
 * Shared types index - exports all types extracted from CozoDB.
 * Use these types instead of importing from the deprecated cozo directory.
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
