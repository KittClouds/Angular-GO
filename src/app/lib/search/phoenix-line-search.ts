import {
    matchLiteralPatterns,
    type PhoenixLiteralMatch,
    type PhoenixLiteralPattern,
} from './phoenix-literal-matcher';

export { matchLiteralPatterns };
export type { PhoenixLiteralPattern };

export type PhoenixLineSearchMode = 'auto' | 'literal' | 'regex';

export interface PhoenixLineSearchDocument {
    noteId: string;
    title: string;
    content: string;
    markdownContent?: string;
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
    updatedAt?: number;
    version?: number;
}

export interface PhoenixLineSearchScope {
    noteId?: string;
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
}

export interface PhoenixLineSearchOptions {
    limit?: number;
    before?: number;
    after?: number;
    mode?: PhoenixLineSearchMode;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    scope?: PhoenixLineSearchScope;
    maxCandidateDocs?: number;
}

export type PhoenixLineSearchMatch<T = unknown> = PhoenixLiteralMatch<T>;

export interface PhoenixLineSearchHit {
    noteId: string;
    title: string;
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
    lineNumber: number;
    lineStart: number;
    lineEnd: number;
    lineText: string;
    matches: PhoenixLineSearchMatch[];
    before: string[];
    after: string[];
    score: number;
    generation: string;
}

interface IndexedDoc {
    source: PhoenixLineSearchDocument;
    body: string;
    lines: IndexedLine[];
    termFreq: Map<string, number>;
    length: number;
}

interface IndexedLine {
    number: number;
    start: number;
    end: number;
    text: string;
}

interface SearchPlan {
    mode: PhoenixLineSearchMode;
    terms: string[];
    tokens: string[];
    regex?: RegExp;
}

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_CANDIDATES = 320;

export class PhoenixLineSearchIndex {
    private readonly docs: IndexedDoc[];
    private readonly postings = new Map<string, Set<number>>();
    private readonly avgDocLength: number;

    constructor(documents: PhoenixLineSearchDocument[], readonly generation = '0') {
        this.docs = documents.map((document) => this.indexDocument(document));
        let totalLength = 0;
        for (let docIndex = 0; docIndex < this.docs.length; docIndex += 1) {
            const doc = this.docs[docIndex];
            totalLength += doc.length;
            for (const token of doc.termFreq.keys()) {
                let posting = this.postings.get(token);
                if (!posting) {
                    posting = new Set<number>();
                    this.postings.set(token, posting);
                }
                posting.add(docIndex);
            }
        }
        this.avgDocLength = this.docs.length ? totalLength / this.docs.length : 1;
    }

    search(query: string, options: PhoenixLineSearchOptions = {}): PhoenixLineSearchHit[] {
        const plan = buildSearchPlan(query, options);
        if (!plan.terms.length && !plan.regex) {
            return [];
        }

        const limit = clampPositive(options.limit, DEFAULT_LIMIT);
        const before = clampPositive(options.before, 0);
        const after = clampPositive(options.after, 0);
        const candidateDocs = this.collectCandidateDocs(plan, options);
        const hits: PhoenixLineSearchHit[] = [];

        for (const docIndex of candidateDocs) {
            const doc = this.docs[docIndex];
            const titleMatches = plan.regex
                ? matchRegex(doc.source.title, plan.regex, 24)
                : matchLiteralPatterns(doc.source.title, termsToPatterns(plan.terms), {
                    caseSensitive: options.caseSensitive,
                    wholeWord: options.wholeWord,
                });
            if (titleMatches.length) {
                hits.push(this.createTitleHit(doc, titleMatches, plan, options));
            }

            for (let lineIndex = 0; lineIndex < doc.lines.length; lineIndex += 1) {
                const line = doc.lines[lineIndex];
                const matches = plan.regex
                    ? matchRegex(line.text, plan.regex, 24)
                    : matchLiteralPatterns(line.text, termsToPatterns(plan.terms), {
                        caseSensitive: options.caseSensitive,
                        wholeWord: options.wholeWord,
                    });
                if (!matches.length) {
                    continue;
                }
                hits.push({
                    noteId: doc.source.noteId,
                    title: doc.source.title,
                    worldId: doc.source.worldId,
                    narrativeId: doc.source.narrativeId,
                    folderId: doc.source.folderId,
                    folderPath: doc.source.folderPath,
                    lineNumber: line.number,
                    lineStart: line.start,
                    lineEnd: line.end,
                    lineText: line.text,
                    matches,
                    before: collectContext(doc.lines, lineIndex - before, lineIndex),
                    after: collectContext(doc.lines, lineIndex + 1, lineIndex + 1 + after),
                    score: this.scoreLineHit(docIndex, line.text, matches, plan, false),
                    generation: this.generation,
                });
                if (hits.length >= limit * 8) {
                    break;
                }
            }
        }

        return hits
            .sort((left, right) => right.score - left.score || left.noteId.localeCompare(right.noteId))
            .slice(0, limit);
    }

