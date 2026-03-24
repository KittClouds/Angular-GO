/**
 * PrettyTextAPI — Thin facade between the Editor and the Scan Pipeline.
 *
 * Responsibilities (after refactor):
 *   1. ProseMirror doc ↔ text conversion (via ProseMirrorBridge)
 *   2. Delegating to ScanPipeline.run() for all scanning
 *   3. Span caching (Dexie read/write)
 *   4. Style/config/subscribe (UI concerns)
 *
 * Everything else has been extracted into focused modules:
 *   - HighlightScanner  (implicit entity spans)
 *   - DiscoveryScanner  (unsupervised NER + filter)
 *   - GraphScanner      (relationship extraction)
 *   - ScanPipeline      (sequential orchestrator)
 */

import type { DecorationSpan, HighlighterConfig, HighlightMode, AnalyticsHighlightKind } from '../lib/Scanner';
import { getDecorationStyle, getDecorationClass } from '../lib/Scanner';
import type { EntityKind } from '../lib/Scanner/types';
import { getScanCoordinator } from '../lib/Scanner/scanCoordinatorInstance';
import { realignSpans } from '../lib/Scanner/anchor-utils';

// Modular Scanner Pipeline
import {
    type ProseMirrorDoc,
    extractText,
    docContent,
    remapSpans,
    remapSpansPermissive,
} from '../lib/Scanner/prosemirror-bridge';
import { createKeywordFocusSpans } from '../lib/Scanner/keyword-focus';
import { HighlightScanner } from '../lib/Scanner/highlight-scanner';
import { DiscoveryScanner } from '../lib/Scanner/discovery-scanner';
import { GraphScanner } from '../lib/Scanner/graph-scanner';
import { ScanPipeline } from '../lib/Scanner/scan-pipeline';

import { highlightingStore } from '../lib/store/highlightingStore';
import { analyticsHighlightStore } from '../lib/store/analyticsHighlightStore';
import { keywordHighlightStore } from '../lib/store/keywordHighlightStore';
import { searchHighlightStore } from '../lib/store/searchHighlightStore';
import { PhoenixUiApiService } from '../services/phoenix-ui-api.service';
import {
    getNoteDecorations,
    saveNoteDecorations,
    getDecorationContentHash,
    hashContent
} from '../lib/dexie/decorations';
import { smartGraphRegistry } from '../lib/registry';
import { DiscoveryStore } from '../lib/store/discoveryStore';
import type { AnalyticsHighlightRange } from '../lib/analytics';
import { filterCachedEntitySpans } from './pretty-text-cache';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level wiring (legacy bridge — to be replaced with DI over time)
// ─────────────────────────────────────────────────────────────────────────────

let discoveryStore: DiscoveryStore | null = null;
let phoenixUiApi: PhoenixUiApiService | null = null;
let scanPipeline: ScanPipeline | null = null;

export function setDiscoveryStore(store: DiscoveryStore) {
    discoveryStore = store;
}

export function setPhoenixUiApi(service: PhoenixUiApiService) {
    phoenixUiApi = service;

    // Build the pipeline when GoKitt becomes available
    scanPipeline = new ScanPipeline(
        new HighlightScanner(service),
        new DiscoveryScanner(service, {
            isRegisteredEntity: (token) => smartGraphRegistry.isRegisteredEntity(token),
        }),
        new GraphScanner(service, {
            upsertRelationship: (rel) => smartGraphRegistry.upsertRelationship(rel),
        }),
    );
    console.log('[PrettyTextAPI] ScanPipeline initialized');
}

export function getPhoenixUiApi(): PhoenixUiApiService | null {
    return phoenixUiApi;
}

export const setGoKittService = setPhoenixUiApi;
export const getGoKittService = getPhoenixUiApi;

// ─────────────────────────────────────────────────────────────────────────────
// Interface (unchanged — backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

export { ProseMirrorDoc };

