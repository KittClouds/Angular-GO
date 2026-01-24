// NO CHANGE TO THIS FILE YET - I need to inspect another file first.
// Highlighter API - interface between Scanner and Editor
// Connected to mocking stores for now
// Wired to ScanCoordinator for entity event emission

import type { DecorationSpan, HighlighterConfig, HighlightMode } from '../lib/Scanner';
import { scanDocument, getDecorationStyle, getDecorationClass } from '../lib/Scanner';
import { scanForPatternsSync } from '../lib/Scanner/pattern-scanner';
import type { EntityKind } from '../lib/Scanner/types';
import { getScanCoordinator } from '../lib/Scanner/scanCoordinatorInstance';

// Real imports (replacing mocks)
import { highlightingStore } from '../lib/store/highlightingStore';

// Real Dexie imports
import {
    getNoteDecorations,
    saveNoteDecorations,
    getDecorationContentHash,
    hashContent
} from '../lib/dexie/decorations';

// STUBBED: KittCore, DiscoveryStore, AppOrchestrator remain mocked for now

// Mock for KittCore
const kittCore = {
    scanImplicitRust: async (_text: string, _narrativeId?: string): Promise<DecorationSpan[]> => [],
    scan: async (_text: string, _spans: any[]) => ({ relations: [], triples: [] }),
    scanDiscovery: async (_text: string): Promise<any[]> => []
};

// Mock for DiscoveryStore
const useDiscoveryStore = {
    getState: () => ({
        addCandidates: (_c: any[]) => { }
    })
};

// Mock for AppOrchestrator
const appOrchestrator = {
    getState: () => 'ready'
};

// =============================================================================
// HIGHLIGHTER API INTERFACE
// =============================================================================

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

// ProseMirror document interface (minimal)
export interface ProseMirrorDoc {
    descendants: (callback: (node: { isText?: boolean; text?: string }, pos: number) => void) => void;
}

