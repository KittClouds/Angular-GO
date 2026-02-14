/**
 * FTS Schema - Full-Text Search Index Definitions
 *
 * CozoDB v0.7+ FTS indexes for notes and blocks.
 * Enables BM25 scoring, boolean ops, phrase match, and prefix search.
 *
 * Key indexes:
 * - blocks_fts: Full-text search on block text
 * - notes_fts: Full-text search on note title and content
 */

// =============================================================================
// FTS INDEX DEFINITIONS
// =============================================================================

/**
 * FTS index for blocks table
 * Searches the `text` field with default tokenizer and filter.
 *
 * Usage:
 * ?[block_id, text, score] :=
 *     ~blocks:blocks_fts {block_id, text |
 *         query: $query,
 *         min_score: 0.3,
 *         k: 20
 *     }
 */
export const BLOCKS_FTS_INDEX = `
::fts create blocks:blocks_fts {
    extractor: text,
    tokenizer: default,
    filter: default
}
`;

/**
 * FTS index for notes table
 * Searches the `title` and `content` fields.
 * Uses default tokenizer (whitespace + punctuation) and filter (lowercase).
 *
 * Usage:
 * ?[id, title, content, score] :=
 *     ~notes:notes_fts {id, title, content |
 *         query: $query,
 *         min_score: 0.3,
 *         k: 20
 *     }
 */
export const NOTES_FTS_INDEX = `
::fts create notes:notes_fts {
    extractor: title,
    tokenizer: default,
    filter: default
}
`;

/**
 * Alternative FTS index for notes content (larger text body)
 * Can be used for deeper content search.
 */
export const NOTES_CONTENT_FTS_INDEX = `
::fts create notes:notes_content_fts {
    extractor: content,
    tokenizer: default,
    filter: default
}
`;

// =============================================================================
// FTS QUERIES
// =============================================================================

export const FTS_QUERIES = {
    /**
     * Search blocks by full-text search
     * Returns block_id, note_id, text, and BM25 score
     */
    searchBlocks: `
        ?[block_id, note_id, text, score] :=
            ~blocks:blocks_fts {block_id, text |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *blocks{block_id, note_id, text}
        :order -score
        :limit $limit
    `,

    /**
     * Search blocks with narrative scope (local)
     */
    searchBlocksLocal: `
        ?[block_id, note_id, text, score] :=
            ~blocks:blocks_fts {block_id, text |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *blocks{block_id, note_id, text, narrative_id},
            narrative_id == $narrative_id
        :order -score
        :limit $limit
    `,

    /**
     * Search blocks with bubble-up scope
     * Includes ancestor narratives from folder hierarchy
     */
    searchBlocksBubbleUp: `
        # Build scope closure from folder hierarchy
        scope_closure[nid] <- [[$narrative_id]]
        scope_closure[parent_nid] :=
            scope_closure[child_nid],
            *folder_hierarchy{parent_id: parent_nid, child_id: child_nid, invalid_at},
            is_null(invalid_at)

        ?[block_id, note_id, text, score] :=
            ~blocks:blocks_fts {block_id, text |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *blocks{block_id, note_id, text, narrative_id},
            scope_closure[narrative_id]
        :order -score
        :limit $limit
    `,

    /**
     * Search notes by title (FTS)
     */
    searchNotesByTitle: `
        ?[id, title, folder_id, score] :=
            ~notes:notes_fts {id, title |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *notes{id, title, folder_id}
        :order -score
        :limit $limit
    `,

    /**
     * Search notes by content (FTS)
     */
    searchNotesByContent: `
        ?[id, title, content, score] :=
            ~notes:notes_content_fts {id, content |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *notes{id, title, content}
        :order -score
        :limit $limit
    `,

    /**
     * Combined search: notes by title OR content
     * Uses union to combine results from both indexes
     */
    searchNotesCombined: `
        title_matches[id, title, score] :=
            ~notes:notes_fts {id, title |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *notes{id, title}

        content_matches[id, title, score] :=
            ~notes:notes_content_fts {id, content |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *notes{id, title}

        ?[id, title, max_score] :=
            (title_matches[id, title, score]; content_matches[id, title, score]),
            max_score = max(score)
        :order -max_score
        :limit $limit
    `,

    /**
     * Search notes with narrative scope (local)
     */
    searchNotesLocal: `
        ?[id, title, content, score] :=
            ~notes:notes_content_fts {id, content |
                query: $query,
                min_score: $min_score,
                k: $k
            },
            *notes{id, title, content, narrative_id},
            narrative_id == $narrative_id
        :order -score
        :limit $limit
    `,

    /**
     * Fallback regex search for blocks (when FTS index not available)
     * Uses Cozo's regex match operator
     */
    searchBlocksRegex: `
        ?[block_id, note_id, text] :=
            *blocks{block_id, note_id, text},
            text ~ $pattern
        :limit $limit
    `,

    /**
     * Fallback regex search for notes
     */
    searchNotesRegex: `
        ?[id, title, content] :=
            *notes{id, title, content},
            (title ~ $pattern; content ~ $pattern)
        :limit $limit
    `,

    /**
     * Hybrid search: Combine FTS with vector similarity
     * Returns blocks matching either criteria, ranked by combined score
     */
    hybridSearchBlocks: `
        # FTS matches
        fts_matches[block_id, fts_score] :=
            ~blocks:blocks_fts {block_id, text |
                query: $query,
                min_score: $min_score,
                k: $k
            }

        # Vector matches
        vec_matches[block_id, vec_score] :=
            ~blocks:semantic_idx_384 {block_id |
                query_vec: $query_vector,
                k: $k,
                ef: $ef
            }

        # Combine scores (weighted sum)
        ?[block_id, note_id, text, combined_score] :=
            (fts_matches[block_id, fts_score]; vec_matches[block_id, vec_score]),
            *blocks{block_id, note_id, text},
            # Default missing scores to 0, weight FTS at 0.5 and vector at 0.5
            combined_score = coalesce(fts_score, 0) * 0.5 + coalesce(vec_score, 0) * 0.5
        :order -combined_score
        :limit $limit
    `,
};

