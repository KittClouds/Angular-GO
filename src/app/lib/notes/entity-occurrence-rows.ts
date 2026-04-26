import {
    db,
    type Entity as DexieEntity,
    type EntityNoteIndex,
    type EntityOccurrence,
    type EntityOccurrenceSource,
} from '../dexie/db';
import type { EntityKind } from '../Scanner/types';
import { smartGraphRegistry, type RegisteredEntity } from '../registry';

export interface EntitySignalBreakdown {
    tagged: number;
    matched: number;
    evidence: number;
    suggested: number;
    total: number;
}

export interface EntitySignalRow {
    id: string;
    title: string;
    badgeLabel: string;
    excerpt: string;
    locationLabel: string;
    sourceNoteId: string;
    targetEntityId: string;
    targetNoteId?: string;
    openNoteId?: string;
    method: EntityOccurrenceSource;
    confidence: number;
    updatedAt: number;
    direction: 'note_entity' | 'entity_inbound';
}

type EntityLike = Pick<RegisteredEntity, 'id' | 'label' | 'aliases' | 'kind' | 'firstNote'>;

export async function getEntitySignalRows(noteId: string): Promise<{
    rows: EntitySignalRow[];
    breakdown: EntitySignalBreakdown;
}> {
    if (!canUseEntityOccurrenceTables()) {
        return { rows: [], breakdown: emptyBreakdown() };
    }

    const entityForNote = await findEntityForNote(noteId);
    const rows = entityForNote
        ? await buildInboundRows(noteId, entityForNote)
        : await buildCurrentNoteRows(noteId);

    return {
        rows,
        breakdown: buildBreakdown(rows),
    };
}

async function buildCurrentNoteRows(noteId: string): Promise<EntitySignalRow[]> {
    const summaries = await db.entityNoteIndex.where('noteId').equals(noteId).toArray();
    const occurrences = await db.entityOccurrences.where('noteId').equals(noteId).toArray();
    const firstByEntity = firstOccurrenceByEntity(occurrences);

    return summaries
        .map(summary => {
            const first = firstByEntity.get(summary.entityId);
            return summaryToRow(summary, first, {
                title: summary.entityLabel,
                badgeLabel: sourceLabel(summary.bestSource),
                direction: 'note_entity',
                openNoteId: summary.targetNoteId,
            });
        })
        .sort(rowSort);
}

async function buildInboundRows(noteId: string, entity: EntityLike): Promise<EntitySignalRow[]> {
    const summaries = (await db.entityNoteIndex.where('entityId').equals(entity.id).toArray())
        .filter(summary => summary.noteId !== noteId);
    const notes = await db.notes.bulkGet([...new Set(summaries.map(summary => summary.noteId))]);
    const titles = new Map(notes.filter(Boolean).map(note => [note!.id, note!.title || 'Untitled']));
    const occurrences = await db.entityOccurrences.where('entityId').equals(entity.id).toArray();
    const firstByNote = firstOccurrenceByNote(occurrences);

    return summaries
        .map(summary => {
            const first = firstByNote.get(summary.noteId);
            return summaryToRow(summary, first, {
                title: titles.get(summary.noteId) || 'Untitled',
                badgeLabel: sourceLabel(summary.bestSource),
                direction: 'entity_inbound',
                openNoteId: summary.noteId,
            });
        })
        .sort(rowSort);
}

function summaryToRow(
    summary: EntityNoteIndex,
    first: EntityOccurrence | undefined,
    options: Pick<EntitySignalRow, 'title' | 'badgeLabel' | 'direction'> & { openNoteId?: string },
): EntitySignalRow {
    return {
        id: summary.id,
        title: options.title,
        badgeLabel: options.badgeLabel,
        excerpt: first?.excerpt || summary.entityLabel,
        locationLabel: buildLocationLabel(summary, first),
        sourceNoteId: summary.noteId,
        targetEntityId: summary.entityId,
        targetNoteId: summary.targetNoteId,
        openNoteId: options.openNoteId,
        method: summary.bestSource,
        confidence: summary.maxConfidence,
        updatedAt: summary.updatedAt,
        direction: options.direction,
    };
}