export interface PrettyTextApi {
    getDecorations(doc: ProseMirrorDoc): DecorationSpan[];
    scanForSpansAsync(doc: ProseMirrorDoc): Promise<DecorationSpan[]>;
    getStyle(span: DecorationSpan): string;
    getClass(span: DecorationSpan): string;
    getMode(): HighlightMode;
    setMode(mode: HighlightMode): void;
    getConfig(): HighlighterConfig;
    setConfig(config: Partial<HighlighterConfig>): void;
    subscribe(callback: () => void): () => void;
    setNoteId(noteId: string, narrativeId?: string): void;
    setKeywordHighlights(noteId: string, keywords: string[]): void;
    toggleKeywordHighlight(noteId: string, keyword: string): void;
    clearKeywordHighlights(noteId: string): void;
    setSearchHighlightTerms(terms: string[]): void;
    clearSearchHighlights(): void;
    setAnalyticsHighlights(noteId: string, key: string, kind: AnalyticsHighlightKind, label: string, ranges: AnalyticsHighlightRange[]): void;
    toggleAnalyticsHighlights(noteId: string, key: string, kind: AnalyticsHighlightKind, label: string, ranges: AnalyticsHighlightRange[]): void;
    clearAnalyticsHighlights(): void;
    onKeystroke(char: string, cursorPos: number, contextText: string): void;
    forceRescan(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation (thin facade)
// ─────────────────────────────────────────────────────────────────────────────

class PrettyTextAPI implements PrettyTextApi {
    private enableEntityRefs = true;
    private implicitDecorations: DecorationSpan[] = [];
    private implicitDecorationsDocSize = 0;
    private lastContext: string = '';
    private lastScannedContext: string = '';
    private listeners: Set<() => void> = new Set();
    private scanVersion = 0;
    private currentNoteId: string = '';
    private currentNarrativeId?: string;
    private hasScannedOnOpen = false;
    private lastKnownEntityCount = 0;
    private lastSentenceEndPos = 0;
    private pendingRescan = false;
    private lastDoc: ProseMirrorDoc | null = null;
    private selectedKeywords: string[] = [];
    private searchHighlightTerms: string[] = [];
    private analyticsHighlightSpans: DecorationSpan[] = [];

    constructor() {
        this.searchHighlightTerms = searchHighlightStore.getTerms();

        if (typeof window !== 'undefined') {
            window.addEventListener('gokitt-ready', () => {
                console.log('[PrettyTextAPI] GoKitt ready — triggering rescan');
                this.pendingRescan = true;
                this.notifyListeners();
            });

            window.addEventListener('fst-toggle', ((e: CustomEvent) => {
                const enabled = e.detail?.enabled;
                if (!enabled) {
                    this.implicitDecorations = this.implicitDecorations.filter(
                        d => d.type !== 'entity_candidate'
                    );
                    this.notifyListeners();
                } else {
                    this.pendingRescan = true;
                    this.notifyListeners();
                }
            }) as EventListener);
        }

        highlightingStore.subscribe(() => this.notifyListeners());
        keywordHighlightStore.subscribe(() => {
            const nextKeywords = keywordHighlightStore.getKeywordsForNote(this.currentNoteId);
            if (JSON.stringify(nextKeywords) !== JSON.stringify(this.selectedKeywords)) {
                this.selectedKeywords = nextKeywords;
                this.notifyListeners();
            }
        });
        searchHighlightStore.subscribe(() => {
            const nextTerms = searchHighlightStore.getTerms();
            if (JSON.stringify(nextTerms) !== JSON.stringify(this.searchHighlightTerms)) {
                this.searchHighlightTerms = nextTerms;
                this.notifyListeners();
            }
        });
        analyticsHighlightStore.subscribe(() => {
            this.notifyListeners();
        });
    }

    // ── Note Context ──────────────────────────────────────────────────────

    setNoteId(noteId: string, narrativeId?: string): void {
        const prevNoteId = this.currentNoteId;
        this.currentNoteId = noteId;
        this.currentNarrativeId = narrativeId;

        if (noteId && noteId !== prevNoteId) {
            this.hasScannedOnOpen = false;
            this.lastKnownEntityCount = 0;
            this.lastSentenceEndPos = 0;
            this.lastContext = '';
            this.lastScannedContext = '';
            analyticsHighlightStore.clearForNote(prevNoteId);
        }

        this.selectedKeywords = keywordHighlightStore.getKeywordsForNote(noteId);
        this.notifyListeners();
    }

    setKeywordHighlights(noteId: string, keywords: string[]): void {
        keywordHighlightStore.setKeywordsForNote(noteId, keywords);
    }

    toggleKeywordHighlight(noteId: string, keyword: string): void {
        keywordHighlightStore.toggleKeyword(noteId, keyword);
    }

    clearKeywordHighlights(noteId: string): void {
        keywordHighlightStore.clearKeywordsForNote(noteId);
    }

    setSearchHighlightTerms(terms: string[]): void {
        searchHighlightStore.setTerms(terms);
    }

    clearSearchHighlights(): void {
        searchHighlightStore.clear();
    }

    setAnalyticsHighlights(noteId: string, key: string, kind: AnalyticsHighlightKind, label: string, ranges: AnalyticsHighlightRange[]): void {
        analyticsHighlightStore.setSelection({ noteId, key, kind, label, ranges });
    }

    toggleAnalyticsHighlights(noteId: string, key: string, kind: AnalyticsHighlightKind, label: string, ranges: AnalyticsHighlightRange[]): void {
        analyticsHighlightStore.toggleSelection({ noteId, key, kind, label, ranges });
    }

    clearAnalyticsHighlights(): void {
        analyticsHighlightStore.clear();
    }

    onKeystroke(char: string, cursorPos: number, contextText: string): void {
        if (!this.currentNoteId) return;
        getScanCoordinator().onKeystroke(char, cursorPos, contextText, this.currentNoteId);
    }

    forceRescan(): void {
        if (!this.lastDoc || !this.currentNoteId) return;
        this.hasScannedOnOpen = false;
        this.lastScannedContext = '';
        const text = docContent(this.lastDoc);
        this.lastContext = text;
        this.hasScannedOnOpen = true;
        this.lastScannedContext = text;
        this.triggerPipelineScan(this.lastDoc, text);
    }

    // ── Decorations ───────────────────────────────────────────────────────

    getDecorations(doc: ProseMirrorDoc): DecorationSpan[] {
        this.lastDoc = doc;
        const settings = highlightingStore.getSettings();
        const { segments } = extractText(doc);
        const focusTerms = [...new Set([...this.selectedKeywords, ...this.searchHighlightTerms])];
        const keywordSpans = createKeywordFocusSpans(segments, focusTerms);
        const analyticsSpans = this.getAnalyticsHighlightSpans(segments);

        if (settings.mode === 'off') return [...keywordSpans, ...analyticsSpans];

        const text = docContent(doc);

        // Handle pending rescan (triggered when WASM becomes ready)
        if (this.pendingRescan) {
            this.pendingRescan = false;
            this.lastScannedContext = '';
            this.tryLoadCachedOrScan(doc, text);
        }

        if (text !== this.lastContext) {
            const prevText = this.lastContext;
            this.lastContext = text;

            if (!this.hasScannedOnOpen) {
                this.hasScannedOnOpen = true;
                this.lastScannedContext = text;
                this.tryLoadCachedOrScan(doc, text);
            } else {
                const lastChar = text.slice(-1);
                const isWordBoundary = /[\s.,!?;:\-\n\r]/.test(lastChar);
                const isDelete = text.length < prevText.length;
                const isPaste = Math.abs(text.length - prevText.length) > 3;

                if (isWordBoundary || isDelete || isPaste) {
                    this.lastScannedContext = text;
                    this.tryLoadCachedOrScan(doc, text);
                }
            }
        }

        // Build output spans
        const allSpans: DecorationSpan[] = [];
        const currentTextLength = text.length;
        const implicitsAreValid = this.implicitDecorationsDocSize === currentTextLength;

        if (implicitsAreValid) {
            for (const implicit of this.implicitDecorations) {
                const overlaps = allSpans.some(explicit =>
                    (implicit.from >= explicit.from && implicit.from < explicit.to) ||
                    (implicit.to > explicit.from && implicit.to <= explicit.to) ||
                    (implicit.from <= explicit.from && implicit.to >= explicit.to)
                );
                if (!overlaps) {
                    allSpans.push(implicit);
                }
            }
        }

        allSpans.sort((a, b) => a.from - b.from);

        const filteredSpans = allSpans.filter(span => {
            // @ts-ignore
            if (span.type === 'entity_ref' && !this.enableEntityRefs) return false;
            // @ts-ignore
            if (settings.mode === 'focus' && span.type === 'entity' && span.kind) {
                // @ts-ignore
                return settings.focusEntityKinds.includes(span.kind as EntityKind);
            }
            return true;
        });

        const combinedSpans = [...filteredSpans, ...keywordSpans, ...analyticsSpans];
        combinedSpans.sort((a, b) => a.from - b.from);

        // Emit to ScanCoordinator for entity-event tracking
        if (this.currentNoteId) {
            const entitySpans = combinedSpans.filter(s =>
                s.type === 'entity' ||
                s.type === 'entity_ref' ||
                s.type === 'relationship' ||
                s.type === 'predicate'
            );
            for (const span of entitySpans) {
                getScanCoordinator().onEntityDecoration(span, this.currentNoteId);
            }
        }

        return combinedSpans;
    }

    /** Async scan that waits for GoKitt to return spans (used on note open) */
    async scanForSpansAsync(doc: ProseMirrorDoc): Promise<DecorationSpan[]> {
        if (!scanPipeline) return [];

        const { text, segments } = extractText(doc);
        if (segments.length === 0) return [];

        console.log(`[PrettyTextAPI] scanForSpansAsync: ${text.length} chars, ${segments.length} segments`);

        const { highlights } = await scanPipeline.run(text, {
            skipDiscovery: true,
            skipGraph: true,
        });

        const { spans, dropped, crossed } = remapSpansPermissive(highlights, segments);
        console.log(`[PrettyTextAPI] Mapped ${spans.length} spans. Dropped: ${dropped}, Crossed: ${crossed}.`);

        return spans;
    }

    // ── Style / Config ────────────────────────────────────────────────────

    getStyle(span: DecorationSpan): string {
        const mode = highlightingStore.getMode();
        return getDecorationStyle(span, mode);
    }

    getClass(span: DecorationSpan): string {
        return getDecorationClass(span);
    }

    getMode(): HighlightMode {
        return highlightingStore.getMode();
    }

    setMode(mode: HighlightMode): void {
        highlightingStore.setMode(mode);
    }

    getConfig(): HighlighterConfig {
        const settings = highlightingStore.getSettings();
        return {
            mode: settings.mode,
            focusKinds: settings.focusEntityKinds.length > 0 ? settings.focusEntityKinds : undefined,
            enableWikilinks: true, // Always on in Highlighter C
            enableEntityRefs: this.enableEntityRefs,
        };
    }

    setConfig(config: Partial<HighlighterConfig>): void {
        if (config.mode) highlightingStore.setMode(config.mode);
        if (config.enableEntityRefs !== undefined) {
            this.enableEntityRefs = config.enableEntityRefs;
            this.notifyListeners();
        }
    }

    subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    // ── Internal Pipeline Integration ─────────────────────────────────────

    private async tryLoadCachedOrScan(doc: ProseMirrorDoc, text: string): Promise<void> {
        if (!this.currentNoteId) {
            this.triggerPipelineScan(doc, text);
            return;
        }

        try {
            const cached = await getNoteDecorations(this.currentNoteId);
            if (cached && cached.length > 0) {
                const storedHash = await getDecorationContentHash(this.currentNoteId);
                const currentHash = hashContent(text);
                const filteredCached = filterCachedEntitySpans(cached, smartGraphRegistry);

                if (filteredCached.length !== cached.length) {
                    await saveNoteDecorations(this.currentNoteId, filteredCached, storedHash ?? currentHash);
                }

                if (storedHash === currentHash) {
                    if (filteredCached.length > 0) {
                        this.implicitDecorations = filteredCached;
                        this.implicitDecorationsDocSize = text.length;
                        this.notifyListeners();
                        return;
                    }
                } else {
                    const realigned = realignSpans(filteredCached, text);
                    const filteredRealigned = filterCachedEntitySpans(realigned, smartGraphRegistry);
                    if (filteredRealigned.length > 0) {
                        if (filteredRealigned.length !== realigned.length) {
                            await saveNoteDecorations(this.currentNoteId, filteredRealigned, currentHash);
                        }
                        this.implicitDecorations = filteredRealigned;
                        this.implicitDecorationsDocSize = text.length;
                        this.notifyListeners();
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('[PrettyTextAPI] Dexie read failed:', err);
        }

        this.triggerPipelineScan(doc, text);
    }

    private getAnalyticsHighlightSpans(segments: ReturnType<typeof extractText>['segments']): DecorationSpan[] {
        const selection = analyticsHighlightStore.getSelection();
        if (!selection || selection.noteId !== this.currentNoteId || selection.ranges.length === 0) {
            this.analyticsHighlightSpans = [];
            return [];
        }

        const rawSpans = selection.ranges
            .filter(range => range.to > range.from)
            .map((range, index) => ({
                type: 'analytics_highlight' as const,
                from: range.from,
                to: range.to,
                label: selection.label,
                matchedText: range.text,
                highlightKind: selection.kind,
                annotationId: `${selection.key}:${index}`,
            }));

        this.analyticsHighlightSpans = remapSpans(rawSpans, segments);
        return this.analyticsHighlightSpans;
    }

    private triggerPipelineScan(doc: ProseMirrorDoc, text?: string) {
        if (!scanPipeline) return;

        const myVersion = ++this.scanVersion;
        const { text: fullText, segments } = extractText(doc);
        const scanText = text || fullText;

        if (segments.length === 0) {
            this.implicitDecorations = [];
            this.implicitDecorationsDocSize = 0;
            this.notifyListeners();
            return;
        }

        const noteIdForSave = this.currentNoteId;
        const contentHashForSave = hashContent(scanText);

        // Determine if we should run the full pipeline or highlight-only
        const entityCount = this.implicitDecorations.filter(d => d.type === 'entity_implicit').length;
        const sentenceEnded = this.detectSentenceEnd(scanText);
        const hadNewEntities = entityCount > this.lastKnownEntityCount;

        const shouldRunFull = entityCount > 0 && sentenceEnded && hadNewEntities;

        // Run pipeline
        // Discovery is manual-only via NerService/NER panel. Implicit rescans should
        // refresh highlights (and graph when eligible) without running unsupervised NER.
        const pipelinePromise = scanPipeline.run(scanText, {
            skipDiscovery: true,
            skipGraph: !shouldRunFull,
            noteId: this.currentNoteId || undefined,
            provenance: this.currentNoteId ? {
                worldId: this.currentNoteId,
                vaultId: this.currentNarrativeId,
                parentPath: '',
            } : undefined,
        });

        pipelinePromise.then(async (result) => {
            if (this.scanVersion !== myVersion) return;

            // Remap highlight spans to ProseMirror coordinates
            const mergedSpans = remapSpans(result.highlights, segments);

            const changed = !this.spansEqual(this.implicitDecorations, mergedSpans);
            this.implicitDecorations = mergedSpans;
            this.implicitDecorationsDocSize = scanText.length;
            if (changed) this.notifyListeners();

            const newEntityCount = mergedSpans.filter(d => d.type === 'entity_implicit').length;
            this.lastKnownEntityCount = newEntityCount;

            // Push discovery candidates to store
            if (result.discovery && result.discovery.candidates.length > 0) {
                discoveryStore?.addCandidates(result.discovery.candidates);

                // Create candidate spans for discovered tokens
                const candidateSpans = this.createCandidateSpans(scanText, result.discovery.candidates, segments);
                if (candidateSpans.length > 0) {
                    this.implicitDecorations = [
                        ...this.implicitDecorations.filter(d => d.type !== 'entity_candidate'),
                        ...candidateSpans,
                    ];
                    this.notifyListeners();
                }
            }

            // Save to Dexie cache
            if (noteIdForSave) {
                try {
                    await saveNoteDecorations(noteIdForSave, mergedSpans, contentHashForSave);
                } catch (err) {
                    console.warn('[PrettyTextAPI] Dexie write failed:', err);
                }
            }
        }).catch(console.error);
    }

    // ── Utilities ──────────────────────────────────────────────────────────

    private createCandidateSpans(
        _text: string,
        candidates: Array<{ token: string; score: number }>,
        segments: Array<{ pmPos: number; concatStart: number; length: number; text: string }>,
    ): DecorationSpan[] {
        const spans: DecorationSpan[] = [];

        for (const seg of segments) {
            for (const candidate of candidates) {
                const tokenLower = candidate.token.toLowerCase();
                const regex = new RegExp(`\\b${this.escapeRegex(tokenLower)}\\b`, 'gi');
                let match: RegExpExecArray | null;

                while ((match = regex.exec(seg.text)) !== null) {
                    const from = seg.pmPos + match.index;
                    const to = seg.pmPos + match.index + match[0].length;

                    if (smartGraphRegistry.isRegisteredEntity(candidate.token)) continue;

                    const alreadyCovered = this.implicitDecorations.some(d =>
                        d.type === 'entity_implicit' && d.from <= from && d.to >= to
                    );

                    if (!alreadyCovered) {
                        spans.push({
                            type: 'entity_candidate',
                            from,
                            to,
                            label: candidate.token,
                            matchedText: String(candidate.score.toFixed(2)),
                            kind: 'UNKNOWN',
                            resolved: false,
                        });
                    }
                }
            }
        }

        return spans;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private spansEqual(a: DecorationSpan[], b: DecorationSpan[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i].from !== b[i].from || a[i].to !== b[i].to || a[i].label !== b[i].label) {
                return false;
            }
        }
        return true;
    }

    private detectSentenceEnd(text: string): boolean {
        const pos = text.length - 1;
        if (pos <= this.lastSentenceEndPos) return false;

        for (let i = pos; i >= Math.max(0, pos - 5); i--) {
            const char = text[i];
            if (char === '.' || char === '!' || char === '?') {
                this.lastSentenceEndPos = pos;
                return true;
            }
        }
        return false;
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton management (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

let _instance: PrettyTextApi | null = null;

export function getPrettyTextApi(): PrettyTextApi {
    if (!_instance) {
        _instance = new PrettyTextAPI();
    }
    return _instance;
}

export const getHighlighterApi = getPrettyTextApi;

export function setPrettyTextApi(api: PrettyTextApi): void {
    _instance = api;
}

export const setHighlighterApi = setPrettyTextApi;