// =============================================================================
// TYPES
// =============================================================================

/**
 * FTS search options
 */
export interface FtsOptions {
    /** Search query string */
    query: string;
    /** Minimum BM25 score (default 0.3) */
    minScore?: number;
    /** Maximum results to return (default 20) */
    k?: number;
    /** Result limit after processing (default 50) */
    limit?: number;
    /** Narrative scope for filtered search */
    narrativeId?: string;
    /** Scope mode: local, bubble_up, global */
    scopeMode?: 'local' | 'bubble_up' | 'global';
}

/**
 * FTS block search result
 */
export interface FtsBlockMatch {
    blockId: string;
    noteId: string;
    text: string;
    score: number;
}

/**
 * FTS note search result
 */
export interface FtsNoteMatch {
    id: string;
    title: string;
    content?: string;
    folderId?: string;
    score: number;
}

/**
 * Hybrid search result (FTS + Vector)
 */
export interface HybridBlockMatch {
    blockId: string;
    noteId: string;
    text: string;
    combinedScore: number;
    ftsScore?: number;
    vecScore?: number;
}

/**
 * FTS index status
 */
export interface FtsIndexStatus {
    blocksFts: boolean;
    notesFts: boolean;
    notesContentFts: boolean;
}

// =============================================================================
// INDEX CREATION
// =============================================================================

/**
 * Create FTS indexes on blocks and notes tables.
 * Should be called after the base relations exist and have data.
 *
 * Note: CozoDB FTS indexes require data in the relation before creation.
 * Returns status of each index creation attempt.
 */
export function createFtsIndexes(
    runQuery: (script: string) => void
): FtsIndexStatus {
    const status: FtsIndexStatus = {
        blocksFts: false,
        notesFts: false,
        notesContentFts: false,
    };

    // Create blocks FTS index
    try {
        runQuery(BLOCKS_FTS_INDEX);
        status.blocksFts = true;
        console.log('[FtsSchema] Created blocks_fts index');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists') && !msg.includes('AlreadyExists')) {
            console.warn('[FtsSchema] Could not create blocks_fts:', msg);
        } else {
            status.blocksFts = true; // Already exists is OK
        }
    }

    // Create notes title FTS index
    try {
        runQuery(NOTES_FTS_INDEX);
        status.notesFts = true;
        console.log('[FtsSchema] Created notes_fts index');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists') && !msg.includes('AlreadyExists')) {
            console.warn('[FtsSchema] Could not create notes_fts:', msg);
        } else {
            status.notesFts = true;
        }
    }

    // Create notes content FTS index
    try {
        runQuery(NOTES_CONTENT_FTS_INDEX);
        status.notesContentFts = true;
        console.log('[FtsSchema] Created notes_content_fts index');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('already exists') && !msg.includes('AlreadyExists')) {
            console.warn('[FtsSchema] Could not create notes_content_fts:', msg);
        } else {
            status.notesContentFts = true;
        }
    }

    return status;
}

/**
 * Check if FTS indexes exist by attempting a minimal query.
 * Returns true if the index is available.
 */
export function checkFtsIndexExists(
    runQuery: (script: string, params?: Record<string, unknown>) => unknown,
    indexType: 'blocks' | 'notes' | 'notes_content'
): boolean {
    const testQueries = {
        blocks: `?[count(block_id)] := ~blocks:blocks_fts {block_id, text | query: "test", k: 1}`,
        notes: `?[count(id)] := ~notes:notes_fts {id, title | query: "test", k: 1}`,
        notes_content: `?[count(id)] := ~notes:notes_content_fts {id, content | query: "test", k: 1}`,
    };

    try {
        runQuery(testQueries[indexType]);
        return true;
    } catch {
        return false;
    }
}