import type { RegisteredEntity } from '../../../../lib/registry';
import type { AtlasPreviewEdge } from './graph-atlas-preview/graph-atlas-preview.component';
import type { GalaxyRenderableNode } from './graph-atlas-preview/graph-galaxy-engine';

export type GraphLensMode = 'global' | 'narrative' | 'note' | 'multiNote';
export type GraphGalaxyRole = 'primary' | 'context';

export interface GraphLensNote {
    id: string;
    title: string;
}

export interface GraphLensMembership {
    noteId: string;
    entityId: string;
    occurrenceCount?: number;
}

export interface GraphLensState {
    mode: GraphLensMode;
    primaryNoteId: string | null;
    selectedNoteIds: string[];
}

export interface GraphLensInput {
    lens: GraphLensState;
    notes: GraphLensNote[];
    globalEntities: RegisteredEntity[];
    narrativeEntities: RegisteredEntity[];
    globalEdges: AtlasPreviewEdge[];
    narrativeEdges: AtlasPreviewEdge[];
    memberships: GraphLensMembership[];
}

export interface GraphLensView {
    entities: GalaxyRenderableNode[];
    edges: AtlasPreviewEdge[];
    sourceLabel: string;
    primaryNoteId: string | null;
    selectedNoteIds: string[];
}

export const DEFAULT_GRAPH_LENS: GraphLensState = {
    mode: 'global',
    primaryNoteId: null,
    selectedNoteIds: [],
};

export function buildGraphLensView(input: GraphLensInput): GraphLensView {
    const lens = normalizeLens(input.lens, input.notes);
    if (lens.mode === 'global') {
        return {
            entities: input.globalEntities,
            edges: filterEdges(input.globalEdges, entityIdSet(input.globalEntities)),
            sourceLabel: 'global lens',
            primaryNoteId: null,
            selectedNoteIds: [],
        };
    }
    if (lens.mode === 'narrative') {
        return {
            entities: input.narrativeEntities,
            edges: filterEdges(input.narrativeEdges, entityIdSet(input.narrativeEntities)),
            sourceLabel: 'narrative lens',
            primaryNoteId: null,
            selectedNoteIds: [],
        };
    }

    const sourceEntities = input.narrativeEntities.length ? input.narrativeEntities : input.globalEntities;
    const sourceEdges = input.narrativeEdges.length ? input.narrativeEdges : input.globalEdges;
    const membership = buildMembershipMap(sourceEntities, input.memberships);

    if (lens.mode === 'note') {
        const noteId = lens.primaryNoteId;
        const ids = noteId ? membership.get(noteId) ?? new Set<string>() : new Set<string>();
        const entities = sourceEntities.filter((entity) => ids.has(entity.id));
        return {
            entities,
            edges: filterEdges(sourceEdges, ids),
            sourceLabel: noteId ? noteTitle(input.notes, noteId) : 'active note',
            primaryNoteId: noteId,
            selectedNoteIds: noteId ? [noteId] : [],
        };
    }

    const selectedNoteIds = lens.selectedNoteIds.length ? lens.selectedNoteIds : (lens.primaryNoteId ? [lens.primaryNoteId] : []);
    return buildMultiNoteView({
        notes: input.notes,
        noteIds: selectedNoteIds,
        primaryNoteId: lens.primaryNoteId ?? selectedNoteIds[0] ?? null,
        entities: sourceEntities,
        edges: sourceEdges,
        membership,
    });
}

export function normalizeLens(lens: GraphLensState, notes: GraphLensNote[]): GraphLensState {
    const noteIds = new Set(notes.map((note) => note.id));
    const selectedNoteIds = unique(lens.selectedNoteIds.filter((id) => noteIds.has(id)));
    if (lens.mode === 'global' || lens.mode === 'narrative') {
        return { ...lens, primaryNoteId: null, selectedNoteIds: [] };
    }
    const fallbackPrimary = lens.primaryNoteId && noteIds.has(lens.primaryNoteId)
        ? lens.primaryNoteId
        : selectedNoteIds[0] ?? notes[0]?.id ?? null;

    if (lens.mode === 'note') {
        return { ...lens, primaryNoteId: fallbackPrimary, selectedNoteIds: fallbackPrimary ? [fallbackPrimary] : [] };
    }
    if (lens.mode === 'multiNote') {
        const selected = selectedNoteIds.length ? selectedNoteIds : (fallbackPrimary ? [fallbackPrimary] : []);
        const primary = fallbackPrimary && selected.includes(fallbackPrimary) ? fallbackPrimary : selected[0] ?? null;
        return { ...lens, primaryNoteId: primary, selectedNoteIds: selected };
    }
    return { ...lens, primaryNoteId: null, selectedNoteIds: [] };
}

export function buildUniqueAtlasEdges(entities: RegisteredEntity[], edgeReader: (entityId: string) => AtlasPreviewEdge[]): AtlasPreviewEdge[] {
    const ids = entityIdSet(entities);
    const seen = new Set<string>();
    const edges: AtlasPreviewEdge[] = [];
    for (const entity of entities) {
        for (const edge of edgeReader(entity.id)) {
            if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) continue;
            const id = edge.id || `${edge.sourceId}:${edge.type}:${edge.targetId}`;
            if (seen.has(id)) continue;
            seen.add(id);
            edges.push({ ...edge, id });
        }
    }
    return edges;
}

