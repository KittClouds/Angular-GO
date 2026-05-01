import {
    db,
    type Entity as DexieEntity,
    type EntityNoteIndex,
    type EntityOccurrence,
    type EntityOccurrenceSource,
    type Note,
} from '../dexie/db';
import type { DecorationSpan, EntityKind } from '../Scanner/types';
import { smartGraphRegistry, type RegisteredEntity } from '../registry';

const EXCERPT_RADIUS = 90;
const MACHINE_CONFIDENCE_FLOOR = 0.75;

export interface EntityMentionScanner {
    scanEntityMentionsAsync(text: string, scope?: EntityScanScope): Promise<DecorationSpan[]>;
}

export interface EntityScanScope {
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
}

type EntityLike = Pick<RegisteredEntity, 'id' | 'label' | 'aliases' | 'kind' | 'firstNote'>;

type TextExtraction = {
    text: string;
    explicit: Array<{
        from: number;
        to: number;
        surface: string;
        attrs: Record<string, unknown>;
    }>;
};

async function syncNoteEntityOccurrences(
    note: Note,
    scanner?: EntityMentionScanner,
): Promise<void> {
    if (!canUseEntityOccurrenceTables()) {
        return;
    }

    const now = Date.now();
    const generation = note.version || note.updatedAt || now;
    const lookup = await loadEntityLookup();
    const extracted = extractNoteTextAndExplicitMarks(note.content);
    const text = extracted.text || note.markdownContent || '';

    if (!text.trim()) {
        await deleteNoteEntityOccurrences(note.id);
        return;
    }

    const explicit = extracted.explicit
        .map(item => explicitMarkToOccurrence(note, item, lookup, generation, now, text))
        .filter((item): item is EntityOccurrence => !!item);

    const machine = await scanMachineOccurrences(note, text, lookup, generation, now, scanner);
    const occurrences = selectBestOccurrences([...explicit, ...machine], text);
    const summaries = summarizeOccurrences(occurrences);

    await db.transaction('rw', db.entityOccurrences, db.entityNoteIndex, async () => {
        await db.entityOccurrences.where('noteId').equals(note.id).delete();
        await db.entityNoteIndex.where('noteId').equals(note.id).delete();
        if (occurrences.length) {
            await db.entityOccurrences.bulkPut(occurrences);
        }
        if (summaries.length) {
            await db.entityNoteIndex.bulkPut(summaries);
        }
    });
}

export async function syncLiveNoteEntityOccurrences(
    noteId: string,
    plainText: string,
    generation = Date.now(),
    scanner?: EntityMentionScanner,
): Promise<void> {
    if (!canUseEntityOccurrenceTables()) {
        return;
    }

    const note = await db.notes.get(noteId);
    if (!note) {
        return;
    }

    const liveNote: Note = {
        ...note,
        content: '',
        markdownContent: plainText,
        version: generation,
        updatedAt: generation,
    };

    await syncNoteEntityOccurrences(liveNote, scanner);
}

export async function deleteNoteEntityOccurrences(noteId: string): Promise<void> {
    if (!canUseEntityOccurrenceTables()) {
        return;
    }
    await db.transaction('rw', db.entityOccurrences, db.entityNoteIndex, async () => {
        await db.entityOccurrences.where('noteId').equals(noteId).delete();
        await db.entityNoteIndex.where('noteId').equals(noteId).delete();
    });
}

async function scanMachineOccurrences(
    note: Note,
    text: string,
    lookup: Awaited<ReturnType<typeof loadEntityLookup>>,
    generation: number,
    now: number,
    scanner?: EntityMentionScanner,
): Promise<EntityOccurrence[]> {
    if (!scanner) {
        return [];
    }

    const spans = await scanner.scanEntityMentionsAsync(text, {
        worldId: note.worldId,
        narrativeId: note.narrativeId,
        folderId: note.folderId,
        folderPath: note.folderId,
    });

    return spans
        .map(span => spanToOccurrence(note, span, lookup, generation, now, text))
        .filter((item): item is EntityOccurrence => !!item);
}

function explicitMarkToOccurrence(
    note: Note,
    item: TextExtraction['explicit'][number],
    lookup: Awaited<ReturnType<typeof loadEntityLookup>>,
    generation: number,
    now: number,
    text: string,
): EntityOccurrence | null {
    const entity = resolveEntityFromAttrs(item.attrs, item.surface, lookup);
    if (!entity) {
        return null;
    }
    return buildOccurrence({
        note,
        entity,
        from: item.from,
        to: item.to,
        surface: item.surface,
        source: 'manual_tag',
        confidence: 1,
        generation,
        now,
        text,
    });
}

