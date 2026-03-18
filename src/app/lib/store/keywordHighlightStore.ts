import { getSetting, setSetting } from '../dexie/settings.service';
import { normalizeKeyword } from '../Scanner/keyword-focus';

const STORAGE_KEY = 'keyword-highlight-selections';

export type KeywordHighlightSelections = Record<string, string[]>;

export class KeywordHighlightStore {
    private selectionsByNote: KeywordHighlightSelections;
    private listeners = new Set<() => void>();

    constructor(
        private readonly read: (key: string, defaultValue: KeywordHighlightSelections) => KeywordHighlightSelections = getSetting,
        private readonly write: (key: string, value: KeywordHighlightSelections) => void = setSetting,
    ) {
        this.selectionsByNote = this.loadFromStorage();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getKeywordsForNote(noteId: string | null | undefined): string[] {
        if (!noteId) {
            return [];
        }

        return this.selectionsByNote[noteId] ?? [];
    }

    isKeywordSelected(noteId: string | null | undefined, keyword: string): boolean {
        const normalized = normalizeKeyword(keyword);
        return this.getKeywordsForNote(noteId).includes(normalized);
    }

    setKeywordsForNote(noteId: string | null | undefined, keywords: string[]): void {
        if (!noteId) {
            return;
        }

        const normalizedKeywords = [...new Set(
            keywords
                .map(normalizeKeyword)
                .filter(Boolean)
        )];

        if (normalizedKeywords.length === 0) {
            delete this.selectionsByNote[noteId];
        } else {
            this.selectionsByNote = {
                ...this.selectionsByNote,
                [noteId]: normalizedKeywords,
            };
        }

        this.persist();
    }

    toggleKeyword(noteId: string | null | undefined, keyword: string): void {
        if (!noteId) {
            return;
        }

        const normalizedKeyword = normalizeKeyword(keyword);
        if (!normalizedKeyword) {
            return;
        }

        const current = this.getKeywordsForNote(noteId);
        const next = current.includes(normalizedKeyword)
            ? current.filter(item => item !== normalizedKeyword)
            : [...current, normalizedKeyword];

        this.setKeywordsForNote(noteId, next);
    }

    clearKeywordsForNote(noteId: string | null | undefined): void {
        if (!noteId || !this.selectionsByNote[noteId]) {
            return;
        }

        delete this.selectionsByNote[noteId];
        this.persist();
    }

    private loadFromStorage(): KeywordHighlightSelections {
        const stored = this.read(STORAGE_KEY, {});
        return Object.fromEntries(
            Object.entries(stored).map(([noteId, keywords]) => [
                noteId,
                [...new Set((keywords ?? []).map(normalizeKeyword).filter(Boolean))],
            ])
        );
    }

    private persist(): void {
        this.write(STORAGE_KEY, this.selectionsByNote);
        this.listeners.forEach(listener => listener());
    }
}

export const keywordHighlightStore = new KeywordHighlightStore();
