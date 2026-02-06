// Highlighter API - interface between Scanner and Editor
// Connected to GoKitt Wasm Service
// Wired to ScanCoordinator for entity event emission

import type { DecorationSpan, HighlighterConfig, HighlightMode } from '../lib/Scanner';
import { scanDocument, getDecorationStyle, getDecorationClass } from '../lib/Scanner';
import { scanForPatternsSync } from '../lib/Scanner/pattern-scanner';
import type { EntityKind } from '../lib/Scanner/types';
import { getScanCoordinator } from '../lib/Scanner/scanCoordinatorInstance';
import { createSelector, realignSpans } from '../lib/Scanner/anchor-utils';

// Real imports
import { highlightingStore } from '../lib/store/highlightingStore';
import { GoKittService } from '../services/gokitt.service';
import { getAppOrchestrator } from '../lib/core/app-orchestrator';

import {
    getNoteDecorations,
    saveNoteDecorations,
    getDecorationContentHash,
    hashContent
} from '../lib/dexie/decorations';

import { smartGraphRegistry } from '../lib/registry';
import { discoveryStore } from '../lib/store/discoveryStore';
import { isFstEnabled } from '../services/ner.service';

let goKittService: GoKittService | null = null;

// Helper to set service (called from App Init or Component)
export function setGoKittService(service: GoKittService) {
    goKittService = service;
}

// Getter for non-DI contexts (e.g. operations.ts)
export function getGoKittService(): GoKittService | null {
    return goKittService;
}

// Mock for DiscoveryStore (still needed until fully Angularized)
const useDiscoveryStore = {
    getState: () => ({
        addCandidates: (_c: any[]) => { }
    })
};

// ... existing interfaces ...

export interface HighlighterApi {
    /** Get decoration spans for a ProseMirror document */
    getDecorations(doc: ProseMirrorDoc): DecorationSpan[];

    /** Get inline CSS style for a decoration span */
    getStyle(span: DecorationSpan): string;

    /** Get CSS class for a decoration span */
    getClass(span: DecorationSpan): string;

    /** Get current highlight mode */
    getMode(): HighlightMode;

    /** Set highlight mode (updates both API and store) */
    setMode(mode: HighlightMode): void;

    /** Get full configuration */
    getConfig(): HighlighterConfig;

    /** Update configuration */
    setConfig(config: Partial<HighlighterConfig>): void;

    /** Subscribe to settings changes for editor refresh */
    subscribe(callback: () => void): () => void;

    /** Set current note ID for scan coordinator integration */
    setNoteId(noteId: string, narrativeId?: string): void;

    /** Handle keystroke for scan coordinator punctuation trigger */
    onKeystroke(char: string, cursorPos: number, contextText: string): void;
}

export interface ProseMirrorDoc {
    descendants: (callback: (node: { isText?: boolean; text?: string }, pos: number) => void) => void;
}

function docContent(doc: ProseMirrorDoc): string {
    let text = '';
    doc.descendants((node) => {
        if (node.isText && node.text) {
            text += node.text;
        }
    });
    return text;
}

class DefaultHighlighterApi implements HighlighterApi {
    private enableWikilinks = true;
    private enableEntityRefs = true;
    private implicitDecorations: DecorationSpan[] = [];
    private lastContext: string = '';
    private lastScannedContext: string = '';
    private listeners: Set<() => void> = new Set();
    private isScanning = false;
    private scanVersion = 0;
    private currentNoteId: string = '';
    private currentNarrativeId?: string;
    // @ts-ignore
    private prewarmCache: Map<string, DecorationSpan[] | null> = new Map();

    private hasScannedOnOpen = false;
    private lastKnownEntityCount = 0;
    private lastNodeBatch: Array<{ text: string; pos: number }> = [];
    private lastSentenceEndPos = 0;
    private pendingRescan = false;

