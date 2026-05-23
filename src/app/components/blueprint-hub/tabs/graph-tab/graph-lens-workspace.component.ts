import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnDestroy, Output, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { RegisteredEntity } from '../../../../lib/registry';
import { db } from '../../../../lib/dexie/db';
import { PhoenixProjectionService } from '../../../../services/phoenix-projection.service';
import { GraphRebuildService } from '../../../../graph-rebuild/graph-rebuild.service';
import type { GraphRebuildSnapshot } from '../../../../graph-rebuild/graph-rebuild-snapshot';
import { entityColorStore } from '../../../../lib/store/entityColorStore';
import { GraphAtlasPreviewComponent, EMPTY_GRAPH_INVENTORY, type AtlasMode, type AtlasPreviewEdge, type GraphInventory } from './graph-atlas-preview/graph-atlas-preview.component';
import type { EntitySuggestionProviderId } from '../../../../lib/entity-suggestions/entity-suggestion.types';
import {
    DEFAULT_GRAPH_LENS,
    buildGraphLensView,
    buildUniqueAtlasEdges,
    type GraphLensMembership,
    type GraphLensMode,
    type GraphLensNote,
    type GraphLensState,
} from './graph-lens';

@Component({
    selector: 'app-graph-lens-workspace',
    standalone: true,
    imports: [CommonModule, FormsModule, GraphAtlasPreviewComponent],
    template: `
        <div class="flex h-full min-h-[560px] flex-col gap-0">
            @if (usesNotes()) {
            <section class="shrink-0 rounded-2xl border border-white/5 bg-zinc-950/72 px-3 py-3 backdrop-blur">
                <div class="flex flex-wrap items-center gap-2">
                    <label class="flex h-9 min-w-[220px] max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3">
                        <span class="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Find</span>
                        <input type="text" class="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                            placeholder="note title" [ngModel]="noteQuery()" (ngModelChange)="noteQuery.set($event)" />
                    </label>
                    @for (note of filteredNotes().slice(0, 12); track note.id) {
                    <button type="button"
                        class="group inline-flex max-w-[220px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs transition"
                        [class.border-cyan-400/25]="isSelected(note.id)"
                        [class.bg-cyan-500/10]="isSelected(note.id)"
                        [class.text-cyan-50]="isSelected(note.id)"
                        [class.border-white/10]="!isSelected(note.id)"
                        [class.bg-white/[0.03]]="!isSelected(note.id)"
                        [class.text-zinc-300]="!isSelected(note.id)"
                        (click)="toggleNote(note.id)">
                        <span class="h-1.5 w-1.5 shrink-0 rounded-full"
                            [class.bg-cyan-300]="isPrimary(note.id)"
                            [class.bg-zinc-600]="!isPrimary(note.id)"></span>
                        <span class="truncate">{{ note.title || 'Untitled' }}</span>
                        @if (isSelected(note.id) && lens().mode === 'multiNote') {
                        <span class="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-zinc-400"
                            (click)="setPrimaryNote(note.id); $event.stopPropagation()">primary</span>
                        }
                    </button>
                    }
                    @if (filteredNotes().length === 0) {
                    <span class="rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500">No notes found</span>
                    }
                </div>
            </section>
            }

            @if (graphSnapshotStale()) {
            <section class="shrink-0 rounded-xl border border-amber-400/15 bg-amber-500/5 px-3 py-2 text-xs font-semibold text-amber-100">
                Latest anchors changed. The atlas view is stale until Build Full Atlas runs again.
            </section>
            }

            <app-graph-atlas-preview class="block min-h-0 flex-1"
                [entities]="lensedGraph().entities"
                [edges]="lensedGraph().edges"
                [committedGraphInventory]="graphRebuildInventory()"
                [graphCounters]="graphRebuildCounters()"
                [graphSnapshot]="graphRebuildSnapshot()"
                [sourceLabel]="lensedGraph().sourceLabel"
                [lensMode]="lens().mode"
                [primaryNoteId]="lens().primaryNoteId"
                [selectedNoteIds]="lens().selectedNoteIds"
                [atlasSearch]="atlasSearch"
                [isScanning]="isScanning"
                [activeProvider]="activeProvider"
                (entitySelected)="entitySelected.emit($event)"
                (addEntityRequested)="addEntityRequested.emit()"
                (scanRequested)="scanRequested.emit(lens())"
                (styleRequested)="styleRequested.emit()"
                (atlasModeChange)="atlasModeChange.emit($event)"
                (atlasSearchChange)="atlasSearchChange.emit($event)"
                (lensModeChange)="setLensMode($event)">
            </app-graph-atlas-preview>
        </div>
    `,
})
export class GraphLensWorkspaceComponent implements OnDestroy {
    private readonly projection = inject(PhoenixProjectionService);
    private readonly graphRebuild = inject(GraphRebuildService);
    private readonly narrativeEntitiesSignal = signal<RegisteredEntity[]>([]);
    private readonly narrativeEdgesSignal = signal<AtlasPreviewEdge[]>([]);
    private readonly graphRebuildSnapshotSignal = signal<GraphRebuildSnapshot | null>(null);
    private readonly graphSnapshotStaleSignal = signal(false);
    private readonly memberships = signal<GraphLensMembership[]>([]);
    private membershipToken = 0;
    private noteToken = 0;
    private graphSnapshotLoadToken = 0;
    private removeAnchorListeners: (() => void) | null = null;

