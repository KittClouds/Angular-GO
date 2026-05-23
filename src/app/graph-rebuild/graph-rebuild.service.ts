import { Injectable, computed, inject, signal } from '@angular/core';

import {
    db,
    type EntityOccurrence,
    type Note,
    type NoteBlockProjection,
} from '../lib/dexie/db';
import { parseContentToPlainText } from '../lib/analytics';
import type { RegisteredEntity } from '../lib/registry';
import { PhoenixStoreService, type StoreScopedDocument } from '../services/phoenix-store.service';
import { buildGraphRebuildSnapshot } from './graph-rebuild-builder';
import type {
    GraphIndexRunReceipt,
    GraphRebuildChunk,
    GraphRebuildRelationshipHint,
    GraphRebuildScopeKind,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';

export const GRAPH_REBUILD_NAMESPACE = 'phoenix_graph_rebuild_v1';
const SNAPSHOT_DOCUMENT_KEY = 'snapshot';
const RECEIPT_DOCUMENT_KEY = 'receipt';

export interface GraphRebuildBuildRequest {
    scopeKind: GraphRebuildScopeKind;
    scopeId: string;
    noteIds: string[];
    entities: RegisteredEntity[];
    relationshipHints?: GraphRebuildRelationshipHint[];
    candidateCount?: number;
}

@Injectable({ providedIn: 'root' })
export class GraphRebuildService {
    private readonly store = inject(PhoenixStoreService);
    private readonly snapshotState = signal<GraphRebuildSnapshot | null>(null);
    private readonly buildingState = signal(false);
    private readonly errorState = signal<string | null>(null);

    readonly snapshot = computed(() => this.snapshotState());
    readonly isBuilding = computed(() => this.buildingState());
    readonly error = computed(() => this.errorState());

    async buildAndPersistSnapshot(request: GraphRebuildBuildRequest): Promise<GraphRebuildSnapshot> {
        this.buildingState.set(true);
        try {
            const occurrences = await this.loadOccurrences(request.noteIds, request.entities);
            const chunks = await this.loadChunks(request.noteIds, occurrences);
            const noteTexts = await this.loadNoteTexts(request.noteIds, occurrences);
            const snapshot = buildGraphRebuildSnapshot({
                scopeKind: request.scopeKind,
                scopeId: request.scopeId,
                noteIds: request.noteIds,
                entities: request.entities,
                occurrences,
                chunks,
                noteTexts,
                relationshipHints: request.relationshipHints,
                candidateCount: request.candidateCount,
            });
            this.snapshotState.set(snapshot);
            await this.persistSnapshot(snapshot).then(() => {
                this.errorState.set(null);
            }).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.errorState.set(`Overgraph graph-rebuild snapshot persist failed: ${message}`);
                console.warn('[GraphRebuild] Snapshot persist failed', error);
            });
            return snapshot;
        } finally {
            this.buildingState.set(false);
        }
    }

    async loadPersistedSnapshot(scopeId: string): Promise<GraphRebuildSnapshot | null> {
        const document = await this.store.getScopedDocument(scopeId, GRAPH_REBUILD_NAMESPACE, SNAPSHOT_DOCUMENT_KEY);
        return document ? scopedDocumentToGraphRebuildSnapshot(document) : null;
    }

    async persistRunReceipt(receipt: GraphIndexRunReceipt): Promise<void> {
        await this.store.upsertScopedDocument(graphIndexReceiptToScopedDocument(receipt));
        dispatchGraphRebuildEvent('graph-index-run-completed', {
            scopeId: receipt.scope.scopeId,
            receiptId: receipt.id,
            snapshotId: receipt.snapshotId,
        });
    }

    async loadPersistedRunReceipt(scopeId: string): Promise<GraphIndexRunReceipt | null> {
        const document = await this.store.getScopedDocument(scopeId, GRAPH_REBUILD_NAMESPACE, RECEIPT_DOCUMENT_KEY);
        return document ? scopedDocumentToGraphIndexReceipt(document) : null;
    }

    private async persistSnapshot(snapshot: GraphRebuildSnapshot): Promise<void> {
        await this.store.upsertScopedDocument(graphRebuildSnapshotToScopedDocument(snapshot));
        dispatchGraphRebuildEvent('graph-rebuild-snapshot-updated', {
            scopeId: snapshot.scopeId,
            snapshotId: snapshot.id,
        });
    }

    private async loadOccurrences(noteIds: string[], entities: RegisteredEntity[]): Promise<EntityOccurrence[]> {
        if (!canUseOccurrenceTable()) return [];
        const entityIds = new Set(entities.map((entity) => entity.id));
        const rows = noteIds.length
            ? (await Promise.all(noteIds.map((noteId) => db.entityOccurrences.where('noteId').equals(noteId).toArray()))).flat()
            : await db.entityOccurrences.toArray();
        return rows.filter((row) => entityIds.has(row.entityId));
    }

    private async loadNoteTexts(noteIds: string[], occurrences: EntityOccurrence[]): Promise<Record<string, string>> {
        if (!canUseNotesTable()) return {};
        const scopedNoteIds = noteIds.length ? noteIds : [...new Set(occurrences.map((row) => row.noteId))];
        const notes = (await Promise.all(scopedNoteIds.map((noteId) => db.notes.get(noteId)))).filter((note): note is Note => !!note);
        return Object.fromEntries(notes.map((note) => [note.id, notePlainText(note)]));
    }

    private async loadChunks(noteIds: string[], occurrences: EntityOccurrence[]): Promise<GraphRebuildChunk[]> {
        const scopedNoteIds = noteIds.length ? noteIds : [...new Set(occurrences.map((row) => row.noteId))];
        const dynamicChunks = await loadDynamicNoteChunks(scopedNoteIds);
        if (dynamicChunks.length) return dynamicChunks;
        const blockChunks = await loadBlockChunks(scopedNoteIds);
        if (blockChunks.length) return blockChunks;
        return loadFallbackNoteChunks(scopedNoteIds);
    }
}