    private indexDocument(document: PhoenixLineSearchDocument): IndexedDoc {
        const body = document.markdownContent || document.content || '';
        const termFreq = new Map<string, number>();
        addTokenWeights(termFreq, document.title || '', 4);
        addTokenWeights(termFreq, body, 1);
        let length = 0;
        for (const count of termFreq.values()) {
            length += count;
        }
        return {
            source: document,
            body,
            lines: splitLines(body),
            termFreq,
            length: Math.max(1, length),
        };
    }

    private collectCandidateDocs(plan: SearchPlan, options: PhoenixLineSearchOptions): number[] {
        const scores = new Map<number, number>();
        if (plan.tokens.length) {
            for (const token of plan.tokens) {
                const posting = this.postings.get(token);
                if (!posting) {
                    continue;
                }
                for (const docIndex of posting) {
                    if (!this.matchesScope(this.docs[docIndex], options.scope)) {
                        continue;
                    }
                    scores.set(docIndex, (scores.get(docIndex) || 0) + this.bm25(docIndex, token));
                }
            }
        }

        if (!scores.size) {
            for (let docIndex = 0; docIndex < this.docs.length; docIndex += 1) {
                if (this.matchesScope(this.docs[docIndex], options.scope)) {
                    scores.set(docIndex, 0);
                }
            }
        }

        const maxCandidateDocs = clampPositive(options.maxCandidateDocs, DEFAULT_MAX_CANDIDATES);
        return Array.from(scores.entries())
            .sort((left, right) => right[1] - left[1] || left[0] - right[0])
            .slice(0, maxCandidateDocs)
            .map(([docIndex]) => docIndex);
    }

    private matchesScope(doc: IndexedDoc, scope?: PhoenixLineSearchScope): boolean {
        if (!scope) {
            return true;
        }
        const source = doc.source;
        return (!scope.noteId || source.noteId === scope.noteId)
            && (!scope.worldId || source.worldId === scope.worldId)
            && (!scope.narrativeId || source.narrativeId === scope.narrativeId)
            && (!scope.folderId || source.folderId === scope.folderId || source.folderPath === scope.folderId)
            && (!scope.folderPath || source.folderPath === scope.folderPath || source.folderId === scope.folderPath);
    }

    private bm25(docIndex: number, token: string): number {
        const doc = this.docs[docIndex];
        const frequency = doc.termFreq.get(token) || 0;
        if (!frequency) {
            return 0;
        }
        const df = this.postings.get(token)?.size || 1;
        const idf = Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
        const k1 = 1.2;
        const b = 0.72;
        const normalized = frequency + k1 * (1 - b + b * (doc.length / this.avgDocLength));
        return idf * ((frequency * (k1 + 1)) / normalized);
    }

    private scoreLineHit(
        docIndex: number,
        line: string,
        matches: PhoenixLineSearchMatch[],
        plan: SearchPlan,
        title: boolean,
    ): number {
        const uniqueTerms = new Set(matches.map((match) => normalizeTerm(match.term))).size;
        let score = plan.tokens.reduce((sum, token) => sum + this.bm25(docIndex, token), 0);
        score += title ? 18 : 0;
        score += matches.length * 2.2;
        score += uniqueTerms * 1.7;
        score += matches.some((match) => match.term.includes(' ')) ? 5 : 0;
        score += Math.min(4, (matches.reduce((sum, match) => sum + (match.to - match.from), 0) / Math.max(1, line.length)) * 12);
        return Number(score.toFixed(6));
    }