    @Input() set narrativeEntities(value: RegisteredEntity[] | null | undefined) {
        this.narrativeEntitiesSignal.set(value ?? []);
    }

    @Input() set narrativeEdges(value: AtlasPreviewEdge[] | null | undefined) {
        this.narrativeEdgesSignal.set(value ?? []);
    }

    @Input() set lensMode(value: GraphLensMode | null | undefined) {
        if (value && value !== this.lens().mode) {
            this.setLensMode(value, false);
        }
    }

    @Input() atlasSearch = '';
    @Input() isScanning = false;
    @Input() activeProvider: EntitySuggestionProviderId | null = null;
    @Input() set candidateCount(value: number | null | undefined) {
        void value;
    }

    @Output() entitySelected = new EventEmitter<RegisteredEntity>();
    @Output() addEntityRequested = new EventEmitter<void>();
    @Output() scanRequested = new EventEmitter<GraphLensState>();
    @Output() styleRequested = new EventEmitter<void>();
    @Output() atlasModeChange = new EventEmitter<AtlasMode>();
    @Output() lensModeChange = new EventEmitter<GraphLensMode>();
    @Output() atlasSearchChange = new EventEmitter<string>();

    readonly lensModes: { id: GraphLensMode; label: string }[] = [
        { id: 'global', label: 'Global' },
        { id: 'narrative', label: 'Narrative' },
        { id: 'note', label: 'Active Note' },
        { id: 'multiNote', label: 'Compare Notes' },
    ];
    readonly lens = signal<GraphLensState>({ ...DEFAULT_GRAPH_LENS });
    readonly notes = signal<GraphLensNote[]>([]);
    readonly noteQuery = signal('');
    readonly globalEntities = computed(() => this.projection.entities());
    readonly globalEdges = computed(() => buildUniqueAtlasEdges(this.globalEntities(), (entityId) =>
        this.projection.getEdgesForEntity(entityId).map((edge) => ({
            id: edge.id,
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            type: edge.type,
            confidence: edge.confidence,
        })),
    ));
    readonly lensedGraph = computed(() => buildGraphLensView({
        lens: this.lens(),
        notes: this.notes(),
        globalEntities: this.globalEntities(),
        narrativeEntities: this.narrativeEntitiesSignal(),
        globalEdges: this.globalEdges(),
        narrativeEdges: this.narrativeEdgesSignal(),
        memberships: this.memberships(),
    }));
    readonly graphRebuildInventory = computed(() => graphInventoryFromSnapshot(this.graphRebuildSnapshotSignal()));
    readonly graphRebuildCounters = computed(() => this.graphRebuildSnapshotSignal()?.counters ?? null);
    readonly graphRebuildSnapshot = computed(() => this.graphRebuildSnapshotSignal());
    readonly graphSnapshotStale = computed(() => this.graphSnapshotStaleSignal());
    readonly filteredNotes = computed(() => {
        const query = this.noteQuery().trim().toLowerCase();
        if (!query) return this.notes();
        return this.notes().filter((note) => note.title.toLowerCase().includes(query));
    });

    constructor() {
        void this.refreshNotes();
        this.bindAnchorEvents();
        effect(() => void this.refreshMemberships(this.lens()));
        effect(() => void this.loadPersistedGraphSnapshot(this.lens()));
    }

    ngOnDestroy(): void {
        this.removeAnchorListeners?.();
    }

    usesNotes(): boolean {
        const mode = this.lens().mode;
        return mode === 'note' || mode === 'multiNote';
    }

    isSelected(noteId: string): boolean {
        const lens = this.lens();
        return lens.mode === 'note' ? lens.primaryNoteId === noteId : lens.selectedNoteIds.includes(noteId);
    }

    isPrimary(noteId: string): boolean {
        return this.lens().primaryNoteId === noteId;
    }