export function graphRebuildSnapshotToScopedDocument(snapshot: GraphRebuildSnapshot): StoreScopedDocument {
    const now = Date.now();
    return {
        id: `${GRAPH_REBUILD_NAMESPACE}:${snapshot.scopeId}:${SNAPSHOT_DOCUMENT_KEY}`,
        scopeFolderId: snapshot.scopeId,
        narrativeId: snapshot.scopeKind === 'narrative' ? snapshot.scopeId : '',
        namespace: GRAPH_REBUILD_NAMESPACE,
        documentKey: SNAPSHOT_DOCUMENT_KEY,
        payload: JSON.stringify(snapshot),
        createdAt: snapshot.builtAt || now,
        updatedAt: now,
    };
}

export function scopedDocumentToGraphRebuildSnapshot(document: StoreScopedDocument): GraphRebuildSnapshot | null {
    try {
        const parsed = JSON.parse(document.payload) as GraphRebuildSnapshot;
        return parsed?.schemaVersion === 'phoenix-graph-rebuild/v1' ? parsed : null;
    } catch {
        return null;
    }
}

export function graphIndexReceiptToScopedDocument(receipt: GraphIndexRunReceipt): StoreScopedDocument {
    const now = Date.now();
    return {
        id: `${GRAPH_REBUILD_NAMESPACE}:${receipt.scope.scopeId}:${RECEIPT_DOCUMENT_KEY}`,
        scopeFolderId: receipt.scope.scopeId,
        narrativeId: receipt.scope.kind === 'narrative' ? receipt.scope.scopeId : '',
        namespace: GRAPH_REBUILD_NAMESPACE,
        documentKey: RECEIPT_DOCUMENT_KEY,
        payload: JSON.stringify(receipt),
        createdAt: receipt.startedAt || now,
        updatedAt: now,
    };
}

export function scopedDocumentToGraphIndexReceipt(document: StoreScopedDocument): GraphIndexRunReceipt | null {
    try {
        const parsed = JSON.parse(document.payload) as GraphIndexRunReceipt;
        return parsed?.schemaVersion === 'phoenix-graph-index-run/v1' ? parsed : null;
    } catch {
        return null;
    }
}

const DYNAMIC_CHUNK_SIZE_TOKENS = 500;
const DYNAMIC_CHUNK_OVERLAP_TOKENS = 100;
const ESTIMATED_CHARS_PER_TOKEN = 4;

async function loadDynamicNoteChunks(noteIds: string[]): Promise<GraphRebuildChunk[]> {
    if (!canUseNotesTable() || !noteIds.length) return [];
    const notes = (await Promise.all(noteIds.map((noteId) => db.notes.get(noteId)))).filter((note): note is Note => !!note);
    return notes.flatMap((note) => dynamicChunksForNote(note));
}

