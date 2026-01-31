// src/lib/Scanner/pattern-scanner.ts
// Pattern-based scanner for entities, entity refs, and note links
// V3: Clean mental model - [KIND|Label] for entities, [[ref]] for entity refs, <<note>> for notes

import type { DecorationSpan, EntityKind, SpanType } from './types';
import { smartGraphRegistry } from '../registry';

// =============================================================================
// CLEAN PATTERNS
// =============================================================================

// Entity Tag: [KIND|Label] or [KIND|Label|{metadata}] - creates/references entity with explicit type
// The label is captured in group 2, metadata (if present) is in group 3 but ignored for display
const ENTITY_TAG_PATTERN = /\[([A-Z_]+)\|([^|\]]+)(?:\|[^\]]+)?\]/g;

// Entity Reference: [[entity]] - references existing entity by label
const ENTITY_REF_PATTERN = /\[\[([^\]]+)\]\]/g;

// Note Link: <<note>> - links to note by title (NOT an entity)
const NOTE_LINK_PATTERN = /<<([^>]+)>>/g;

// Relationship patterns (use entity refs or note links)
// Parenthesized: [A] (VERB) [B] - no arrow, just parenthesized predicate
// Updated to handle [KIND|Label|{metadata}] format
const RELATIONSHIP_PAREN = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])\s*\(([A-Za-z][A-Za-z0-9_]*)\)\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])/g;

// Arrow with explicit predicate: [A] ->VERB-> [B] or [A] <-VERB<- [B]
// These capture the full arrow+verb syntax for predicate highlighting
const ARROW_FORWARD_VERB = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])\s*->([A-Z][A-Z0-9_]*)->\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])/g;
const ARROW_BACKWARD_VERB = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])\s*<-([A-Z][A-Z0-9_]*)<-\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\])/g;

// Generic arrow-based relationships (without explicit verb)
const RELATIONSHIP_FORWARD = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)\s*(?:\(([A-Z_]+)\))?\s*->\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)/g;
const RELATIONSHIP_BACKWARD = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)\s*(?:\(([A-Z_]+)\))?\s*<-\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)/g;
const RELATIONSHIP_BIDIR = /(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)\s*(?:\(([A-Z_]+)\))?\s*<->\s*(\[[A-Z_]+\|[^|\]]+(?:\|[^\]]+)?\]|\[\[[^\]]+\]\]|<<[^>]+>>)/g;

// =============================================================================
// Scanner
// =============================================================================

/**
 * Scan text for all patterns and return decoration spans.
 * Also auto-registers new entities to the registry (batch mode).
 */
export async function scanForPatterns(text: string, noteId?: string): Promise<DecorationSpan[]> {
    const spans: DecorationSpan[] = [];
    const processedRanges: [number, number][] = [];
    const entitiesToRegister: Array<{ label: string; kind: EntityKind; noteId: string }> = [];

    const overlaps = (from: number, to: number) => {
        return processedRanges.some(([s, e]) => from < e && to > s);
    };
    const addRange = (from: number, to: number) => {
        processedRanges.push([from, to]);
    };

    // 1. Entity Tags: [KIND|Label] - Collect for batch registration
    scanWithPattern(text, ENTITY_TAG_PATTERN, (match, index) => {
        const [fullMatch, kind, label] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        // Collect for batch registration
        if (noteId) {
            entitiesToRegister.push({ label, kind: (kind as EntityKind) || 'UNKNOWN', noteId });
        }

        spans.push({
            type: 'entity',
            from: index,
            to: index + fullMatch.length,
            label,
            kind: kind as EntityKind,
            resolved: true,
        });
    });

    // Batch register all collected entities (single hydration)
    if (entitiesToRegister.length > 0) {
        smartGraphRegistry.registerEntityBatch(
            entitiesToRegister.map(e => ({
                label: e.label,
                kind: e.kind,
                noteId: e.noteId,
                options: { source: 'auto' as const },
            }))
        );
    }


    // 2. Entity References: [[entity]] - Lookup only
    scanWithPattern(text, ENTITY_REF_PATTERN, (match, index) => {
        const [fullMatch, label] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        const existing = smartGraphRegistry.findEntityByLabel(label);
        spans.push({
            type: 'entity_ref',
            from: index,
            to: index + fullMatch.length,
            label,
            target: label,
            kind: existing?.kind,
            resolved: !!existing,
        });
    });

    // 3. Note Links: <<note>> - No entity involvement
    scanWithPattern(text, NOTE_LINK_PATTERN, (match, index) => {
        const [fullMatch, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'wikilink',
            from: index,
            to: index + fullMatch.length,
            label: target,
            target,
            resolved: true, // Will be resolved by navigation
        });
    });

    // 4. Relationships
    scanWithPattern(text, RELATIONSHIP_BIDIR, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(source),
            targetEntity: extractEntityName(target),
            verb: verb || 'RELATES_TO',
            direction: 'bidirectional',
        });
    });

    scanWithPattern(text, RELATIONSHIP_FORWARD, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(source),
            targetEntity: extractEntityName(target),
            verb: verb || 'RELATES_TO',
            direction: 'forward',
        });
    });

    scanWithPattern(text, RELATIONSHIP_BACKWARD, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(target),
            targetEntity: extractEntityName(source),
            verb: verb || 'RELATES_TO',
            direction: 'backward',
        });
    });

    spans.sort((a, b) => a.from - b.from);
    return spans;
}