function spanToOccurrence(
    note: Note,
    span: DecorationSpan,
    lookup: Awaited<ReturnType<typeof loadEntityLookup>>,
    generation: number,
    now: number,
    text: string,
): EntityOccurrence | null {
    if (!span.entityId || span.from < 0 || span.to <= span.from || span.to > text.length) {
        return null;
    }
    const entity = lookup.byId.get(span.entityId);
    if (!entity) {
        return null;
    }
    const source = span.matchSource === 'discovery'
        ? 'machine_evidence'
        : 'dictionary_match';
    const confidence = Math.max(Number(span.confidence || 0), MACHINE_CONFIDENCE_FLOOR);

    return buildOccurrence({
        note,
        entity,
        from: span.from,
        to: span.to,
        surface: span.matchedText || text.slice(span.from, span.to),
        source,
        confidence,
        generation,
        now,
        text,
    });
}

function buildOccurrence(args: {
    note: Note;
    entity: EntityLike;
    from: number;
    to: number;
    surface: string;
    source: EntityOccurrenceSource;
    confidence: number;
    generation: number;
    now: number;
    text: string;
}): EntityOccurrence {
    const { note, entity, from, to, source, confidence, generation, now, text } = args;
    const id = `${note.id}:${entity.id}:${from}:${to}:${source}`;
    return {
        id,
        noteId: note.id,
        entityId: entity.id,
        entityLabel: entity.label,
        entityKind: entity.kind,
        targetNoteId: entity.firstNote || undefined,
        sourceStart: from,
        sourceEnd: to,
        surface: args.surface,
        source,
        confidence,
        excerpt: buildExcerpt(text, from, to),
        worldId: note.worldId,
        narrativeId: note.narrativeId,
        folderId: note.folderId,
        generation,
        createdAt: now,
        updatedAt: now,
    };
}

function summarizeOccurrences(occurrences: EntityOccurrence[]): EntityNoteIndex[] {
    const byEntity = new Map<string, EntityNoteIndex>();
    for (const occurrence of occurrences) {
        const id = `${occurrence.noteId}:${occurrence.entityId}`;
        const current = byEntity.get(id);
        if (!current) {
            byEntity.set(id, {
                id,
                noteId: occurrence.noteId,
                entityId: occurrence.entityId,
                entityLabel: occurrence.entityLabel,
                entityKind: occurrence.entityKind,
                targetNoteId: occurrence.targetNoteId,
                occurrenceCount: 1,
                bestSource: occurrence.source,
                maxConfidence: occurrence.confidence,
                firstStart: occurrence.sourceStart,
                lastEnd: occurrence.sourceEnd,
                worldId: occurrence.worldId,
                narrativeId: occurrence.narrativeId,
                folderId: occurrence.folderId,
                generation: occurrence.generation,
                updatedAt: occurrence.updatedAt,
            });
            continue;
        }

        current.occurrenceCount += 1;
        current.maxConfidence = Math.max(current.maxConfidence, occurrence.confidence);
        current.firstStart = Math.min(current.firstStart, occurrence.sourceStart);
        current.lastEnd = Math.max(current.lastEnd, occurrence.sourceEnd);
        current.updatedAt = Math.max(current.updatedAt, occurrence.updatedAt);
        if (sourceRank(occurrence.source) > sourceRank(current.bestSource)) {
            current.bestSource = occurrence.source;
        }
    }
    return Array.from(byEntity.values());
}

function selectBestOccurrences(candidates: EntityOccurrence[], text: string): EntityOccurrence[] {
    const selected: EntityOccurrence[] = [];
    const sorted = [...candidates].sort((left, right) =>
        sourceRank(right.source) - sourceRank(left.source)
        || right.confidence - left.confidence
        || spanLength(right) - spanLength(left)
        || left.sourceStart - right.sourceStart
    );

    for (const candidate of sorted) {
        if (selected.some(item => rangesOverlap(item, candidate))) {
            continue;
        }
        selected.push(candidate);
    }

    return mergeAdjacent(selected.sort((left, right) => left.sourceStart - right.sourceStart), text);
}

