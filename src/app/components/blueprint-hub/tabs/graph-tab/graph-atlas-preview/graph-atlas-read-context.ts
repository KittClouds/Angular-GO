import type { SearchScope } from '../../../../../services/phoenix-ui-api.service';
import type { GraphLensMode, GraphLensState } from '../graph-lens';

export interface GraphAtlasReadContext {
    readonly lensMode: GraphLensMode;
    readonly primaryNoteId: string | null;
    readonly selectedNoteIds: string[];
    readonly noteIds: string[];
    readonly searchScope: SearchScope;
    readonly key: string;
    readonly label: string;
}

export function graphLensState(
    mode: GraphLensMode,
    primaryNoteId: string | null | undefined,
    selectedNoteIds: readonly string[] | null | undefined,
): GraphLensState {
    return normalizeGraphLensState({
        mode,
        primaryNoteId: primaryNoteId || null,
        selectedNoteIds: Array.isArray(selectedNoteIds) ? [...selectedNoteIds] : [],
    });
}

export function buildGraphAtlasReadContext(lens: GraphLensState): GraphAtlasReadContext {
    const normalized = normalizeGraphLensState(lens);
    if (normalized.mode === 'note') {
        const noteIds = normalized.primaryNoteId ? [normalized.primaryNoteId] : [];
        return {
            lensMode: normalized.mode,
            primaryNoteId: normalized.primaryNoteId,
            selectedNoteIds: noteIds,
            noteIds,
            searchScope: noteIds[0] ? { mode: 'note', noteId: noteIds[0] } : { mode: 'note' },
            key: noteIds[0] ? `note:${noteIds[0]}` : 'note:none',
            label: noteIds[0] ? 'Note Lens' : 'Note Lens Empty',
        };
    }
    if (normalized.mode === 'multiNote') {
        const noteIds = uniqueIds(normalized.selectedNoteIds);
        return {
            lensMode: normalized.mode,
            primaryNoteId: noteIds.includes(normalized.primaryNoteId || '') ? normalized.primaryNoteId : noteIds[0] ?? null,
            selectedNoteIds: noteIds,
            noteIds,
            searchScope: noteIds.length ? { mode: 'multiNote', noteIds } : { mode: 'multiNote' },
            key: noteIds.length ? `multi:${noteIds.join('|')}` : 'multi:none',
            label: noteIds.length > 1 ? 'Compare Lens' : 'Compare Lens Empty',
        };
    }
    if (normalized.mode === 'narrative') {
        return {
            lensMode: normalized.mode,
            primaryNoteId: null,
            selectedNoteIds: [],
            noteIds: [],
            searchScope: { mode: 'narrative' },
            key: 'narrative',
            label: 'Narrative Lens',
        };
    }
    return {
        lensMode: 'global',
        primaryNoteId: null,
        selectedNoteIds: [],
        noteIds: [],
        searchScope: { mode: 'global' },
        key: 'global',
        label: 'Global Lens',
    };
}

function normalizeGraphLensState(lens: GraphLensState): GraphLensState {
    const mode = lens.mode || 'global';
    if (mode === 'global' || mode === 'narrative') {
        return { mode, primaryNoteId: null, selectedNoteIds: [] };
    }
    if (mode === 'note') {
        const primaryNoteId = lens.primaryNoteId || lens.selectedNoteIds[0] || null;
        return { mode, primaryNoteId, selectedNoteIds: primaryNoteId ? [primaryNoteId] : [] };
    }
    const selectedNoteIds = uniqueIds(lens.selectedNoteIds);
    const primaryNoteId = selectedNoteIds.includes(lens.primaryNoteId || '')
        ? lens.primaryNoteId
        : selectedNoteIds[0] ?? null;
    return { mode, primaryNoteId, selectedNoteIds };
}

function uniqueIds(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