/**
 * Sync version for decoration building (no auto-registration)
 * NOTE: Order matters! Longer patterns (relationships) must be processed FIRST
 * to prevent shorter patterns (entities) from consuming parts of the match.
 */
export function scanForPatternsSync(text: string): DecorationSpan[] {
    const spans: DecorationSpan[] = [];
    const processedRanges: [number, number][] = [];

    const overlaps = (from: number, to: number) => {
        return processedRanges.some(([s, e]) => from < e && to > s);
    };
    const addRange = (from: number, to: number) => {
        processedRanges.push([from, to]);
    };

    // =========================================================================
    // 1. RELATIONSHIPS FIRST (longest patterns - must win over entities)
    // =========================================================================

    // Parenthesized: [A] (VERB) [B] - Emit as 3 separate spans: subject, predicate, object
    // This allows entities to render as pills while the predicate gets subtle highlighting
    scanWithPattern(text, RELATIONSHIP_PAREN, (match, index) => {
        const fullMatch = match[0];
        const source = match[1];     // [KIND|Label]
        const verb = match[2];       // VERB (without parens)
        const target = match[3];     // [KIND|Label]

        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        // Calculate positions for each component
        const sourceStart = index;
        const sourceEnd = sourceStart + source.length;

        // Find predicate position (look for opening paren after source)
        const afterSource = fullMatch.substring(source.length);
        const parenOpenOffset = afterSource.indexOf('(');
        const parenCloseOffset = afterSource.indexOf(')');
        const predStart = sourceEnd + parenOpenOffset;
        const predEnd = sourceEnd + parenCloseOffset + 1;

        const targetStart = index + fullMatch.length - target.length;
        const targetEnd = index + fullMatch.length;

        // Extract entity kind/label from source
        const sourceMatch = source.match(/\[([A-Z_]+)\|([^|\]]+)/);
        const targetMatch = target.match(/\[([A-Z_]+)\|([^|\]]+)/);

        // Emit subject entity span
        if (sourceMatch) {
            spans.push({
                type: 'entity',
                from: sourceStart,
                to: sourceEnd,
                label: sourceMatch[2],
                kind: sourceMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(sourceMatch[2]),
            });
        }

        // Emit predicate span (subtle highlight)
        spans.push({
            type: 'predicate',
            from: predStart,
            to: predEnd,
            label: verb,
            verb: verb,
            sourceEntity: sourceMatch?.[2],
            targetEntity: targetMatch?.[2],
        });

        // Emit object entity span
        if (targetMatch) {
            spans.push({
                type: 'entity',
                from: targetStart,
                to: targetEnd,
                label: targetMatch[2],
                kind: targetMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(targetMatch[2]),
            });
        }
    });

    // Forward arrow with verb: [A] ->VERB-> [B] - Emit as 3 spans
    scanWithPattern(text, ARROW_FORWARD_VERB, (match, index) => {
        const fullMatch = match[0];
        const source = match[1];     // [KIND|Label]
        const verb = match[2];       // VERB (without arrows)
        const target = match[3];     // [KIND|Label]

        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        // Calculate positions
        const sourceStart = index;
        const sourceEnd = sourceStart + source.length;

        // Find arrow predicate position: ->VERB->
        const arrowStart = sourceEnd + fullMatch.substring(source.length).search(/->/);
        const arrowEnd = index + fullMatch.lastIndexOf('->') + 2;

        const targetStart = index + fullMatch.length - target.length;
        const targetEnd = index + fullMatch.length;

        const sourceMatch = source.match(/\[([A-Z_]+)\|([^|\]]+)/);
        const targetMatch = target.match(/\[([A-Z_]+)\|([^|\]]+)/);

        // Emit subject entity span
        if (sourceMatch) {
            spans.push({
                type: 'entity',
                from: sourceStart,
                to: sourceEnd,
                label: sourceMatch[2],
                kind: sourceMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(sourceMatch[2]),
            });
        }

        // Emit arrow predicate span (->VERB->)
        spans.push({
            type: 'predicate',
            from: arrowStart,
            to: arrowEnd,
            label: verb,
            verb: verb,
            sourceEntity: sourceMatch?.[2],
            targetEntity: targetMatch?.[2],
        });

        // Emit object entity span
        if (targetMatch) {
            spans.push({
                type: 'entity',
                from: targetStart,
                to: targetEnd,
                label: targetMatch[2],
                kind: targetMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(targetMatch[2]),
            });
        }
    });

    // Backward arrow with verb: [A] <-VERB<- [B] - Emit as 3 spans
    scanWithPattern(text, ARROW_BACKWARD_VERB, (match, index) => {
        const fullMatch = match[0];
        const source = match[1];     // [KIND|Label] (actually the OBJECT in backward syntax)
        const verb = match[2];       // VERB (without arrows)
        const target = match[3];     // [KIND|Label] (actually the SUBJECT in backward syntax)

        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        // Calculate positions
        const sourceStart = index;
        const sourceEnd = sourceStart + source.length;

        // Find arrow predicate position: <-VERB<-
        const arrowStart = sourceEnd + fullMatch.substring(source.length).search(/<-/);
        const arrowEnd = index + fullMatch.lastIndexOf('<-') + 2;

        const targetStart = index + fullMatch.length - target.length;
        const targetEnd = index + fullMatch.length;

        const sourceMatch = source.match(/\[([A-Z_]+)\|([^|\]]+)/);
        const targetMatch = target.match(/\[([A-Z_]+)\|([^|\]]+)/);

        // Emit first entity span (object in backward syntax)
        if (sourceMatch) {
            spans.push({
                type: 'entity',
                from: sourceStart,
                to: sourceEnd,
                label: sourceMatch[2],
                kind: sourceMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(sourceMatch[2]),
            });
        }

        // Emit arrow predicate span (<-VERB<-)
        spans.push({
            type: 'predicate',
            from: arrowStart,
            to: arrowEnd,
            label: verb,
            verb: verb,
            // Swap source/target for backward arrows
            sourceEntity: targetMatch?.[2],
            targetEntity: sourceMatch?.[2],
        });

        // Emit second entity span (subject in backward syntax)
        if (targetMatch) {
            spans.push({
                type: 'entity',
                from: targetStart,
                to: targetEnd,
                label: targetMatch[2],
                kind: targetMatch[1] as EntityKind,
                resolved: smartGraphRegistry.isRegisteredEntity(targetMatch[2]),
            });
        }
    });

    // Bidirectional: [A] <-> [B]
    scanWithPattern(text, RELATIONSHIP_BIDIR, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(source),
            targetEntity: extractEntityName(target),
            verb: verb || 'RELATES_TO',
            direction: 'bidirectional',
        });
    });

    // Forward: [A] -> [B] or [A] (VERB) -> [B]
    scanWithPattern(text, RELATIONSHIP_FORWARD, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(source),
            targetEntity: extractEntityName(target),
            verb: verb || 'RELATES_TO',
            direction: 'forward',
        });
    });

    // Backward: [A] <- [B] or [A] (VERB) <- [B]
    scanWithPattern(text, RELATIONSHIP_BACKWARD, (match, index) => {
        const [fullMatch, source, verb, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'relationship',
            from: index,
            to: index + fullMatch.length,
            label: verb || 'RELATES_TO',
            sourceEntity: extractEntityName(target),
            targetEntity: extractEntityName(source),
            verb: verb || 'RELATES_TO',
            direction: 'backward',
        });
    });

    // =========================================================================
    // 2. ENTITIES (shorter patterns - only match if not part of relationship)
    // =========================================================================

    // Entity Tags: [KIND|Label]
    scanWithPattern(text, ENTITY_TAG_PATTERN, (match, index) => {
        const [fullMatch, kind, label] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'entity',
            from: index,
            to: index + fullMatch.length,
            label,
            kind: kind as EntityKind,
            resolved: smartGraphRegistry.isRegisteredEntity(label),
        });
    });

    // =========================================================================
    // 3. ENTITY REFERENCES
    // =========================================================================

    // Entity References: [[entity]]
    scanWithPattern(text, ENTITY_REF_PATTERN, (match, index) => {
        const [fullMatch, label] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        const existing = smartGraphRegistry.findEntityByLabel(label);
        spans.push({
            type: 'entity_ref',
            from: index,
            to: index + fullMatch.length,
            label,
            target: label,
            kind: existing?.kind,
            resolved: !!existing,
        });
    });

    // =========================================================================
    // 4. NOTE LINKS
    // =========================================================================

    // Note Links: <<note>>
    scanWithPattern(text, NOTE_LINK_PATTERN, (match, index) => {
        const [fullMatch, target] = match;
        if (overlaps(index, index + fullMatch.length)) return;
        addRange(index, index + fullMatch.length);

        spans.push({
            type: 'wikilink',
            from: index,
            to: index + fullMatch.length,
            label: target,
            target,
            resolved: true,
        });
    });

    spans.sort((a, b) => a.from - b.from);
    return spans;
}