function mergeAdjacent(occurrences: EntityOccurrence[], text: string): EntityOccurrence[] {
    const merged: EntityOccurrence[] = [];
    for (const occurrence of occurrences) {
        const current = merged[merged.length - 1];
        if (
            current
            && current.noteId === occurrence.noteId
            && current.entityId === occurrence.entityId
            && current.source === occurrence.source
            && current.sourceEnd === occurrence.sourceStart
        ) {
            current.id = `${current.noteId}:${current.entityId}:${current.sourceStart}:${occurrence.sourceEnd}:${current.source}`;
            current.sourceEnd = occurrence.sourceEnd;
            current.surface = text.slice(current.sourceStart, current.sourceEnd);
            current.excerpt = buildExcerpt(text, current.sourceStart, current.sourceEnd);
            current.confidence = Math.max(current.confidence, occurrence.confidence);
            continue;
        }
        merged.push({ ...occurrence });
    }
    return merged;
}

function extractNoteTextAndExplicitMarks(content: unknown): TextExtraction {
    const root = parseContent(content);
    if (!root) {
        return { text: '', explicit: [] };
    }
    const explicit: TextExtraction['explicit'] = [];
    const parts: string[] = [];
    let offset = 0;

    const append = (value: string) => {
        parts.push(value);
        offset += value.length;
    };

    const visit = (node: any) => {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (node.type === 'text') {
            const text = typeof node.text === 'string' ? node.text : '';
            const from = offset;
            append(text);
            for (const mark of Array.isArray(node.marks) ? node.marks : []) {
                if (mark?.type === 'entity' && text.trim()) {
                    explicit.push({
                        from,
                        to: from + text.length,
                        surface: text,
                        attrs: asRecord(mark.attrs),
                    });
                }
            }
            return;
        }
        if (node.type === 'hardBreak') {
            append('\n');
            return;
        }
        const children = Array.isArray(node.content) ? node.content : [];
        children.forEach((child: any, index: number) => {
            if (index > 0 && isBlockNode(child)) {
                append('\n');
            }
            visit(child);
        });
    };

    visit(root);
    return { text: parts.join(''), explicit };
}

function parseContent(content: unknown): any | null {
    if (!content) {
        return null;
    }
    if (typeof content === 'string') {
        try {
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
    return content;
}

function isBlockNode(node: any): boolean {
    return !!node && typeof node === 'object' && node.type !== 'text';
}

async function loadEntityLookup(): Promise<{
    byId: Map<string, EntityLike>;
    byLabel: Map<string, EntityLike>;
}> {
    const byId = new Map<string, EntityLike>();
    const byLabel = new Map<string, EntityLike>();
    const add = (entity: EntityLike | null | undefined) => {
        if (!entity?.id || !entity.label) {
            return;
        }
        byId.set(entity.id, entity);
        byLabel.set(normalizeLabel(entity.label), entity);
        for (const alias of entity.aliases || []) {
            byLabel.set(normalizeLabel(alias), entity);
        }
    };

    (await db.entities.toArray()).map(toEntityLike).forEach(add);
    smartGraphRegistry.getAll().forEach(add);
    return { byId, byLabel };
}

function resolveEntityFromAttrs(
    attrs: Record<string, unknown>,
    surface: string,
    lookup: Awaited<ReturnType<typeof loadEntityLookup>>,
): EntityLike | null {
    const id = typeof attrs['id'] === 'string' ? attrs['id'].trim() : '';
    if (id && lookup.byId.has(id)) {
        return lookup.byId.get(id) || null;
    }
    const label = typeof attrs['label'] === 'string' ? attrs['label'].trim() : '';
    return lookup.byLabel.get(normalizeLabel(label || surface)) || null;
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

function buildExcerpt(text: string, from: number, to: number): string {
    const start = Math.max(0, from - EXCERPT_RADIUS);
    const end = Math.min(text.length, to + EXCERPT_RADIUS);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function sourceRank(source: EntityOccurrenceSource): number {
    if (source === 'manual_tag') return 4;
    if (source === 'dictionary_match') return 3;
    if (source === 'machine_evidence') return 2;
    return 1;
}

function spanLength(occurrence: EntityOccurrence): number {
    return occurrence.sourceEnd - occurrence.sourceStart;
}

function rangesOverlap(left: EntityOccurrence, right: EntityOccurrence): boolean {
    return left.sourceStart < right.sourceEnd && right.sourceStart < left.sourceEnd;
}

function normalizeLabel(value: string): string {
    return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function canUseEntityOccurrenceTables(): boolean {
    return typeof db.entityOccurrences?.where === 'function'
        && typeof db.entityNoteIndex?.where === 'function'
        && typeof db.entities?.toArray === 'function';
}

export const entityOccurrenceIndexTestHooks = {
    extractNoteTextAndExplicitMarks,
    selectBestOccurrences,
};
