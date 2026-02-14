/**
 * FTS Service - Full-Text Search for Notes and Blocks
 *
 * Provides high-level FTS operations with:
 * - Scoped search (local, bubble_up, global)
 * - Hybrid search (FTS + vector similarity)
 * - Regex fallback when FTS indexes unavailable
 * - Episode logging for audit trail
 *
 * Part of RLM Phase 4: FTS Integration
 */

import { Injectable } from '@angular/core';
import { cozoDb } from '../db';
import { recordAction } from '../memory/EpisodeLogService';
import {
    FTS_QUERIES,
    FtsOptions,
    FtsBlockMatch,
    FtsNoteMatch,
    HybridBlockMatch,
    FtsIndexStatus,
    createFtsIndexes,
    checkFtsIndexExists,
} from './FtsSchema';

// ============================================================================
// Types
// ============================================================================

/**
 * Search target type
 */
export type FtsTarget = 'blocks' | 'notes' | 'notes_content' | 'all';

/**
 * Combined search result
 */
export interface FtsSearchResult {
    blocks: FtsBlockMatch[];
    notes: FtsNoteMatch[];
    query: string;
    latMs: number;
    scopeMode: 'local' | 'bubble_up' | 'global';
}

/**
 * Hybrid search options
 */
export interface HybridSearchOptions extends FtsOptions {
    /** Query vector for semantic search */
    queryVector?: number[];
    /** HNSW ef parameter (search effort) */
    ef?: number;
    /** Weight for FTS score (0-1, default 0.5) */
    ftsWeight?: number;
    /** Weight for vector score (0-1, default 0.5) */
    vecWeight?: number;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({
    providedIn: 'root',
})
export class FtsService {
    private indexStatus: FtsIndexStatus = {
        blocksFts: false,
        notesFts: false,
        notesContentFts: false,
    };
    private initialized = false;

    /**
     * Initialize FTS indexes.
     * Should be called after CozoDB is ready and has data.
     */
    initialize(): FtsIndexStatus {
        if (this.initialized) {
            return this.indexStatus;
        }

        try {
            this.indexStatus = createFtsIndexes((script) => {
                cozoDb.run(script, {});
            });
            this.initialized = true;
            console.log('[FtsService] FTS indexes initialized:', this.indexStatus);
        } catch (err) {
            console.error('[FtsService] Failed to initialize FTS indexes:', err);
        }

        return this.indexStatus;
    }

    /**
     * Check if FTS is available for a specific target.
     */
    isFtsAvailable(target: FtsTarget): boolean {
        switch (target) {
            case 'blocks':
                return this.indexStatus.blocksFts;
            case 'notes':
                return this.indexStatus.notesFts;
            case 'notes_content':
                return this.indexStatus.notesContentFts;
            case 'all':
                return this.indexStatus.blocksFts || this.indexStatus.notesFts;
            default:
                return false;
        }
    }

    /**
     * Get current index status.
     */
    getIndexStatus(): FtsIndexStatus {
        return { ...this.indexStatus };
    }

    // ============================================================================
    // Block Search
    // ============================================================================

    /**
     * Search blocks by full-text search.
     * Automatically falls back to regex if FTS unavailable.
     */
    searchBlocks(options: FtsOptions): FtsBlockMatch[] {
        const startTime = Date.now();
        const {
            query,
            minScore = 0.3,
            k = 20,
            limit = 50,
            narrativeId,
            scopeMode = 'global',
        } = options;

        let results: FtsBlockMatch[] = [];

        // Use FTS if available
        if (this.indexStatus.blocksFts) {
            const searchQuery = this.selectBlockSearchQuery(scopeMode, !!narrativeId);

            try {
                const resultStr = cozoDb.run(searchQuery, {
                    query,
                    min_score: minScore,
                    k,
                    limit,
                    narrative_id: narrativeId ?? '',
                });

                const result = JSON.parse(resultStr);
                if (result.ok !== false && result.rows) {
                    results = result.rows.map((row: unknown[]) => ({
                        blockId: row[0] as string,
                        noteId: row[1] as string,
                        text: row[2] as string,
                        score: row[3] as number,
                    }));
                }
            } catch (err) {
                console.error('[FtsService] Block FTS search failed:', err);
            }
        }

        // Fallback to regex if no FTS results
        if (results.length === 0) {
            results = this.searchBlocksRegex(query, limit);
        }

        // Log episode
        const latMs = Date.now() - startTime;
        this.logFtsEpisode('blocks', query, results.length, latMs, scopeMode);

        return results;
    }