    private createTitleHit(
        doc: IndexedDoc,
        matches: PhoenixLineSearchMatch[],
        plan: SearchPlan,
        options: PhoenixLineSearchOptions,
    ): PhoenixLineSearchHit {
        const docIndex = this.docs.indexOf(doc);
        const preview = doc.lines.find((line) => line.text.trim())?.text || doc.source.title;
        return {
            noteId: doc.source.noteId,
            title: doc.source.title,
            worldId: doc.source.worldId,
            narrativeId: doc.source.narrativeId,
            folderId: doc.source.folderId,
            folderPath: doc.source.folderPath,
            lineNumber: 0,
            lineStart: 0,
            lineEnd: preview.length,
            lineText: preview,
            matches,
            before: [],
            after: collectContext(doc.lines, 0, clampPositive(options.after, 0)),
            score: this.scoreLineHit(docIndex, doc.source.title, matches, plan, true),
            generation: this.generation,
        };
    }
}

function buildSearchPlan(query: string, options: PhoenixLineSearchOptions): SearchPlan {
    const trimmed = query.trim();
    const regex = parseRegexQuery(trimmed, options);
    if (regex) {
        return { mode: 'regex', terms: [], tokens: [], regex };
    }
    const terms = parseLiteralTerms(trimmed);
    return {
        mode: options.mode === 'literal' ? 'literal' : 'auto',
        terms,
        tokens: unique(terms.flatMap(tokenize)),
    };
}

function parseRegexQuery(query: string, options: PhoenixLineSearchOptions): RegExp | undefined {
    if (options.mode !== 'regex' && !(query.startsWith('/') && query.lastIndexOf('/') > 0)) {
        return undefined;
    }
    try {
        const body = query.startsWith('/') ? query.slice(1, query.lastIndexOf('/')) : query;
        const flags = query.startsWith('/') ? query.slice(query.lastIndexOf('/') + 1) : '';
        const safeFlags = flags.includes('g') ? flags : `${flags}g`;
        return new RegExp(body, options.caseSensitive ? safeFlags : addFlag(safeFlags, 'i'));
    } catch {
        return undefined;
    }
}

function parseLiteralTerms(query: string): string[] {
    const terms: string[] = [];
    const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(query)) !== null) {
        const term = String(match[1] || match[2] || match[3] || '').trim();
        if (term) {
            terms.push(term);
        }
    }
    return unique(terms);
}

function matchRegex(text: string, regex: RegExp, maxMatches: number): PhoenixLineSearchMatch[] {
    const matches: PhoenixLineSearchMatch[] = [];
    const working = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = working.exec(text)) !== null && matches.length < maxMatches) {
        const value = match[0] || '';
        if (!value) {
            working.lastIndex += 1;
            continue;
        }
        matches.push({
            from: match.index,
            to: match.index + value.length,
            text: value,
            term: regex.source,
        });
    }
    return selectNonOverlapping(matches);
}

function addTokenWeights(termFreq: Map<string, number>, text: string, weight: number): void {
    for (const token of tokenize(text)) {
        termFreq.set(token, (termFreq.get(token) || 0) + weight);
    }
}

function tokenize(text: string): string[] {
    const tokens: string[] = [];
    for (const match of text.matchAll(TOKEN_RE)) {
        tokens.push(normalizeTerm(match[0]));
    }
    return tokens;
}

function normalizeTerm(term: string): string {
    return term.toLocaleLowerCase();
}

function splitLines(text: string): IndexedLine[] {
    const lines: IndexedLine[] = [];
    let start = 0;
    let number = 1;
    for (let index = 0; index <= text.length; index += 1) {
        if (index !== text.length && text[index] !== '\n') {
            continue;
        }
        const rawEnd = index;
        const end = rawEnd > start && text[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
        lines.push({ number, start, end, text: text.slice(start, end) });
        start = index + 1;
        number += 1;
    }
    return lines;
}

function collectContext(lines: IndexedLine[], from: number, to: number): string[] {
    return lines.slice(Math.max(0, from), Math.max(0, to)).map((line) => line.text);
}

function termsToPatterns(terms: string[]): PhoenixLiteralPattern[] {
    return terms.map((text) => ({ text }));
}

function selectNonOverlapping<T>(matches: Array<PhoenixLineSearchMatch<T>>): Array<PhoenixLineSearchMatch<T>> {
    const selected: Array<PhoenixLineSearchMatch<T>> = [];
    const sorted = [...matches].sort((left, right) => left.from - right.from || (right.to - right.from) - (left.to - left.from));
    for (const match of sorted) {
        if (selected.some((existing) => existing.from < match.to && match.from < existing.to)) {
            continue;
        }
        selected.push(match);
    }
    return selected;
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function addFlag(flags: string, flag: string): string {
    return flags.includes(flag) ? flags : `${flags}${flag}`;
}

function clampPositive(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value !== undefined && value >= 0 ? Math.floor(value) : fallback;
}