export function dynamicChunksForNote(note: Pick<Note, 'id' | 'markdownContent' | 'content'>): GraphRebuildChunk[] {
    const text = notePlainText(note);
    const spans = sentenceSpans(text);
    if (!text.trim()) return [];
    if (!spans.length) return [dynamicChunk(note.id, 0, 0, text.length, text)];

    const chunks: GraphRebuildChunk[] = [];
    let window: Array<{ start: number; end: number }> = [];
    let tokenCount = 0;
    const emit = () => {
        if (!window.length) return;
        const first = window[0];
        const last = window[window.length - 1];
        chunks.push(dynamicChunk(note.id, chunks.length, first.start, last.end, text.slice(first.start, last.end)));
    };
    for (const span of spans) {
        const spanTokens = estimatedTokens(span.start, span.end);
        if (window.length && tokenCount + spanTokens > DYNAMIC_CHUNK_SIZE_TOKENS) {
            emit();
            const overlap: Array<{ start: number; end: number }> = [];
            let overlapTokens = 0;
            for (let index = window.length - 1; index >= 0; index -= 1) {
                const candidate = window[index];
                const candidateTokens = estimatedTokens(candidate.start, candidate.end);
                if (overlapTokens + candidateTokens > DYNAMIC_CHUNK_OVERLAP_TOKENS) break;
                overlap.unshift(candidate);
                overlapTokens += candidateTokens;
            }
            window = overlap;
            tokenCount = overlapTokens;
        }
        window.push(span);
        tokenCount += spanTokens;
    }
    emit();
    return chunks;
}

async function loadBlockChunks(noteIds: string[]): Promise<GraphRebuildChunk[]> {
    if (!canUseBlockTable() || !noteIds.length) return [];
    const rows = (await Promise.all(noteIds.map((noteId) => db.noteBlocks.where('noteId').equals(noteId).toArray()))).flat();
    return rows
        .sort((left, right) => left.noteId.localeCompare(right.noteId) || left.ordinal - right.ordinal)
        .map(blockToChunk);
}

async function loadFallbackNoteChunks(noteIds: string[]): Promise<GraphRebuildChunk[]> {
    if (!canUseNotesTable() || !noteIds.length) return [];
    const notes = (await Promise.all(noteIds.map((noteId) => db.notes.get(noteId)))).filter((note): note is Note => !!note);
    return notes.map((note, ordinal) => ({
        id: `${note.id}:note-fallback:0`,
        noteId: note.id,
        start: 0,
        end: (note.markdownContent || '').length,
        ordinal,
        source: 'note-fallback',
        textHash: simpleHash(note.markdownContent || ''),
    }));
}

function notePlainText(note: Pick<Note, 'markdownContent' | 'content'>): string {
    const markdown = String(note.markdownContent || '');
    if (markdown.trim()) return markdown;
    return parseContentToPlainText(String(note.content || ''));
}

function sentenceSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
        if (!isSentenceBoundary(text, index)) continue;
        pushTrimmedSpan(spans, text, start, index + 1);
        start = index + 1;
    }
    pushTrimmedSpan(spans, text, start, text.length);
    return spans;
}

function isSentenceBoundary(text: string, index: number): boolean {
    const char = text[index];
    if (char === '\n') return text[index + 1] === '\n';
    if (char !== '.' && char !== '!' && char !== '?') return false;
    const next = text[index + 1] || '';
    return !next || /\s|["')\]]/.test(next);
}

function pushTrimmedSpan(spans: Array<{ start: number; end: number }>, text: string, start: number, end: number): void {
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (end > start) spans.push({ start, end });
}

function estimatedTokens(start: number, end: number): number {
    return Math.max(1, Math.ceil(Math.max(0, end - start) / ESTIMATED_CHARS_PER_TOKEN));
}

function dynamicChunk(noteId: string, ordinal: number, start: number, end: number, text: string): GraphRebuildChunk {
    return {
        id: `${noteId}:chunk:${ordinal}`,
        noteId,
        start,
        end,
        ordinal,
        source: 'dynamic-chunking',
        textHash: simpleHash(text),
    };
}

function blockToChunk(block: NoteBlockProjection): GraphRebuildChunk {
    return {
        id: block.id || `${block.noteId}:block:${block.ordinal}`,
        noteId: block.noteId,
        start: block.startOffset,
        end: block.endOffset,
        ordinal: block.ordinal,
        source: 'note-block',
        textHash: block.textHash,
    };
}

function canUseOccurrenceTable(): boolean {
    return typeof db.entityOccurrences?.where === 'function'
        && typeof db.entityOccurrences?.toArray === 'function';
}

function canUseBlockTable(): boolean {
    return typeof db.noteBlocks?.where === 'function';
}

function canUseNotesTable(): boolean {
    return typeof db.notes?.get === 'function';
}

function dispatchGraphRebuildEvent(name: string, detail: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function simpleHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