    /**
     * Select the appropriate block search query based on scope.
     */
    private selectBlockSearchQuery(
        scopeMode: 'local' | 'bubble_up' | 'global',
        hasNarrativeScope: boolean
    ): string {
        if (scopeMode === 'local' && hasNarrativeScope) {
            return FTS_QUERIES.searchBlocksLocal;
        }
        if (scopeMode === 'bubble_up' && hasNarrativeScope) {
            return FTS_QUERIES.searchBlocksBubbleUp;
        }
        return FTS_QUERIES.searchBlocks;
    }

    /**
     * Fallback regex search for blocks.
     */
    private searchBlocksRegex(query: string, limit: number): FtsBlockMatch[] {
        // Convert query to simple regex pattern
        const pattern = this.queryToRegex(query);

        try {
            const resultStr = cozoDb.run(FTS_QUERIES.searchBlocksRegex, {
                pattern,
                limit,
            });

            const result = JSON.parse(resultStr);
            if (result.ok === false || !result.rows) {
                return [];
            }

            // Regex matches don't have scores, assign default
            return result.rows.map((row: unknown[]) => ({
                blockId: row[0] as string,
                noteId: row[1] as string,
                text: row[2] as string,
                score: 1.0, // Default score for regex matches
            }));
        } catch (err) {
            console.error('[FtsService] Block regex search failed:', err);
            return [];
        }
    }

    // ============================================================================
    // Note Search
    // ============================================================================

    /**
     * Search notes by full-text search.
     * Searches both title and content by default.
     */
    searchNotes(options: FtsOptions): FtsNoteMatch[] {
        const startTime = Date.now();
        const {
            query,
            minScore = 0.3,
            k = 20,
            limit = 50,
            narrativeId,
            scopeMode = 'global',
        } = options;

        let results: FtsNoteMatch[] = [];

        // Use combined FTS if both indexes available
        if (this.indexStatus.notesFts && this.indexStatus.notesContentFts) {
            const searchQuery = narrativeId
                ? FTS_QUERIES.searchNotesLocal
                : FTS_QUERIES.searchNotesCombined;

            try {
                const resultStr = cozoDb.run(searchQuery, {
                    query,
                    min_score: minScore,
                    k,
                    limit,
                    narrative_id: narrativeId ?? '',
                });

                const result = JSON.parse(resultStr);
                if (result.ok !== false && result.rows) {
                    results = result.rows.map((row: unknown[]) => ({
                        id: row[0] as string,
                        title: row[1] as string,
                        content: row[2] as string | undefined,
                        score: row[3] as number,
                    }));
                }
            } catch (err) {
                console.error('[FtsService] Note FTS search failed:', err);
            }
        }
        // Use content-only FTS if only content index available
        else if (this.indexStatus.notesContentFts) {
            try {
                const resultStr = cozoDb.run(FTS_QUERIES.searchNotesByContent, {
                    query,
                    min_score: minScore,
                    k,
                    limit,
                });

                const result = JSON.parse(resultStr);
                if (result.ok !== false && result.rows) {
                    results = result.rows.map((row: unknown[]) => ({
                        id: row[0] as string,
                        title: row[1] as string,
                        content: row[2] as string,
                        score: row[3] as number,
                    }));
                }
            } catch (err) {
                console.error('[FtsService] Note content FTS search failed:', err);
            }
        }

        // Fallback to regex if no FTS results
        if (results.length === 0) {
            results = this.searchNotesRegex(query, limit);
        }

        // Log episode
        const latMs = Date.now() - startTime;
        this.logFtsEpisode('notes', query, results.length, latMs, scopeMode);

        return results;
    }

    /**
     * Fallback regex search for notes.
     */
    private searchNotesRegex(query: string, limit: number): FtsNoteMatch[] {
        const pattern = this.queryToRegex(query);

        try {
            const resultStr = cozoDb.run(FTS_QUERIES.searchNotesRegex, {
                pattern,
                limit,
            });

            const result = JSON.parse(resultStr);
            if (result.ok === false || !result.rows) {
                return [];
            }

            return result.rows.map((row: unknown[]) => ({
                id: row[0] as string,
                title: row[1] as string,
                content: row[2] as string,
                score: 1.0,
            }));
        } catch (err) {
            console.error('[FtsService] Note regex search failed:', err);
            return [];
        }
    }