// =============================================================================
// Helpers
// =============================================================================

function scanWithPattern(
    text: string,
    pattern: RegExp,
    callback: (match: RegExpExecArray, index: number) => void
): void {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        callback(match, match.index);
    }
}

async function scanWithPatternAsync(
    text: string,
    pattern: RegExp,
    callback: (match: RegExpExecArray, index: number) => Promise<void>
): Promise<void> {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        await callback(match, match.index);
    }
}

function extractEntityName(ref: string): string {
    // [KIND|Name] or [KIND|Name|{metadata}] → Name (stop at | or ])
    const tagMatch = ref.match(/\[([A-Z_]+)\|([^|\]]+)/);
    if (tagMatch) return tagMatch[2];

    // [[Name]] → Name
    const refMatch = ref.match(/\[\[([^\]]+)\]\]/);
    if (refMatch) return refMatch[1];

    // <<Name>> → Name
    const noteMatch = ref.match(/<<([^>]+)>>/);
    if (noteMatch) return noteMatch[1];

    return ref;
}

/**
 * Scan a ProseMirror-like document structure.
 */
export function scanDocument(
    doc: { descendants: (callback: (node: { isText?: boolean; text?: string }, pos: number) => void) => void }
): DecorationSpan[] {
    const spans: DecorationSpan[] = [];

    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;

        const nodeSpans = scanForPatternsSync(node.text);
        for (const span of nodeSpans) {
            spans.push({
                ...span,
                from: pos + span.from,
                to: pos + span.to,
            });
        }
    });

    return spans;
}

// Legacy export
export function scanForEntities(text: string): DecorationSpan[] {
    return scanForPatternsSync(text).filter(s => s.type === 'entity');
}
