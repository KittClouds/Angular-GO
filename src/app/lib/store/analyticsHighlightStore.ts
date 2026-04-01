import type { AnalyticsHighlightRange } from '../analytics';
import type { AnalyticsHighlightKind, AnalyticsHighlightPaletteKey, SentenceVariationBucket } from '../Scanner/types';

export interface AnalyticsHighlightSelection {
    noteId: string;
    key: string;
    kind: AnalyticsHighlightKind;
    label: string;
    ranges: AnalyticsHighlightRange[];
    paletteKey?: AnalyticsHighlightPaletteKey;
}

export class AnalyticsHighlightStore {
    private detailSelection: AnalyticsHighlightSelection | null = null;
    private activeVariationBucketsByNote = new Map<string, Set<SentenceVariationBucket>>();
    private derivedVariationSelectionsByNote = new Map<string, AnalyticsHighlightSelection[]>();
    private listeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getDetailSelection(): AnalyticsHighlightSelection | null {
        return this.detailSelection;
    }

    getVariationSelections(noteId?: string | null): AnalyticsHighlightSelection[] {
        if (noteId) {
            return [...(this.derivedVariationSelectionsByNote.get(noteId) || [])];
        }

        return Array.from(this.derivedVariationSelectionsByNote.values()).flatMap(selections => selections);
    }

    getActiveVariationBuckets(noteId?: string | null): Set<SentenceVariationBucket> {
        if (!noteId) {
            return new Set(
                Array.from(this.activeVariationBucketsByNote.values())
                    .flatMap(buckets => Array.from(buckets)),
            );
        }

        return new Set(this.activeVariationBucketsByNote.get(noteId) || []);
    }

    getSelections(noteId?: string | null): AnalyticsHighlightSelection[] {
        const selections: AnalyticsHighlightSelection[] = [];

        if (this.detailSelection && (!noteId || this.detailSelection.noteId === noteId)) {
            selections.push(this.detailSelection);
        }

        selections.push(...this.getVariationSelections(noteId));
        return selections;
    }

    setSelection(selection: AnalyticsHighlightSelection): void {
        if (this.isSameSelection(this.detailSelection, selection)) {
            return;
        }

        this.detailSelection = selection;
        this.emit();
    }

    toggleSelection(selection: AnalyticsHighlightSelection): void {
        if (this.isSameSelection(this.detailSelection, selection)) {
            this.clearDetailSelection();
            return;
        }

        this.detailSelection = selection;
        this.emit();
    }

    setSentenceVariationHighlights(
        noteId: string,
        buckets: ReadonlySet<SentenceVariationBucket>,
        selections: AnalyticsHighlightSelection[],
    ): void {
        const normalizedBuckets = new Set(buckets);
        const normalizedSelections = [...selections];
        const previousBuckets = this.activeVariationBucketsByNote.get(noteId) || new Set<SentenceVariationBucket>();
        const previousSelections = this.derivedVariationSelectionsByNote.get(noteId) || [];

        const bucketsChanged = !this.areBucketSetsEqual(previousBuckets, normalizedBuckets);
        const selectionsChanged = !this.areSelectionsEqual(previousSelections, normalizedSelections);

        if (!bucketsChanged && !selectionsChanged) {
            return;
        }

        if (normalizedBuckets.size > 0) {
            this.activeVariationBucketsByNote.set(noteId, normalizedBuckets);
        } else {
            this.activeVariationBucketsByNote.delete(noteId);
        }

        if (normalizedSelections.length > 0) {
            this.derivedVariationSelectionsByNote.set(noteId, normalizedSelections);
        } else {
            this.derivedVariationSelectionsByNote.delete(noteId);
        }

        this.emit();
    }

    clearDetailSelection(): void {
        if (!this.detailSelection) {
            return;
        }

        this.detailSelection = null;
        this.emit();
    }

    clearVariationSelections(noteId?: string | null): void {
        this.clearSentenceVariationHighlights(noteId);
    }

    clearSentenceVariationHighlights(noteId?: string | null): void {
        if (this.activeVariationBucketsByNote.size === 0 && this.derivedVariationSelectionsByNote.size === 0) {
            return;
        }

        if (!noteId) {
            this.activeVariationBucketsByNote.clear();
            this.derivedVariationSelectionsByNote.clear();
            this.emit();
            return;
        }

        const hadBuckets = this.activeVariationBucketsByNote.delete(noteId);
        const hadSelections = this.derivedVariationSelectionsByNote.delete(noteId);
        if (!hadBuckets && !hadSelections) {
            return;
        }

        this.emit();
    }

    clear(): void {
        if (!this.detailSelection && this.activeVariationBucketsByNote.size === 0 && this.derivedVariationSelectionsByNote.size === 0) {
            return;
        }

        this.detailSelection = null;
        this.activeVariationBucketsByNote.clear();
        this.derivedVariationSelectionsByNote.clear();
        this.emit();
    }

    clearForNote(noteId: string | null | undefined): void {
        if (!noteId) {
            return;
        }

        const detailChanged = this.detailSelection?.noteId === noteId;
        const variationChanged = this.activeVariationBucketsByNote.delete(noteId) || this.derivedVariationSelectionsByNote.delete(noteId);

        if (!detailChanged && !variationChanged) {
            return;
        }

        if (detailChanged) {
            this.detailSelection = null;
        }
        this.emit();
    }

    private isSameSelection(
        current: AnalyticsHighlightSelection | null | undefined,
        next: AnalyticsHighlightSelection,
    ): boolean {
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

    private areBucketSetsEqual(
        left: ReadonlySet<SentenceVariationBucket>,
        right: ReadonlySet<SentenceVariationBucket>,
    ): boolean {
        if (left.size !== right.size) {
            return false;
        }

        for (const bucket of left) {
            if (!right.has(bucket)) {
                return false;
            }
        }

        return true;
    }

    private areSelectionsEqual(
        left: AnalyticsHighlightSelection[],
        right: AnalyticsHighlightSelection[],
    ): boolean {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((selection, index) => {
            const candidate = right[index];
            if (!candidate) {
                return false;
            }

            if (
                selection.noteId !== candidate.noteId ||
                selection.key !== candidate.key ||
                selection.kind !== candidate.kind ||
                selection.label !== candidate.label ||
                selection.paletteKey !== candidate.paletteKey ||
                selection.ranges.length !== candidate.ranges.length
            ) {
                return false;
            }

            return selection.ranges.every((range, rangeIndex) => {
                const other = candidate.ranges[rangeIndex];
                return !!other
                    && range.from === other.from
                    && range.to === other.to
                    && range.text === other.text;
            });
        });
    }
}

export const analyticsHighlightStore = new AnalyticsHighlightStore();
