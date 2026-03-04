/**
 * ScanPipeline — Sequential orchestrator for the three scanning stages.
 * Enforces: Highlight → Discover → Graph ordering.
 * 
 * This is the single entry point for all scanning. No more fire-and-forget races.
 * 
 * Absorbs the entity-event batching and delta logic from the old ScanCoordinator.
 */
import type { DecorationSpan } from './types';
import type { ProvenanceContext } from '../../services/gokitt.service';
import type { DiscoveryCandidate } from '../store/discoveryStore';
import { HighlightScanner } from './highlight-scanner';
import { DiscoveryScanner, type DiscoveryResult } from './discovery-scanner';
import { GraphScanner, type GraphResult } from './graph-scanner';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineScanOptions {
    /** Skip discovery scan (e.g. when FST is disabled) */
    skipDiscovery?: boolean;
    /** Skip graph scan (e.g. mid-word typing, no sentence boundary) */
    skipGraph?: boolean;
    /** Provenance context for folder-aware graph projection */
    provenance?: ProvenanceContext;
    /** Current note ID for graph edge attribution */
    noteId?: string;
}

export interface PipelineResult {
    /** Highlight spans from the implicit scanner (concatenated-text coords) */
    highlights: DecorationSpan[];
    /** Discovery candidates (already filtered against registry) */
    discovery: DiscoveryResult | null;
    /** Graph result (nodes + edges) */
    graph: GraphResult | null;
}

export interface PipelineStats {
    totalRuns: number;
    highlightOnlyRuns: number;
    fullPipelineRuns: number;
    lastRunMs: number;
    errors: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export class ScanPipeline {
    private stats: PipelineStats = {
        totalRuns: 0,
        highlightOnlyRuns: 0,
        fullPipelineRuns: 0,
        lastRunMs: 0,
        errors: 0,
    };

    // Debounce guard: prevent concurrent pipeline runs
    private running = false;
    private pendingRun: { text: string; opts: PipelineScanOptions } | null = null;

    constructor(
        private readonly highlightScanner: HighlightScanner,
        private readonly discoveryScanner: DiscoveryScanner,
        private readonly graphScanner: GraphScanner,
    ) { }

    /**
     * Run the scan pipeline sequentially:
     *   1. Highlight (fast, always runs)
     *   2. Discover (populates registry BEFORE graph)
     *   3. Graph (now has full registry context)
     */
    async run(text: string, opts: PipelineScanOptions = {}): Promise<PipelineResult> {
        // Debounce: if already running, queue the latest request
        if (this.running) {
            this.pendingRun = { text, opts };
            return { highlights: [], discovery: null, graph: null };
        }

        this.running = true;
        const startTime = performance.now();

        try {
            this.stats.totalRuns++;

            // ─── Stage 1: Highlighting (always runs) ───────────────────
            const highlights = await this.highlightScanner.scan(text);

            // ─── Stage 2: Discovery (unsupervised NER) ─────────────────
            let discovery: DiscoveryResult | null = null;
            if (!opts.skipDiscovery) {
                discovery = await this.discoveryScanner.discover(text);
            }

            // ─── Stage 3: Graph (relationship extraction) ──────────────
            let graph: GraphResult | null = null;
            if (!opts.skipGraph && opts.noteId) {
                graph = await this.graphScanner.buildGraph(text, opts.noteId, opts.provenance);
                this.stats.fullPipelineRuns++;
            } else {
                this.stats.highlightOnlyRuns++;
            }

            this.stats.lastRunMs = performance.now() - startTime;

            return { highlights, discovery, graph };
        } catch (e) {
            this.stats.errors++;
            console.error('[ScanPipeline] Pipeline error:', e);
            return { highlights: [], discovery: null, graph: null };
        } finally {
            this.running = false;

            // Process any queued request
            if (this.pendingRun) {
                const { text: pendingText, opts: pendingOpts } = this.pendingRun;
                this.pendingRun = null;
                // Fire-and-forget the queued run (caller already got empty result)
                this.run(pendingText, pendingOpts).catch(console.error);
            }
        }
    }

    /**
     * Run highlight-only (fast path for mid-word typing).
     * Skips discovery and graph entirely.
     */
    async runHighlightOnly(text: string): Promise<DecorationSpan[]> {
        try {
            return await this.highlightScanner.scan(text);
        } catch (e) {
            console.error('[ScanPipeline] Highlight-only error:', e);
            return [];
        }
    }

    getStats(): Readonly<PipelineStats> {
        return { ...this.stats };
    }
}
