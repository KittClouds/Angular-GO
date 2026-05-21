import { db, type EntityNoteIndex, type EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

export interface AcceptedEntityAnchorInput {
    noteId: string;
    entity: RegisteredEntity;
    surface: string;
    plainText?: string;
    confidence?: number;
    generation?: number;
    context?: string;
}

export async function recordAcceptedEntityAnchor(input: AcceptedEntityAnchorInput): Promise<EntityOccurrence | null> {
    if (!canUseOccurrenceTables() || !input.noteId || !input.entity?.id) return null;
    const note = await db.notes.get(input.noteId);
    const text = input.plainText || note?.markdownContent || '';
    const span = findSurfaceSpan(text, input.surface);
    if (!span) return null;

    const now = Date.now();
    const generation = input.generation || note?.version || note?.updatedAt || now;
    const occurrence: EntityOccurrence = {
        id: `${input.noteId}:${input.entity.id}:${span.from}:${span.to}:machine_suggestion`,
        noteId: input.noteId,
        entityId: input.entity.id,
        entityLabel: input.entity.label,
        entityKind: input.entity.kind,
        targetNoteId: input.entity.firstNote || undefined,
        sourceStart: span.from,
        sourceEnd: span.to,
        surface: text.slice(span.from, span.to) || input.surface,
        source: 'machine_suggestion',
        confidence: clamp(input.confidence ?? 0.85, 0, 1),
        excerpt: buildExcerpt(text || input.context || input.surface, span.from, span.to),
        worldId: note?.worldId,
        narrativeId: note?.narrativeId,
        folderId: note?.folderId,
        generation,
        createdAt: now,
        updatedAt: now,
    };

    await db.transaction('rw', db.entityOccurrences, db.entityNoteIndex, async () => {
        await db.entityOccurrences.put(occurrence);
        const rows = await db.entityOccurrences
            .where('[noteId+entityId]')
            .equals([input.noteId, input.entity.id])
            .toArray();
        await db.entityNoteIndex.put(summarizeEntity(input.noteId, input.entity, rows, generation, now));
    });

    dispatchAnchorEvent(input.noteId);
    return occurrence;
}

function summarizeEntity(
    noteId: string,
    entity: RegisteredEntity,
    rows: EntityOccurrence[],
    generation: number,
    now: number,
): EntityNoteIndex {
    const sorted = [...rows].sort((left, right) => left.sourceStart - right.sourceStart);
    const best = sorted.reduce((current, row) => sourceRank(row.source) > sourceRank(current.source) ? row : current, sorted[0]);
    return {
        id: `${noteId}:${entity.id}`,
        noteId,
        entityId: entity.id,
        entityLabel: entity.label,
        entityKind: entity.kind,
        targetNoteId: entity.firstNote || undefined,
        occurrenceCount: rows.length,
        bestSource: best?.source || 'machine_suggestion',
        maxConfidence: rows.reduce((max, row) => Math.max(max, row.confidence), 0),
        firstStart: sorted[0]?.sourceStart ?? 0,
        lastEnd: sorted[sorted.length - 1]?.sourceEnd ?? 0,
        worldId: sorted[0]?.worldId,
        narrativeId: sorted[0]?.narrativeId,
        folderId: sorted[0]?.folderId,
        generation,
        updatedAt: now,
    };
}

function findSurfaceSpan(text: string, surface: string): { from: number; to: number } | null {
    const needle = String(surface || '').trim();
    if (!text || !needle) return null;
    const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    return index >= 0 ? { from: index, to: index + needle.length } : null;
}

function buildExcerpt(text: string, from: number, to: number): string {
    const start = Math.max(0, from - 90);
    const end = Math.min(text.length, to + 90);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function sourceRank(source: EntityOccurrence['source']): number {
    if (source === 'manual_tag') return 4;
    if (source === 'dictionary_match') return 3;
    if (source === 'machine_evidence') return 2;
    return 1;
}

function dispatchAnchorEvent(noteId: string): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('graph-rebuild-anchors-changed', { detail: { noteId } }));
    }
}

function canUseOccurrenceTables(): boolean {
    return typeof db.entityOccurrences?.where === 'function'
        && typeof db.entityNoteIndex?.where === 'function'
        && typeof db.notes?.get === 'function';
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