    setLensMode(mode: GraphLensMode, emitChange = true): void {
        if (mode === this.lens().mode) return;
        this.lens.update((current) => {
            const primary = current.primaryNoteId ?? current.selectedNoteIds[0] ?? this.notes()[0]?.id ?? null;
            if (mode === 'note') return { mode, primaryNoteId: primary, selectedNoteIds: primary ? [primary] : [] };
            if (mode === 'multiNote') {
                const selected = current.selectedNoteIds.length ? current.selectedNoteIds : (primary ? [primary] : []);
                return { mode, primaryNoteId: primary, selectedNoteIds: selected };
            }
            return { mode, primaryNoteId: null, selectedNoteIds: [] };
        });
        if (emitChange) this.lensModeChange.emit(mode);
    }

    toggleNote(noteId: string): void {
        const mode = this.lens().mode;
        if (mode === 'note') {
            this.lens.set({ mode, primaryNoteId: noteId, selectedNoteIds: [noteId] });
            return;
        }
        if (mode !== 'multiNote') return;
        this.lens.update((current) => {
            const selected = current.selectedNoteIds.includes(noteId)
                ? current.selectedNoteIds.filter((id) => id !== noteId)
                : [...current.selectedNoteIds, noteId];
            const primary = selected.includes(current.primaryNoteId ?? '') ? current.primaryNoteId : selected[0] ?? null;
            return { mode, primaryNoteId: primary, selectedNoteIds: selected };
        });
    }

    setPrimaryNote(noteId: string): void {
        this.lens.update((current) => ({
            ...current,
            primaryNoteId: noteId,
            selectedNoteIds: current.selectedNoteIds.includes(noteId)
                ? current.selectedNoteIds
                : [noteId, ...current.selectedNoteIds],
        }));
    }

    private async refreshNotes(): Promise<void> {
        const token = ++this.noteToken;
        const rows = await db.notes.toArray();
        if (token !== this.noteToken) return;
        const notes = rows
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map((note) => ({ id: note.id, title: note.title || 'Untitled' }));
        this.notes.set(notes);
    }

    private async refreshMemberships(lens: GraphLensState): Promise<void> {
        const token = ++this.membershipToken;
        const noteIds = lens.mode === 'note'
            ? (lens.primaryNoteId ? [lens.primaryNoteId] : [])
            : lens.mode === 'multiNote' ? lens.selectedNoteIds : [];
        if (noteIds.length === 0) {
            this.memberships.set([]);
            return;
        }
        const rows = (await Promise.all(noteIds.map((noteId) => db.entityNoteIndex.where('noteId').equals(noteId).toArray()))).flat();
        if (token !== this.membershipToken) return;
        this.memberships.set(rows.map((row) => ({
            noteId: row.noteId,
            entityId: row.entityId,
            occurrenceCount: row.occurrenceCount,
        })));
    }

    private async loadPersistedGraphSnapshot(lens: GraphLensState): Promise<void> {
        const token = ++this.graphSnapshotLoadToken;
        const normalized = normalizeGraphLensForBuild(lens);
        try {
            const snapshot = await this.graphRebuild.loadPersistedSnapshot(normalized.scopeId);
            if (token === this.graphSnapshotLoadToken) {
                this.graphRebuildSnapshotSignal.set(snapshot);
                this.graphSnapshotStaleSignal.set(false);
            }
        } catch (error) {
            console.warn('[GraphLensWorkspace] Failed to load graph rebuild snapshot', error);
        }
    }

    private bindAnchorEvents(): void {
        if (typeof window === 'undefined') return;
        const markStale = () => this.graphSnapshotStaleSignal.set(true);
        const reload = () => void this.loadPersistedGraphSnapshot(this.lens());
        window.addEventListener('graph-rebuild-anchors-changed', markStale);
        window.addEventListener('entities-changed', markStale);
        window.addEventListener('graph-rebuild-snapshot-updated', reload);
        window.addEventListener('graph-index-run-completed', reload);
        this.removeAnchorListeners = () => {
            window.removeEventListener('graph-rebuild-anchors-changed', markStale);
            window.removeEventListener('entities-changed', markStale);
            window.removeEventListener('graph-rebuild-snapshot-updated', reload);
            window.removeEventListener('graph-index-run-completed', reload);
        };
    }
}