    // ============================================================================
    // Combined Search
    // ============================================================================

    /**
     * Search both blocks and notes.
     * Returns combined result with both types.
     */
    search(options: FtsOptions): FtsSearchResult {
        const startTime = Date.now();
        const { query, scopeMode = 'global' } = options;

        const blocks = this.searchBlocks(options);
        const notes = this.searchNotes(options);

        const latMs = Date.now() - startTime;

        return {
            blocks,
            notes,
            query,
            latMs,
            scopeMode,
        };
    }

    // ============================================================================
    // Hybrid Search (FTS + Vector)
    // ============================================================================

    /**
     * Hybrid search combining FTS and vector similarity.
     * Requires queryVector for semantic search component.
     */
    hybridSearch(options: HybridSearchOptions): HybridBlockMatch[] {
        const startTime = Date.now();
        const {
            query,
            queryVector,
            minScore = 0.3,
            k = 20,
            limit = 50,
            ef = 100,
        } = options;

        // Need both FTS and vector for hybrid
        if (!this.indexStatus.blocksFts || !queryVector) {
            // Fall back to pure FTS or vector
            if (this.indexStatus.blocksFts) {
                return this.searchBlocks(options).map((m) => ({
                    blockId: m.blockId,
                    noteId: m.noteId,
                    text: m.text,
                    combinedScore: m.score,
                    ftsScore: m.score,
                }));
            }
            return [];
        }

        try {
            const resultStr = cozoDb.run(FTS_QUERIES.hybridSearchBlocks, {
                query,
                query_vector: queryVector,
                min_score: minScore,
                k,
                ef,
                limit,
            });

            const result = JSON.parse(resultStr);
            if (result.ok === false || !result.rows) {
                return [];
            }

            const latMs = Date.now() - startTime;
            const matches: HybridBlockMatch[] = result.rows.map((row: unknown[]) => ({
                blockId: row[0] as string,
                noteId: row[1] as string,
                text: row[2] as string,
                combinedScore: row[3] as number,
            }));

            // Log episode
            this.logFtsEpisode('hybrid', query, matches.length, latMs, 'global');

            return matches;
        } catch (err) {
            console.error('[FtsService] Hybrid search failed:', err);
            return [];
        }
    }

    // ============================================================================
    // Utilities
    // ============================================================================

    /**
     * Convert a search query to a regex pattern.
     * Simple approach: match any word from the query.
     */
    private queryToRegex(query: string): string {
        // Escape special regex characters
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match any word (case-insensitive will be handled by Cozo)
        return `(?i)${escaped}`;
    }

    /**
     * Log an FTS search episode for audit trail.
     */
    private logFtsEpisode(
        target: string,
        query: string,
        resultCount: number,
        latMs: number,
        scopeMode: string
    ): void {
        try {
            recordAction(
                'system', // scopeId
                '', // noteId
                'fts_search',
                query, // targetId (using query as identifier)
                'search', // targetKind
                {
                    metadata: {
                        target,
                        query,
                        resultCount,
                        latMs,
                        scopeMode,
                    },
                },
                '' // narrativeId
            );
        } catch (err) {
            // Don't fail search if logging fails
            console.warn('[FtsService] Failed to log FTS episode:', err);
        }
    }
}

// ============================================================================
// Standalone Functions (for non-injected usage)
// ============================================================================

// ============================================================================
// Singleton Instance (for non-injected usage)
// ============================================================================

export const ftsService = new FtsService();

// ============================================================================
// Standalone Functions (using singleton)
// ============================================================================

/**
 * Quick FTS search for blocks.
 */
export function ftsSearchBlocks(query: string, limit = 20): FtsBlockMatch[] {
    ftsService.initialize();
    return ftsService.searchBlocks({ query, limit });
}

/**
 * Quick FTS search for notes.
 */
export function ftsSearchNotes(query: string, limit = 20): FtsNoteMatch[] {
    ftsService.initialize();
    return ftsService.searchNotes({ query, limit });
}
