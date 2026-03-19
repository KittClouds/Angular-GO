import type { AnalyticsHighlightRange } from '../analytics';
import type { AnalyticsHighlightKind } from '../Scanner/types';

export interface AnalyticsHighlightSelection {
    noteId: string;
    key: string;
    kind: AnalyticsHighlightKind;
    label: string;
    ranges: AnalyticsHighlightRange[];
}

export class AnalyticsHighlightStore {
    private selection: AnalyticsHighlightSelection | null = null;
    private listeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getSelection(): AnalyticsHighlightSelection | null {
        return this.selection;
    }

    setSelection(selection: AnalyticsHighlightSelection): void {
        if (this.isSameSelection(selection)) {
            return;
        }

        this.selection = selection;
        this.emit();
    }

    toggleSelection(selection: AnalyticsHighlightSelection): void {
        if (this.isSameSelection(selection)) {
            this.clear();
            return;
        }

        this.selection = selection;
        this.emit();
    }

    clear(): void {
        if (!this.selection) {
            return;
        }

        this.selection = null;
        this.emit();
    }

    clearForNote(noteId: string | null | undefined): void {
        if (!noteId || this.selection?.noteId !== noteId) {
            return;
        }

        this.selection = null;
        this.emit();
    }

    private isSameSelection(next: AnalyticsHighlightSelection): boolean {
        const current = this.selection;
        if (!current) {
            return false;
        }

        return current.noteId === next.noteId
            && current.key === next.key
            && current.kind === next.kind;
    }

    private emit(): void {
        this.listeners.forEach(listener => listener());
    }
}

export const analyticsHighlightStore = new AnalyticsHighlightStore();