function buildMultiNoteView(input: {
    notes: GraphLensNote[];
    noteIds: string[];
    primaryNoteId: string | null;
    entities: RegisteredEntity[];
    edges: AtlasPreviewEdge[];
    membership: Map<string, Set<string>>;
}): GraphLensView {
    const entityById = new Map(input.entities.map((entity) => [entity.id, entity]));
    const visualNodes: GalaxyRenderableNode[] = [];
    const visualEdges: AtlasPreviewEdge[] = [];
    const primaryNoteId = input.primaryNoteId ?? input.noteIds[0] ?? null;
    const noteCount = Math.max(1, input.noteIds.length);

    input.noteIds.forEach((noteId, index) => {
        const ids = input.membership.get(noteId) ?? new Set<string>();
        const role: GraphGalaxyRole = noteId === primaryNoteId ? 'primary' : 'context';
        const offset = galaxyOffset(index, noteCount, role);
        const opacity = role === 'primary' ? 1 : 0.38;

        for (const entityId of ids) {
            const entity = entityById.get(entityId);
            if (!entity) continue;
            const baseMetadata = (entity as GalaxyRenderableNode).metadata ?? {};
            visualNodes.push({
                ...entity,
                id: visualId(noteId, entity.id),
                metadata: {
                    ...baseMetadata,
                    sourceEntityId: entity.id,
                    galaxyId: noteId,
                    galaxyRole: role,
                    galaxyOffset: offset,
                    galaxyOpacity: opacity,
                },
            });
        }

        const noteEdges = filterEdges(input.edges, ids);
        for (const edge of noteEdges) {
            visualEdges.push({
                ...edge,
                id: `${noteId}:${edge.id}`,
                sourceId: visualId(noteId, edge.sourceId),
                targetId: visualId(noteId, edge.targetId),
                confidence: role === 'primary' ? edge.confidence : edge.confidence * 0.72,
            });
        }
    });

    visualEdges.push(...buildBridgeEdges(input.noteIds, primaryNoteId, input.membership));
    return {
        entities: visualNodes,
        edges: visualEdges,
        sourceLabel: input.noteIds.length > 1 ? 'compare notes' : noteTitle(input.notes, primaryNoteId ?? ''),
        primaryNoteId,
        selectedNoteIds: input.noteIds,
    };
}

function buildMembershipMap(entities: RegisteredEntity[], rows: GraphLensMembership[]): Map<string, Set<string>> {
    const byNote = new Map<string, Set<string>>();
    const add = (noteId: string | undefined, entityId: string | undefined) => {
        if (!noteId || !entityId) return;
        let ids = byNote.get(noteId);
        if (!ids) byNote.set(noteId, ids = new Set<string>());
        ids.add(entityId);
    };
    for (const row of rows) add(row.noteId, row.entityId);
    for (const entity of entities) {
        add(entity.firstNote, entity.id);
        for (const [noteId] of entity.mentionsByNote ?? []) add(noteId, entity.id);
    }
    return byNote;
}

function buildBridgeEdges(noteIds: string[], primaryNoteId: string | null, membership: Map<string, Set<string>>): AtlasPreviewEdge[] {
    if (!primaryNoteId || noteIds.length < 2) return [];
    const primaryIds = membership.get(primaryNoteId) ?? new Set<string>();
    const edges: AtlasPreviewEdge[] = [];
    for (const noteId of noteIds) {
        if (noteId === primaryNoteId) continue;
        for (const entityId of membership.get(noteId) ?? []) {
            if (!primaryIds.has(entityId)) continue;
            edges.push({
                id: `bridge:${primaryNoteId}:${noteId}:${entityId}`,
                sourceId: visualId(primaryNoteId, entityId),
                targetId: visualId(noteId, entityId),
                type: 'same-entity',
                confidence: 0.22,
            });
            if (edges.length >= 80) return edges;
        }
    }
    return edges;
}

function filterEdges(edges: AtlasPreviewEdge[], ids: Set<string>): AtlasPreviewEdge[] {
    return edges.filter((edge) => ids.has(edge.sourceId) && ids.has(edge.targetId));
}

function entityIdSet(entities: RegisteredEntity[]): Set<string> {
    return new Set(entities.map((entity) => entity.id));
}

function visualId(noteId: string, entityId: string): string {
    return `${noteId}:${entityId}`;
}

function galaxyOffset(index: number, total: number, role: GraphGalaxyRole): { x: number; y: number; z: number } {
    if (role === 'primary') return { x: 0, y: 0, z: 0 };
    const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 3;
    return {
        x: Math.cos(angle) * 1.75,
        y: -0.18 + (index % 2) * 0.34,
        z: -0.95 + Math.sin(angle) * 0.95,
    };
}

function noteTitle(notes: GraphLensNote[], noteId: string): string {
    return notes.find((note) => note.id === noteId)?.title || 'note lens';
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}