function normalizeGraphLensForBuild(lens: GraphLensState): {
    scopeKind: GraphRebuildSnapshot['scopeKind'];
    scopeId: string;
    noteIds: string[];
} {
    if (lens.mode === 'note') {
        const noteId = lens.primaryNoteId || lens.selectedNoteIds[0] || '';
        return { scopeKind: 'note', scopeId: noteId ? `note:${noteId}` : 'note:none', noteIds: noteId ? [noteId] : [] };
    }
    if (lens.mode === 'multiNote') {
        const noteIds = lens.selectedNoteIds.length ? lens.selectedNoteIds : (lens.primaryNoteId ? [lens.primaryNoteId] : []);
        return { scopeKind: 'multiNote', scopeId: `multi:${noteIds.join('|') || 'none'}`, noteIds };
    }
    if (lens.mode === 'narrative') {
        return { scopeKind: 'narrative', scopeId: 'narrative:active', noteIds: [] };
    }
    return { scopeKind: 'global', scopeId: 'global', noteIds: [] };
}

function graphInventoryFromSnapshot(snapshot: GraphRebuildSnapshot | null): GraphInventory {
    if (!snapshot) return EMPTY_GRAPH_INVENTORY;
    const nodes = snapshot.nodes.map((node, index) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        aliases: node.aliases,
        totalMentions: node.totalMentions,
        ...stablePoint(node.id, index),
        colorHsl: entityColorStore.getRawHsl(node.kind as any),
        metadata: {
            sourceType: 'graph-rebuild',
            sourceEntityId: node.entityId,
            graphKind: 'entity',
            anchorIds: node.anchorIds,
            noteIds: node.noteIds,
        },
    }));
    const chunkMentionCounts = new Map<string, number>();
    for (const anchor of snapshot.entityAnchors) {
        if (!anchor.chunkId) continue;
        chunkMentionCounts.set(anchor.chunkId, (chunkMentionCounts.get(anchor.chunkId) || 0) + 1);
    }
    const chunkNodes = snapshot.chunks.map((chunk, index) => ({
        id: chunkNodeId(chunk.id),
        label: `Chunk ${chunk.ordinal + 1}`,
        kind: 'chunk',
        totalMentions: Math.max(1, chunkMentionCounts.get(chunk.id) || 0),
        ...stablePoint(chunk.id, nodes.length + index),
        colorHsl: graphKindHsl('chunk'),
        metadata: {
            sourceType: 'graph-rebuild',
            graphKind: 'chunk',
            chunkId: chunk.id,
            noteId: chunk.noteId,
            start: chunk.start,
            end: chunk.end,
            source: chunk.source,
        },
    }));
    const inventoryNodes = [...nodes, ...chunkNodes];
    const entityIds = new Set(snapshot.nodes.map((node) => node.id));
    const chunkIds = new Set(snapshot.chunks.map((chunk) => chunk.id));
    const anchorEdges = snapshot.entityAnchors
        .filter((anchor) => anchor.chunkId && entityIds.has(anchor.entityId) && chunkIds.has(anchor.chunkId))
        .map((anchor) => ({
            id: `anchor:${anchor.id}`,
            sourceId: chunkNodeId(anchor.chunkId!),
            targetId: anchor.entityId,
            type: 'entity_anchor',
            confidence: Math.max(0.25, Math.min(1.2, anchor.confidence)),
        }));
    return {
        nodes: inventoryNodes,
        edges: [
            ...snapshot.edges.map((edge) => ({
                id: edge.id,
                sourceId: edge.sourceId,
                targetId: edge.targetId,
                type: edge.type,
                confidence: Math.max(0.25, Math.min(1.8, edge.confidence + edge.weight * 0.08)),
            })),
            ...anchorEdges,
        ],
        kindCounts: graphKindCounts(inventoryNodes),
        sourceLabel: 'graph rebuild snapshot',
    };
}

function graphKindCounts(nodes: GraphInventory['nodes']): Array<{ kind: string; count: number }> {
    const counts = new Map<string, number>();
    for (const node of nodes) {
        const kind = String(node.kind || 'unknown').toLowerCase();
        counts.set(kind, (counts.get(kind) || 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

function stablePoint(id: string, index: number): { atlasX: number; atlasY: number; atlasZ: number } {
    const angle = index * 2.399963229728653 + hashUnit(id);
    const y = 1 - ((index % 89) / 88) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y)) * 0.92;
    return {
        atlasX: Math.cos(angle) * radius,
        atlasY: y * 0.7,
        atlasZ: Math.sin(angle) * radius,
    };
}

function chunkNodeId(chunkId: string): string {
    return `chunk:${chunkId}`;
}

function graphKindHsl(kind: string): string {
    switch (String(kind || '').toLowerCase()) {
        case 'chunk': return '176 70% 46%';
        case 'event': return '25 90% 55%';
        case 'memory': return '188 76% 52%';
        default: return '220 10% 54%';
    }
}

function hashUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}