// =============================================================================
// DEFAULT IMPLEMENTATION - CONNECTED TO HIGHLIGHTING STORE
// =============================================================================

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

    // Smart scan tracking
    private hasScannedOnOpen = false;  // Ensures one initial scan per note
    private lastKnownEntityCount = 0;  // Track entity count for change detection

    // Node batch tracking for discovery position alignment
    private lastNodeBatch: Array<{ text: string; pos: number }> = [];

    // Rust scanner tracking
    // @ts-ignore
    private pendingRustScan = false;   // Entities found, waiting for sentence end
    private lastSentenceEndPos = 0;    // Track last punctuation position

    /** Set the current note ID for scan coordinator */
    setNoteId(noteId: string, narrativeId?: string): void {
        const prevNoteId = this.currentNoteId;
        this.currentNoteId = noteId;
        this.currentNarrativeId = narrativeId;

        // Reset smart scan state when switching notes
        if (noteId && noteId !== prevNoteId) {
            this.hasScannedOnOpen = false;
            this.lastKnownEntityCount = 0;
            this.lastSentenceEndPos = 0;
            this.lastContext = '';
            this.lastScannedContext = '';
            this.prewarmCacheForNote(noteId);
        }
    }

    /** Pre-warm cache by loading decorations early (before getDecorations is called) */
    private async prewarmCacheForNote(noteId: string): Promise<void> {
        // We don't have content yet, but we can check if we have ANY cached entry
        // for this note. If we do, it'll be ready when getDecorations is called.
        // The actual content-based cache lookup happens in tryLoadCachedOrScan.
    }

    /** Called on editor keystroke - forward to scan coordinator */
    onKeystroke(char: string, cursorPos: number, contextText: string): void {
        if (!this.currentNoteId) return;
        getScanCoordinator().onKeystroke(char, cursorPos, contextText, this.currentNoteId);
    }

    // Store last doc for re-scan capability
    private lastDoc: ProseMirrorDoc | null = null;

    constructor() {
        // subscribe to store changes
        highlightingStore.subscribe(() => this.notifyListeners());

        // Listen for entity changes to trigger immediate re-scan
        // Listen for entity changes to trigger immediate re-scan
        // DISABLE: This causes an infinite loop because Registration -> entities-changed -> forceRescan -> Registration
        // If we need this, we must ensure it only triggers on EXTERNAL changes, not self-induced ones.
        /*
        if (typeof window !== 'undefined') {
            window.addEventListener('entities-changed', () => {
                console.log('[HighlighterApi] Entities changed, triggering re-scan');
                this.forceRescan();
            });
        }
        */
    }

    /**
     * Force a fresh scan (called when entities are registered/changed)
     * This clears cache state and re-scans current content
     */
    forceRescan(): void {
        if (!this.lastDoc || !this.currentNoteId) {
            console.log('[HighlighterApi] forceRescan: no doc or noteId cached');
            return;
        }

        // Clear scan state to force fresh scan
        this.hasScannedOnOpen = false;
        this.lastScannedContext = '';

        // Get current text and trigger scan
        const text = docContent(this.lastDoc);
        this.lastContext = text;
        this.hasScannedOnOpen = true;
        this.lastScannedContext = text;

        console.log('[HighlighterApi] forceRescan: triggering fresh implicit scan');
        this.triggerImplicitScan(this.lastDoc, text);
    }

    private notifyListeners() {
        this.listeners.forEach(cb => cb());
    }

    getDecorations(doc: ProseMirrorDoc): DecorationSpan[] {
        // Cache doc for forceRescan capability
        this.lastDoc = doc;

        const settings = highlightingStore.getSettings();

        if (settings.mode === 'off') {
            return [];
        }

        const spans = scanDocument(doc);
        console.log(`[HighlighterApi] scanDocument identified ${spans.length} raw spans.`);
        if (spans.length > 0) {
            console.log('[HighlighterApi] First 3 raw spans:', spans.slice(0, 3));
        }
        const text = docContent(doc);

        // Smart scan logic:
        // 1. First call after note switch: ALWAYS scan fresh (cache positions may be stale)
        // 2. After that: use cache for unchanged content, re-scan on new entities
        if (text !== this.lastContext) {
            this.lastContext = text; // Always update 'seen' text

            if (!this.hasScannedOnOpen) {
                // ALWAYS scan fresh on note open - cached positions may be from different doc parse
                console.log('[HighlighterApi:DIAG] Initial scan on note open (fresh)');
                this.hasScannedOnOpen = true;
                this.lastScannedContext = text;
                // CHANGED: Try load from cache first instead of forcing fresh scan
                this.tryLoadCachedOrScan(doc, text);
            } else {
                // After initial scan: only re-scan if entity count increased
                // This detects when user adds a new entity mention
                const currentEntityCount = this.implicitDecorations.filter(d =>
                    d.type === 'entity_implicit'
                ).length;

                const prevLength = this.lastScannedContext.length;
                const shouldCheck = this.shouldCheckForNewEntities(text, prevLength);

                // Quick heuristic: if no entities yet but text is being added, check again
                // This catches the case where user types a known entity name
                if (currentEntityCount === 0 || shouldCheck) {
                    console.log(`[HighlighterApi:DIAG] Threshold met (Diff: ${Math.abs(text.length - prevLength)}). Scanning...`);
                    this.lastScannedContext = text;
                    this.tryLoadCachedOrScan(doc, text);
                }
            }
        }

        // Merge implicit spans
        // Start with explicit spans
        const allSpans = [...spans];

        // Add implicit spans that DON'T overlap with explicit ones
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

        // Resort
        allSpans.sort((a, b) => a.from - b.from);

        // Filter based on config
        const filteredSpans = allSpans.filter(span => {
            // Filter by type
            if (span.type === 'wikilink' && !settings.showWikilinks) return false;
            // @ts-ignore
            if (span.type === 'entity_ref' && !this.enableEntityRefs) return false;

            // Focus mode: filter by entity kind
            if (settings.mode === 'focus' && span.type === 'entity' && span.kind) {
                // @ts-ignore
                return settings.focusEntityKinds.includes(span.kind as EntityKind);
            }

            return true;
        });

        // Emit entity decorations to ScanCoordinator (non-blocking)
        // This is in the hot path but ScanCoordinator queues, doesn't block
        // console.log(`[HighlighterApi] Checking check to send to Coordinator. NoteID: '${this.currentNoteId}'`);

        if (this.currentNoteId) {
            const entitySpans = filteredSpans.filter(s =>
                s.type === 'entity' ||
                s.type === 'entity_ref' ||
                s.type === 'relationship' ||
                s.type === 'predicate'
            );
            // console.log(`[HighlighterApi] Sending ${entitySpans.length} entities to ScanCoordinator`);
            for (const span of entitySpans) {
                getScanCoordinator().onEntityDecoration(span, this.currentNoteId);
            }
        } else {
            console.warn('[HighlighterApi] NOT sending entities to ScanCoordinator because currentNoteId is missing!');
        }

        return filteredSpans;
    }

    /**
     * Heuristic to detect if user might have added a new entity.
     * We check if text has grown by enough characters to potentially contain an entity name.
     */
    private shouldCheckForNewEntities(currentText: string, prevLength: number): boolean {
        // If we have entities and text grew, the implicit scanner will pick up new mentions
        // This is a lightweight check - actual entity detection happens in the worker
        const currLength = currentText.length;

        // Text grew by at least 3 chars (minimum entity name length)
        // This prevents scanning on every single keystroke
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

    /**
     * Try to load cached decorations, fall back to scanner if cache miss or stale
     */
    private async tryLoadCachedOrScan(doc: ProseMirrorDoc, text: string): Promise<void> {
        // Must have noteId for local storage
        if (!this.currentNoteId) {
            this.triggerImplicitScan(doc, text);
            return;
        }

        try {
            // Local-first: read from Dexie
            const cached = await getNoteDecorations(this.currentNoteId);

            if (cached && cached.length > 0) {
                // Validate content hash to ensure positions are still valid
                const storedHash = await getDecorationContentHash(this.currentNoteId);
                const currentHash = hashContent(text);

                if (storedHash === currentHash) {
                    console.log(`[HighlighterApi] Cache hit (hash match): ${cached.length} decorations for note ${this.currentNoteId}`);
                    this.implicitDecorations = cached;
                    this.notifyListeners();
                    return;
                }

                // Hash mismatch: content changed, positions are stale
                console.log(`[HighlighterApi] Cache stale (hash mismatch) for note ${this.currentNoteId}, re-scanning...`);
            }
        } catch (err) {
            console.warn('[HighlighterApi] Dexie read failed:', err);
        }

        console.log(`[HighlighterApi] No valid cache for note ${this.currentNoteId}, scanning...`);
        this.triggerImplicitScan(doc, text);
    }

    private triggerImplicitScan(doc: ProseMirrorDoc, text?: string, _entityVersion?: number) {
        // console.log('[HighlighterApi:DIAG] triggerImplicitScan called!');
        const myVersion = ++this.scanVersion;
        const batch: { id: number, text: string }[] = [];
        const nodePositions = new Map<number, number>(); // Map batch ID to document position

        // Collect full text for hash computation
        let fullText = '';
        let batchIdCounter = 0;
        const nodeBatchForDiscovery: Array<{ text: string; pos: number }> = [];
        doc.descendants((node, pos) => {
            if (node.isText && node.text) {
                const id = batchIdCounter++;
                batch.push({ id, text: node.text });
                nodePositions.set(id, pos);
                nodeBatchForDiscovery.push({ text: node.text, pos });
                fullText += node.text; // Concatenate for hash (matches docContent logic)
            }
        });

        // Store for discovery candidate position alignment
        this.lastNodeBatch = nodeBatchForDiscovery;

        // If nothing to scan
        if (batch.length === 0) {
            this.implicitDecorations = [];
            this.notifyListeners();
            return;
        }

        // Capture noteId and content hash for Dexie write
        const noteIdForSave = this.currentNoteId;
        const contentHashForSave = hashContent(fullText);

        // Run scans in parallel for each node (mimicking old scanBatch)
        // This ensures offsets remain correct per-node
        const scanPromises = batch.map(async (item) => {
            try {
                // Use Regex Pattern Scanner instead of WASM for now (until WASM is fixed)
                // This respects the User's request to use the "pattern matcher"
                // console.log(`[HighlighterApi:TRACE] Calling scanForPatternsSync for node ${item.id}`);
                const spans = scanForPatternsSync(item.text);

                // console.log(`[HighlighterApi:TRACE] scanForPatternsSync returned ${spans?.length ?? 0} spans for node ${item.id}`);
                return { id: item.id, spans };
            } catch (e) {
                console.warn(`[HighlighterApi] Scan failed for node ${item.id}`, e);
                return { id: item.id, spans: [] };
            }
        });


        Promise.all(scanPromises).then(async (results) => {
            // Only apply if this is still the latest requested scan
            if (this.scanVersion !== myVersion) {
                return;
            }

            const mergedSpans: DecorationSpan[] = [];

            // Reconstruct spans with correct document offsets
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

            // Update entity count for change detection
            const entityCount = mergedSpans.filter(d => d.type === 'entity_implicit').length;
            const hadNewEntities = entityCount > this.lastKnownEntityCount;
            this.lastKnownEntityCount = entityCount;

            // Check if sentence ended (punctuation at end of new content)
            const sentenceEnded = this.detectSentenceEnd(fullText);

            // Trigger Rust scan (Relationships) if: entities present AND sentence just completed
            if (entityCount > 0 && sentenceEnded && hadNewEntities) {
                this.triggerRustScan(fullText, mergedSpans);
            }

            // Local-first: write to Dexie
            if (noteIdForSave) {
                try {
                    await saveNoteDecorations(noteIdForSave, mergedSpans, contentHashForSave);
                } catch (err) {
                    console.warn('[HighlighterApi] Dexie write failed:', err);
                }
            }

            // [Unsupervised NER] Trigger Discovery
            this.triggerDiscoveryScan(fullText);
        });
    }

    /**
     * Detect if text ends with sentence-ending punctuation
     */
    private detectSentenceEnd(text: string): boolean {
        const trimmed = text.trimEnd();
        if (!trimmed) return false;

        const lastChar = trimmed[trimmed.length - 1];
        const isPunctuation = lastChar === '.' || lastChar === '!' || lastChar === '?';

        if (isPunctuation) {
            // Track position to avoid re-triggering on same sentence
            const pos = trimmed.length;
            if (pos > this.lastSentenceEndPos) {
                this.lastSentenceEndPos = pos;
                return true;
            }
        }
        return false;
    }

    /**
     * Trigger Discovery Scan (Unsupervised NER)
     * "The Virus" - finds new entity patterns.
     * DEFERRED: Only runs after app is ready (not during boot sequence)
     */
    private triggerDiscoveryScan(text: string): void {
        // Skip discovery during boot - defer until app is ready
        if (appOrchestrator.getState() !== 'ready') {
            // Schedule for after boot
            setTimeout(() => this.triggerDiscoveryScan(text), 500);
            return;
        }

        // Discovery is cheap (mostly), but we shouldn't spam it.
        // It runs via Shared Memory, so no serialization overhead.

        kittCore.scanDiscovery(text)

            .then(candidates => {
                // Show Watching (0) AND Promoted (1) for now, until graph sync is ready
                const newCandidates = candidates.filter(c => c.status === 0 || c.status === 1);
                if (newCandidates.length > 0) {
                    console.log(`[Discovery:HighlightApi] Found ${newCandidates.length} NEW candidates:`, newCandidates.map(c => c.token));
                    // Emit to DiscoveryStore
                    useDiscoveryStore.getState().addCandidates(newCandidates);

                    // Create highlight spans for discovered tokens
                    const candidateSpans = this.createCandidateSpans(text, newCandidates);
                    if (candidateSpans.length > 0) {
                        console.log(`[Discovery:HighlightApi] Created ${candidateSpans.length} candidate spans`);
                        // Merge with existing implicitDecorations
                        this.implicitDecorations = [
                            ...this.implicitDecorations.filter(d => d.type !== 'entity_candidate'),
                            ...candidateSpans
                        ];
                        this.notifyListeners();
                    }
                } else {
                    if (candidates.length > 0) {
                        console.log(`[Discovery:HighlightApi] Ignored ${candidates.length} candidates (all existing/ignored)`);
                    }
                }
            })
            .catch(err => {
                console.warn('[HighlighterApi] Discovery scan failed:', err);
            });
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

                    // Skip if already covered by an entity_implicit span
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
                            resolved: false
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

    /**
     * Trigger Rust/KittCore scan for relationship extraction
     */
    private triggerRustScan(text: string, implicitSpans: DecorationSpan[]): void {
        // ... (Existing implementation) ...
        // Convert implicit decorations to entity spans for KittCore
        const entitySpans = implicitSpans
            .filter(d => d.type === 'entity_implicit')
            .map(d => ({
                label: d.label ?? '',
                start: d.from,
                end: d.to,
            }));

        if (entitySpans.length === 0) return;

        console.log(`[HighlighterApi] Triggering Rust scan with ${entitySpans.length} entities`);

        // Fire and forget - Rust scan runs in background
        kittCore.scan(text, entitySpans)
            .then(result => {
                console.log(`[HighlighterApi] Rust scan complete: ${result.relations.length} relations, ${result.triples.length} triples`);
                // Relations are automatically persisted by KittCore
            })
            .catch(err => {
                console.warn('[HighlighterApi] Rust scan failed:', err);
            });
    }
}

// =============================================================================
// SINGLETON
// =============================================================================

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
