import { Injectable, computed, signal } from '@angular/core';

export type RetrievalLane = 'lexical' | 'semantic' | 'graph' | 'entities' | 'evidence';
export type RetrievalGraphLensMode = 'global' | 'narrative' | 'note' | 'multiNote';

export type RetrievalLaneState = Record<RetrievalLane, boolean>;

export interface RetrievalGraphFocus {
    query: string;
    scope: 'global' | string;
    noteId?: string;
    title?: string;
    requestedAt: number;
}

const DEFAULT_LANES: RetrievalLaneState = {
    lexical: true,
    semantic: false,
    graph: true,
    entities: true,
    evidence: false,
};

@Injectable({ providedIn: 'root' })
export class RetrievalWorkbenchStateService {
    readonly query = signal('');
    readonly scope = signal<'global' | string>('global');
    readonly lanes = signal<RetrievalLaneState>({ ...DEFAULT_LANES });
    readonly graphFocus = signal<RetrievalGraphFocus | null>(null);
    readonly graphLensMode = signal<RetrievalGraphLensMode>('global');

    readonly activeLanes = computed(() =>
        (Object.entries(this.lanes()) as Array<[RetrievalLane, boolean]>)
            .filter(([, enabled]) => enabled)
            .map(([lane]) => lane)
    );

    setLane(lane: RetrievalLane, enabled: boolean): void {
        if (lane === 'lexical') {
            enabled = true;
        }
        this.lanes.update((current) => ({ ...current, [lane]: enabled }));
    }

    toggleLane(lane: RetrievalLane): void {
        this.setLane(lane, !this.lanes()[lane]);
    }

    requestGraphFocus(focus: Omit<RetrievalGraphFocus, 'requestedAt'>): void {
        this.graphFocus.set({ ...focus, requestedAt: Date.now() });
    }

    setGraphLensMode(mode: RetrievalGraphLensMode): void {
        this.graphLensMode.set(mode);
    }
}