    constructor() {
        // Listen for WASM ready event to trigger rescan
        if (typeof window !== 'undefined') {
            window.addEventListener('gokitt-ready', () => {
                console.log('[HighlighterApi] GoKitt ready - triggering rescan');
                this.pendingRescan = true;
                this.notifyListeners();
            });

            // Listen for FST toggle to clear/show candidate spans
            window.addEventListener('fst-toggle', ((e: CustomEvent) => {
                const enabled = e.detail?.enabled;
                console.log('[HighlighterApi] FST toggle:', enabled);
                if (!enabled) {
                    // Clear discovery candidate spans when FST is disabled
                    this.implicitDecorations = this.implicitDecorations.filter(
                        d => d.type !== 'entity_candidate'
                    );
                    this.notifyListeners();
                } else {
                    // Trigger rescan when enabled
                    this.pendingRescan = true;
                    this.notifyListeners();
                }
            }) as EventListener);
        }

        // Subscribe to store changes
        highlightingStore.subscribe(() => this.notifyListeners());
    }


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
            this.prewarmCacheForNote(noteId);
        }
    }

    private async prewarmCacheForNote(noteId: string): Promise<void> {
    }

    onKeystroke(char: string, cursorPos: number, contextText: string): void {
        if (!this.currentNoteId) return;
        getScanCoordinator().onKeystroke(char, cursorPos, contextText, this.currentNoteId);
    }

    private lastDoc: ProseMirrorDoc | null = null;



    forceRescan(): void {
        if (!this.lastDoc || !this.currentNoteId) {
            return;
        }
        this.hasScannedOnOpen = false;
        this.lastScannedContext = '';
        const text = docContent(this.lastDoc);
        this.lastContext = text;
        this.hasScannedOnOpen = true;
        this.lastScannedContext = text;
        this.triggerImplicitScan(this.lastDoc, text);
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb());
    }

    getDecorations(doc: ProseMirrorDoc): DecorationSpan[] {
        this.lastDoc = doc;
        const settings = highlightingStore.getSettings();

        if (settings.mode === 'off') {
            return [];
        }

        const spans = scanDocument(doc);
        const text = docContent(doc);

        // Handle pending rescan (triggered when WASM becomes ready)
        if (this.pendingRescan) {
            this.pendingRescan = false;
            this.lastScannedContext = '';  // Force rescan
            this.tryLoadCachedOrScan(doc, text);
        }

        if (text !== this.lastContext) {
            this.lastContext = text;

            if (!this.hasScannedOnOpen) {
                this.hasScannedOnOpen = true;
                this.lastScannedContext = text;
                this.tryLoadCachedOrScan(doc, text);
            } else {
                const currentEntityCount = this.implicitDecorations.filter(d =>
                    d.type === 'entity_implicit'
                ).length;

                const prevLength = this.lastScannedContext.length;
                const shouldCheck = this.shouldCheckForNewEntities(text, prevLength);

                if (currentEntityCount === 0 || shouldCheck) {
                    this.lastScannedContext = text;
                    this.tryLoadCachedOrScan(doc, text);
                }
            }
        }

        const allSpans = [...spans];
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

        allSpans.sort((a, b) => a.from - b.from);

        const filteredSpans = allSpans.filter(span => {
            if (span.type === 'wikilink' && !settings.showWikilinks) return false;
            // @ts-ignore
            if (span.type === 'entity_ref' && !this.enableEntityRefs) return false;
            // @ts-ignore
            if (settings.mode === 'focus' && span.type === 'entity' && span.kind) {
                // @ts-ignore
                return settings.focusEntityKinds.includes(span.kind as EntityKind);
            }
            return true;
        });

        if (this.currentNoteId) {
            const entitySpans = filteredSpans.filter(s =>
                s.type === 'entity' ||
                s.type === 'entity_ref' ||
                s.type === 'relationship' ||
                s.type === 'predicate'
            );
            for (const span of entitySpans) {
                getScanCoordinator().onEntityDecoration(span, this.currentNoteId);
            }
        }

        return filteredSpans;
    }

    private shouldCheckForNewEntities(currentText: string, prevLength: number): boolean {
        const currLength = currentText.length;
        return Math.abs(currLength - prevLength) >= 3;
    }

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
            enableWikilinks: settings.showWikilinks,
            enableEntityRefs: this.enableEntityRefs,
        };
    }

    setConfig(config: Partial<HighlighterConfig>): void {
        if (config.mode) {
            highlightingStore.setMode(config.mode);
        }
        if (config.enableWikilinks !== undefined) {
            highlightingStore.setSettings({ showWikilinks: config.enableWikilinks });
        }
        if (config.focusKinds !== undefined) {
            highlightingStore.setSettings({ focusEntityKinds: config.focusKinds as EntityKind[] });
        }
        if (config.enableEntityRefs !== undefined) {
            this.enableEntityRefs = config.enableEntityRefs;
            this.notifyListeners();
        }
    }

    subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private async tryLoadCachedOrScan(doc: ProseMirrorDoc, text: string): Promise<void> {
        if (!this.currentNoteId) {
            this.triggerImplicitScan(doc, text);
            return;
        }

        try {
            const cached = await getNoteDecorations(this.currentNoteId);
            if (cached && cached.length > 0) {
                const storedHash = await getDecorationContentHash(this.currentNoteId);
                const currentHash = hashContent(text);

                if (storedHash === currentHash) {
                    this.implicitDecorations = cached;
                    this.notifyListeners();
                    return;
                } else {
                    // Content changed (hash mismatch) - Try to recover spans via Anchors ("Resolution Ladder")
                    // This provides "graceful degradation" and instant UI while the fresh scan runs.
                    // console.log('[HighlighterApi] Content diff detected, realigning spans...');
                    const realigned = realignSpans(cached, text);
                    if (realigned.length > 0) {
                        this.implicitDecorations = realigned;
                        this.notifyListeners(); // Show realigned spans immediately
                    }
                }
            }
        } catch (err) {
            console.warn('[HighlighterApi] Dexie read failed:', err);
        }

        // Always trigger fresh scan if hash mismatch (or cache miss) to get ground truth
        this.triggerImplicitScan(doc, text);
    }

    private triggerImplicitScan(doc: ProseMirrorDoc, text?: string, _entityVersion?: number) {
        // ... existing setup ...
        const myVersion = ++this.scanVersion;
        const batch: { id: number, text: string }[] = [];
        const nodePositions = new Map<number, number>();

        let fullText = '';
        let batchIdCounter = 0;
        const nodeBatchForDiscovery: Array<{ text: string; pos: number }> = [];
        doc.descendants((node, pos) => {
            if (node.isText && node.text) {
                const id = batchIdCounter++;
                batch.push({ id, text: node.text });
                nodePositions.set(id, pos);
                nodeBatchForDiscovery.push({ text: node.text, pos });
                fullText += node.text;
            }
        });

        this.lastNodeBatch = nodeBatchForDiscovery;

        if (batch.length === 0) {
            this.implicitDecorations = [];
            this.notifyListeners();
            return;
        }

        const noteIdForSave = this.currentNoteId;
        const contentHashForSave = hashContent(fullText);

        const scanPromises = batch.map(async (item) => {
            try {
                // Use Aho-Corasick implicit scanner from GoKitt if available (async via worker)
                let implicitSpans = await goKittService?.scanImplicitAsync(item.text) ?? [];

                // Also run regex scanner for explicit patterns
                const explicitSpans = scanForPatternsSync(item.text);

                // Merge: explicit spans take priority, no duplicates
                const mergedSpans = [...explicitSpans];
                for (const implicit of implicitSpans) {
                    const overlaps = mergedSpans.some(explicit =>
                        (implicit.from >= explicit.from && implicit.from < explicit.to) ||
                        (implicit.to > explicit.from && implicit.to <= explicit.to)
                    );
                    if (!overlaps) {
                        mergedSpans.push(implicit);
                    }
                }

                // Add Resilient Anchors (Selectors) to all new spans
                mergedSpans.forEach(span => {
                    if (!span.selector) {
                        span.selector = createSelector(item.text, span.from, span.to);
                    }
                });

                return { id: item.id, spans: mergedSpans };
            } catch (e) {
                console.error(`[HighlighterApi.scan] Error:`, e);
                return { id: item.id, spans: [] };
            }
        });



        Promise.all(scanPromises).then(async (results) => {
            if (this.scanVersion !== myVersion) {
                return;
            }

            const mergedSpans: DecorationSpan[] = [];

            for (const { id, spans } of results) {
                const nodeStart = nodePositions.get(id);
                if (nodeStart !== undefined) {
                    for (const span of spans) {
                        mergedSpans.push({
                            ...span,
                            from: nodeStart + span.from,
                            to: nodeStart + span.to
                        });
                    }
                }
            }

            this.implicitDecorations = mergedSpans;
            this.notifyListeners();

            const entityCount = mergedSpans.filter(d => d.type === 'entity_implicit').length;
            const hadNewEntities = entityCount > this.lastKnownEntityCount;
            this.lastKnownEntityCount = entityCount;

            const sentenceEnded = this.detectSentenceEnd(fullText);

            if (entityCount > 0 && sentenceEnded && hadNewEntities) {
                this.triggerRustScan(fullText, mergedSpans);
            }

            if (noteIdForSave) {
                try {
                    await saveNoteDecorations(noteIdForSave, mergedSpans, contentHashForSave);
                } catch (err) {
                    console.warn('[HighlighterApi] Dexie write failed:', err);
                }
            }

            this.triggerDiscoveryScan(fullText);
        });
    }

    private detectSentenceEnd(text: string): boolean {
        const trimmed = text.trimEnd();
        if (!trimmed) return false;
        const lastChar = trimmed[trimmed.length - 1];
        const isPunctuation = lastChar === '.' || lastChar === '!' || lastChar === '?';
        if (isPunctuation) {
            const pos = trimmed.length;
            if (pos > this.lastSentenceEndPos) {
                this.lastSentenceEndPos = pos;
                return true;
            }
        }
        return false;
    }



    /**
     * Trigger GoKitt Discovery Scan (Unsupervised NER)
     */
    private triggerDiscoveryScan(text: string): void {
        if (!goKittService) return;

        // Don't run discovery if FST toggle is disabled
        if (!isFstEnabled()) {
            console.log('[HighlighterApi] FST disabled, skipping discovery scan');
            return;
        }

        // Non-blocking async scan (worker-based)
        (async () => {
            try {
                const candidates = await goKittService!.scanDiscovery(text);

                if (candidates && candidates.length > 0) {
                    // HARD FILTER (Sync): Reject candidates that are already KNOWN entities in Registry
                    const unknownCandidates = candidates.filter((c: any) => {
                        // Status check: 0=Watching, 1=Promoted
                        if (c.status !== 0 && c.status !== 1) return false;

                        // CRITICAL: Check Registry (sync, authoritative source of truth)
                        const isKnown = smartGraphRegistry.isRegisteredEntity(c.token);
                        if (isKnown) {
                            console.log(`[Discovery:HardFilter] Rejected '${c.token}' - already in Registry`);
                            return false;
                        }
                        return true;
                    });

                    if (unknownCandidates.length > 0) {
                        console.log(`[Discovery:GoKitt] Found ${unknownCandidates.length} truly unknown candidates`);

                        // Emit to DiscoveryStore
                        discoveryStore.addCandidates(unknownCandidates);

                        // Create highlight spans for discovered tokens
                        const candidateSpans = this.createCandidateSpans(text, unknownCandidates);
                        if (candidateSpans.length > 0) {
                            console.log(`[Discovery:HighlightApi] Created ${candidateSpans.length} candidate spans`);
                            // Merge with existing implicitDecorations
                            this.implicitDecorations = [
                                ...this.implicitDecorations.filter(d => d.type !== 'entity_candidate'),
                                ...candidateSpans
                            ];
                            this.notifyListeners();
                        }
                    }
                }
            } catch (e) {
                console.error('[HighlighterApi] Discovery scan error:', e);
            }
        })();
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Create entity_candidate spans for discovered tokens
     * Uses per-node position info to properly align with ProseMirror positions
     */
    private createCandidateSpans(_text: string, candidates: Array<{ token: string; score: number }>): DecorationSpan[] {
        const spans: DecorationSpan[] = [];

        // Search for candidates within each node (with proper position offsets)
        for (const node of this.lastNodeBatch) {
            for (const candidate of candidates) {
                const tokenLower = candidate.token.toLowerCase();
                // Find all occurrences of this token (case-insensitive, word boundary)
                const regex = new RegExp(`\\b${this.escapeRegex(tokenLower)}\\b`, 'gi');
                let match: RegExpExecArray | null;

                while ((match = regex.exec(node.text)) !== null) {
                    // Calculate document position by adding node offset
                    const from = node.pos + match.index;
                    const to = node.pos + match.index + match[0].length;

                    // HARD FILTER (Sync): Double-check Registry in case triggerDiscoveryScan didn't filter
                    // This is a safety net for edge cases
                    if (smartGraphRegistry.isRegisteredEntity(candidate.token)) {
                        continue; // Skip known entity
                    }

                    // SOFT FILTER: Skip if already covered by an entity_implicit span
                    const alreadyCovered = this.implicitDecorations.some(d =>
                        d.type === 'entity_implicit' && d.from <= from && d.to >= to
                    );

                    if (!alreadyCovered) {
                        if (candidate.token.toLowerCase() === 'elbaph') {
                            console.log(`[HighlighterApi:DIAG] Creating candidate span for Elbaph at ${from}-${to}`);
                        }

                        spans.push({
                            type: 'entity_candidate',
                            from,
                            to,
                            label: candidate.token,
                            matchedText: String(candidate.score.toFixed(2)),
                            kind: 'UNKNOWN',
                            resolved: false
                        });
                    } else {
                        if (candidate.token.toLowerCase() === 'elbaph') {
                            console.log(`[HighlighterApi:DIAG] Skipping Elbaph at ${from}-${to} (already covered)`);
                        }
                    }
                }
            }
        }

        return spans;
    }


    /**
     * Trigger GoKitt Scan (Relationships)
     */
    private triggerRustScan(text: string, implicitSpans: DecorationSpan[]): void {
        if (!goKittService) {
            console.warn('[HighlighterApi] GoKittService not ready');
            return;
        }

        console.log(`[HighlighterApi] Triggering GoKitt scan (implicit count: ${implicitSpans.length})`);

        // Async scan via worker (non-blocking)
        (async () => {
            try {
                // Build provenance context for folder-aware graph projection
                const provenance = this.currentNoteId ? {
                    worldId: this.currentNoteId,
                    vaultId: this.currentNarrativeId,
                    parentPath: '', // Could be enriched with folder path if needed
                } : undefined;

                const result = await goKittService!.scan(text, provenance);
                console.log(`[HighlighterApi] GoKitt scan result:`, result);

                // Process Relations
                if (result && result.graph && result.graph.Edges) {
                    const edges = result.graph.Edges;
                    console.log(`[HighlighterApi] Found ${edges.length} edges in graph projection`);

                    edges.forEach((edge: any) => {
                        const sourceId = edge.Source?.ID || edge.Source;
                        const targetId = edge.Target?.ID || edge.Target;
                        const relType = edge.Relation;

                        if (sourceId && targetId && relType) {
                            smartGraphRegistry.upsertRelationship({
                                source: sourceId,
                                target: targetId,
                                type: relType,
                                sourceNote: this.currentNoteId
                            });
                        }
                    });
                }
            } catch (e) {
                console.error('[HighlighterApi] GoKitt scan error:', e);
            }
        })();
    }
}


let _instance: HighlighterApi | null = null;

export function getHighlighterApi(): HighlighterApi {
    if (!_instance) {
        _instance = new DefaultHighlighterApi();
    }
    return _instance;
}

export function setHighlighterApi(api: HighlighterApi): void {
    _instance = api;
}