async function findEntityForNote(noteId: string): Promise<EntityLike | null> {
    const registryEntity = smartGraphRegistry.getAll().find(entity => entity.firstNote === noteId);
    if (registryEntity) {
        return registryEntity;
    }
    const entities = await db.entities.toArray();
    return toEntityLike(entities.find(entity => entity.firstNote === noteId)) || null;
}

function toEntityLike(entity?: DexieEntity | null): EntityLike | null {
    if (!entity?.id || !entity.label) {
        return null;
    }
    return {
        id: entity.id,
        label: entity.label,
        aliases: entity.aliases || [],
        kind: entity.kind as EntityKind,
        firstNote: entity.firstNote || '',
    };
}

function firstOccurrenceByEntity(occurrences: EntityOccurrence[]): Map<string, EntityOccurrence> {
    const byEntity = new Map<string, EntityOccurrence>();
    for (const occurrence of [...occurrences].sort((left, right) => left.sourceStart - right.sourceStart)) {
        if (!byEntity.has(occurrence.entityId)) {
            byEntity.set(occurrence.entityId, occurrence);
        }
    }
    return byEntity;
}

function firstOccurrenceByNote(occurrences: EntityOccurrence[]): Map<string, EntityOccurrence> {
    const byNote = new Map<string, EntityOccurrence>();
    for (const occurrence of [...occurrences].sort((left, right) => left.sourceStart - right.sourceStart)) {
        if (!byNote.has(occurrence.noteId)) {
            byNote.set(occurrence.noteId, occurrence);
        }
    }
    return byNote;
}

function buildBreakdown(rows: EntitySignalRow[]): EntitySignalBreakdown {
    const breakdown = emptyBreakdown();
    for (const row of rows) {
        if (row.method === 'manual_tag') breakdown.tagged += 1;
        else if (row.method === 'dictionary_match') breakdown.matched += 1;
        else if (row.method === 'machine_evidence') breakdown.evidence += 1;
        else breakdown.suggested += 1;
    }
    breakdown.total = rows.length;
    return breakdown;
}

function emptyBreakdown(): EntitySignalBreakdown {
    return { tagged: 0, matched: 0, evidence: 0, suggested: 0, total: 0 };
}

function buildLocationLabel(summary: EntityNoteIndex, occurrence?: EntityOccurrence): string {
    const count = summary.occurrenceCount === 1 ? '1 signal' : `${summary.occurrenceCount} signals`;
    const offset = occurrence?.sourceStart ?? summary.firstStart;
    return `offset ${Math.max(0, offset)} | ${count}`;
}

function sourceLabel(source: EntityOccurrenceSource): string {
    if (source === 'manual_tag') return 'tagged';
    if (source === 'dictionary_match') return 'match';
    if (source === 'machine_evidence') return 'evidence';
    return 'suggested';
}

function rowSort(left: EntitySignalRow, right: EntitySignalRow): number {
    return sourceRank(right.method) - sourceRank(left.method)
        || right.confidence - left.confidence
        || right.updatedAt - left.updatedAt
        || left.title.localeCompare(right.title);
}

function sourceRank(source: EntityOccurrenceSource): number {
    if (source === 'manual_tag') return 4;
    if (source === 'dictionary_match') return 3;
    if (source === 'machine_evidence') return 2;
    return 1;
}

function canUseEntityOccurrenceTables(): boolean {
    return typeof db.entityOccurrences?.where === 'function'
        && typeof db.entityNoteIndex?.where === 'function'
        && typeof db.notes?.toArray === 'function'
        && typeof db.entities?.toArray === 'function';
}

export const entityOccurrenceRowsTestHooks = {
    buildBreakdown,
};
