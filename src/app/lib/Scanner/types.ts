// src/lib/Scanner/types.ts
// Scanner types - core data structures for entities and relationships

/**
 * Entity kinds supported by the scanner
 */
export type EntityKind =
    | 'CHARACTER'
    | 'LOCATION'
    | 'ORGANIZATION'
    | 'ITEM'
    | 'CONCEPT'
    | 'EVENT'
    | 'FACTION'
    | 'CREATURE'
    | 'NPC'
    | 'SCENE'
    | 'ARC'
    | 'ACT'
    | 'CHAPTER'
    | 'BEAT'
    | 'TIMELINE'
    | 'NARRATIVE'
    | 'NETWORK'
    | 'CUSTOM'
    | 'UNKNOWN';

/**
 * Types of detected spans
 */
export type SpanType = 'entity' | 'wikilink' | 'entity_ref' | 'relationship' | 'entity_implicit' | 'predicate' | 'entity_candidate';

/**
 * A decoration span representing a detected element in text
 */
export interface DecorationSpan {
    /** Type of span */
    type: SpanType;
    /** Start offset in document */
    from: number;
    /** End offset in document */
    to: number;
    /** Display label (canonical entity name) */
    label: string;
    /** Entity kind for styling (entity spans only) */
    kind?: EntityKind;
    /** Target note/entity name */
    target?: string;
    /** Display alias (for [[target|alias]] syntax) */
    displayText?: string;
    /** Actual matched text in document (for implicit matches, may differ from label) */
    matchedText?: string;
    /** Optional entity ID (if resolved) */
    entityId?: string;
    /** Optional note ID (if resolved) */
    noteId?: string;
    /** Whether the link is resolved */
    resolved?: boolean;
    /** For relationships: source entity */
    sourceEntity?: string;
    /** For relationships: target entity */
    targetEntity?: string;
    /** For relationships: verb/relation type */
    verb?: string;
    /** For relationships: direction 'forward' | 'backward' | 'bidirectional' */
    direction?: 'forward' | 'backward' | 'bidirectional';
    /** Candidates for ambiguous matches */
    candidateIds?: string[];
    /** Labels for ambiguous candidates */
    candidateLabels?: string[];
}

/**
 * Registered entity from the registry
 */
export interface RegisteredEntity {
    id: string;
    label: string;
    kind: EntityKind;
    aliases?: string[];
    /** Note ID where entity was first registered */
    originNoteId?: string;
    /** Timestamp of first registration */
    registeredAt: number;
}

/**
 * Result of scanning a document
 */
export interface ScanResult {
    /** Document ID that was scanned */
    docId: string;
    /** Decoded spans for decoration */
    spans: DecorationSpan[];
    /** New entities discovered in this scan */
    newEntities: RegisteredEntity[];
    /** Timestamp of scan */
    scannedAt: number;
}

/**
 * Highlighting mode
 */
export type HighlightMode = 'vivid' | 'clean' | 'focus' | 'off';

/**
 * Configuration for the highlighter
 */
export interface HighlighterConfig {
    mode: HighlightMode;
    /** Entity kinds to highlight in focus mode (empty = all) */
    focusKinds?: EntityKind[];
    /** Enable wikilinks [[]] */
    enableWikilinks?: boolean;
    /** Enable entity refs <<>> */
    enableEntityRefs?: boolean;
    /** Enable relationship arrows */
    enableRelationships?: boolean;
    /** Widget mode: show pills instead of inline decorations */
    widgetMode?: boolean;
}
