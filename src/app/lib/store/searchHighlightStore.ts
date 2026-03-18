export class SearchHighlightStore {
    private terms: string[] = [];
    private listeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getTerms(): string[] {
        return this.terms;
    }

    setTerms(terms: string[]): void {
        const nextTerms = [...new Set(terms.filter(Boolean))];
        if (this.arraysEqual(this.terms, nextTerms)) {
            return;
        }

        this.terms = nextTerms;
        this.emit();
    }

    clear(): void {
        if (this.terms.length === 0) {
            return;
        }

        this.terms = [];
        this.emit();
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }

    private arraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return false;
        }

        return a.every((value, index) => value === b[index]);
    }
}

export const searchHighlightStore = new SearchHighlightStore();
