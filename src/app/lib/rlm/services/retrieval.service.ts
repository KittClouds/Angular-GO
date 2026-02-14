import { Injectable, inject } from '@angular/core';
import { QueryRunnerService, type QueryResult } from './query-runner.service';

/**
 * Result of an FTS block search
 */
export interface BlockSearchResult {
    blockId: string;
    text: string;
    score: number;
}

/**
 * Result of a regex note search
 */
export interface NoteSearchResult {
    noteId: string;
    title: string;
    snippet: string;
}

/**
 * Result of a workspace node JSON path query
 */
export interface WsNodeJsonResult {
    nodeId: string;
    kind: string;
    json: Record<string, unknown>;
    matchedValue: unknown;
}

/**
 * Result of an episode payload introspection query
 */
export interface EpisodePayloadResult {
    scopeId: string;
    noteId: string;
    ts: number;
    actionType: string;
    payloadValue: unknown;
}

/**
 * Result of a folder metadata query
 */
export interface FolderMetadataResult {
    folderId: string;
    name: string;
    metaValue: unknown;
}

/**
 * Retrieval Service for RLM
 * 
 * Provides high-level retrieval primitives for the RLM loop:
 * - FTS Search (Native Cozo, global and world-scoped)
 * - Regex Search (CozoDB regex_matches)
 * - JSON Path Queries (CozoDB get / maybe_get)
 * - Vector Search (HNSW)
 * - Graph Expansion
 */
@Injectable({ providedIn: 'root' })
export class RetrievalService {
    private queryRunner: QueryRunnerService;

    constructor(queryRunner?: QueryRunnerService) {
        this.queryRunner = queryRunner || inject(QueryRunnerService);
    }

    /**
     * Search blocks using CozoDB's native FTS index.
     * 
     * Uses `~blocks:fts_idx` operator with BM25 scoring.
     * 
     * @param query Search keywords (supports boolean ops like 'foo && bar')
     * @param limit Max results (default 10)
     * @param workspaceId (Optional) workspace to log this retrieval action
     */
    async searchBlocksFTS(
        query: string,
        limit: number = 10,
        workspaceId?: string
    ): Promise<BlockSearchResult[]> {
        // Safe binding of limit
        const k = Math.min(limit, 50);

        // Native Cozo FTS query
        // extractor: text (from schema)
        // bind_score: score output variable
        const script = `
            ?[block_id, text, score] := 
                ~blocks:fts_idx{ block_id, text | 
                    query: $query, 
                    bind_score: score 
                }
            :order -score
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { query }, {
            workspaceId,
            caps: { maxRows: k }
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] FTS search failed or empty:', result.error);
            return [];
        }

        // Map rows to typed result
        return result.rows.map((row: any) => ({
            blockId: row[0],
            text: row[1],
            score: row[2]
        }));
    }

    /**
     * Search notes using CozoDB's native `regex_matches(content, pattern)`.
     *
     * Scans the `notes` relation and filters rows where `content` matches the
     * provided regex pattern (CozoDB regex syntax — see docs for syntax ref).
     *
     * Returns note id, title, and a 200-char snippet around the first match.
     *
     * @param pattern  Regex pattern string (CozoDB syntax, NOT JS regex)
     * @param limit    Max results (default 10, capped at 50)
     * @param workspaceId  Optional workspace for retrieval logging
     */
    async searchNotesRegex(
        pattern: string,
        limit: number = 10,
        workspaceId?: string
    ): Promise<NoteSearchResult[]> {
        if (!pattern) return [];

        const k = Math.min(limit, 50);

        // Use regex_matches(content, $pattern) to filter notes.
        // regex_extract_first pulls out the matched fragment for snippet context.
        const script = `
            ?[id, title, snippet] :=
                *notes{ id, title, content },
                regex_matches(content, $pattern),
                snippet = if(
                    is_null(regex_extract_first(content, $pattern)),
                    "",
                    regex_extract_first(content, $pattern)
                )
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { pattern }, {
            workspaceId,
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Regex note search failed or empty:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            noteId: row[0],
            title: row[1],
            snippet: String(row[2]).slice(0, 200),
        }));
    }

    /**
     * Search blocks using CozoDB's native `regex_matches(text, pattern)`.
     *
     * Scans the `blocks` relation and returns matching blocks with their
     * note_id for cross-referencing.
     *
     * @param pattern  Regex pattern string (CozoDB syntax)
     * @param limit    Max results (default 10, capped at 50)
     * @param workspaceId  Optional workspace for retrieval logging
     */
    async searchBlocksRegex(
        pattern: string,
        limit: number = 10,
        workspaceId?: string
    ): Promise<BlockSearchResult[]> {
        if (!pattern) return [];

        const k = Math.min(limit, 50);

        const script = `
            ?[block_id, text, score] :=
                *blocks{ block_id, text },
                regex_matches(text, $pattern),
                score = 1.0
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { pattern }, {
            workspaceId,
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Regex block search failed or empty:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            blockId: row[0],
            text: row[1],
            score: row[2],
        }));
    }

    // =========================================================================
    // World-Scoped Queries
    // =========================================================================

    /**
     * FTS search scoped to a single world.
     *
     * Joins `notes` on `world_id` with `blocks:fts_idx` via `note_id`
     * to restrict results to a single world's content.
     *
     * @param worldId  The world to scope to
     * @param query    FTS keywords
     * @param limit    Max results (default 10, capped at 50)
     */
    async searchNotesInWorld(
        worldId: string,
        query: string,
        limit: number = 10,
    ): Promise<NoteSearchResult[]> {
        if (!worldId || !query) return [];

        const k = Math.min(limit, 50);

        const script = `
            ?[note_id, title, text] :=
                ~blocks:fts_idx{ block_id, text |
                    query: $query,
                    bind_score: score
                },
                *blocks{ block_id, note_id },
                *notes{ id: note_id, title, world_id },
                world_id == $world_id
            :order -score
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { world_id: worldId, query }, {
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] World-scoped FTS failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            noteId: row[0],
            title: row[1],
            snippet: String(row[2]).slice(0, 200),
        }));
    }

    // =========================================================================
    // JSON Path Queries (CozoDB get / maybe_get)
    // =========================================================================

    /**
     * Query workspace nodes by extracting a value from their `json` blob.
     *
     * Uses CozoDB's `get(json, $path)` to extract a nested value, optionally
     * filtering to only rows where the extracted value equals `$value`.
     *
     * @param workspaceId  Workspace scope
     * @param jsonPath     Path into the JSON blob (string key or list of keys)
     * @param value        (Optional) Filter: only return nodes where extracted == value
     * @param limit        Max results (default 20, capped at 50)
     */
    async queryWorkspaceNodesJson(
        workspaceId: string,
        jsonPath: string,
        value?: unknown,
        limit: number = 20,
    ): Promise<WsNodeJsonResult[]> {
        if (!workspaceId || !jsonPath) return [];

        const k = Math.min(limit, 50);

        // Build filter clause: either match a specific value or just extract
        const valueFilter = value !== undefined
            ? `, matched == json($value)`
            : '';

        const script = `
            ?[node_id, kind, json_blob, matched] :=
                *ws_node{ workspace_id, node_id, kind, json: json_blob },
                workspace_id == $workspace_id,
                matched = get(json_blob, $path, null),
                not is_null(matched)${valueFilter}
            :limit ${k}
        `;

        const params: Record<string, unknown> = {
            workspace_id: workspaceId,
            path: jsonPath,
        };
        if (value !== undefined) {
            params['value'] = value;
        }

        const result = await this.queryRunner.runRO(script, params, {
            workspaceId,
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] WS node JSON query failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            nodeId: row[0],
            kind: row[1],
            json: row[2] as Record<string, unknown>,
            matchedValue: row[3],
        }));
    }

    /**
     * Query episode_log entries by inspecting a key inside their `payload` JSON.
     *
     * Uses CozoDB's `maybe_get(payload, $key)` which returns null if the key
     * is missing (safe — never errors). Optionally filters by value.
     *
     * @param scopeId      Scope to search within
     * @param payloadKey   Key to extract from the payload JSON
     * @param value        (Optional) Filter: only matching payload values
     * @param limit        Max results (default 20, capped at 50)
     */
    async queryEpisodesByPayload(
        scopeId: string,
        payloadKey: string,
        value?: unknown,
        limit: number = 20,
    ): Promise<EpisodePayloadResult[]> {
        if (!scopeId || !payloadKey) return [];

        const k = Math.min(limit, 50);

        const valueFilter = value !== undefined
            ? `, pval == json($value)`
            : '';

        const script = `
            ?[scope_id, note_id, ts, action_type, pval] :=
                *episode_log{ scope_id, note_id, ts, action_type, payload },
                scope_id == $scope_id,
                pval = maybe_get(payload, $key),
                not is_null(pval)${valueFilter}
            :order -ts
            :limit ${k}
        `;

        const params: Record<string, unknown> = {
            scope_id: scopeId,
            key: payloadKey,
        };
        if (value !== undefined) {
            params['value'] = value;
        }

        const result = await this.queryRunner.runRO(script, params, {
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Episode payload query failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            scopeId: row[0],
            noteId: row[1],
            ts: row[2],
            actionType: row[3],
            payloadValue: row[4],
        }));
    }

    /**
     * Find folders that have a specific key in their `metadata` JSON column.
     *
     * Uses `maybe_get(metadata, $key)` to safely extract a value from the
     * nullable Json metadata field. Scoped by `world_id`.
     *
     * @param worldId   World scope
     * @param metaKey   Key to look for in the metadata JSON
     * @param limit     Max results (default 20, capped at 50)
     */
    async searchFoldersMetadata(
        worldId: string,
        metaKey: string,
        limit: number = 20,
    ): Promise<FolderMetadataResult[]> {
        if (!worldId || !metaKey) return [];

        const k = Math.min(limit, 50);

        const script = `
            ?[id, name, meta_val] :=
                *folders{ id, world_id, name, metadata },
                world_id == $world_id,
                meta_val = maybe_get(metadata, $key),
                not is_null(meta_val)
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, {
            world_id: worldId,
            key: metaKey,
        }, {
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Folder metadata query failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            folderId: row[0],
            name: row[1],
            metaValue: row[2],
        }));
    }

    // =========================================================================
    // Entity Graph Queries (for AppContext)
    // =========================================================================

    /**
     * Get entities scoped to a narrative/world.
     *
     * Queries the `entities` relation filtered by `narrative_id`.
     * Returns entity snapshots suitable for AppContext.nearbyEntities.
     *
     * @param narrativeId  Narrative/world scope
     * @param limit        Max results (default 20, capped at 50)
     */
    async getEntitiesByNarrative(
        narrativeId: string,
        limit: number = 20,
    ): Promise<Array<{ id: string; label: string; kind: string; subtype: string | null }>> {
        if (!narrativeId) return [];

        const k = Math.min(limit, 50);

        const script = `
            ?[id, label, kind, subtype] :=
                *entities{id, label, kind, subtype, narrative_id},
                narrative_id == $narrative_id
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { narrative_id: narrativeId }, {
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Entity by narrative query failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            id: row[0],
            label: row[1],
            kind: row[2],
            subtype: row[3] ?? null,
        }));
    }

    /**
     * Get neighboring entities via entity_edge relationships.
     *
     * Expands one hop from a seed entity, following both outgoing
     * (source_id) and incoming (target_id) edges.
     *
     * @param entityId   Seed entity to expand from
     * @param limit      Max neighbors (default 10, capped at 30)
     */
    async getEntityNeighbors(
        entityId: string,
        limit: number = 10,
    ): Promise<Array<{ id: string; label: string; kind: string; subtype: string | null }>> {
        if (!entityId) return [];

        const k = Math.min(limit, 30);

        const script = `
            # Outgoing edges: entity -> neighbor
            ?[neighbor_id] :=
                *entity_edge{source_id, target_id: neighbor_id},
                source_id == $entity_id

            # Incoming edges: neighbor -> entity
            ?[neighbor_id] :=
                *entity_edge{target_id, source_id: neighbor_id},
                target_id == $entity_id

            # Join with entities to get labels
            ?[id, label, kind, subtype] :=
                neighbor_id,
                *entities{id: neighbor_id, label, kind, subtype}
            :limit ${k}
        `;

        const result = await this.queryRunner.runRO(script, { entity_id: entityId }, {
            caps: { maxRows: k },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Entity neighbors query failed:', result.error);
            return [];
        }

        return result.rows.map((row: any) => ({
            id: row[0],
            label: row[1],
            kind: row[2],
            subtype: row[3] ?? null,
        }));
    }

    /**
     * Get folder ancestor path (breadcrumb).
     *
     * Recursively walks the folder_hierarchy from a leaf folder up to root.
     * Returns array of folder names from leaf to root (excludes leaf).
     *
     * @param folderId   Leaf folder to trace ancestors from
     * @param maxDepth   Maximum recursion depth (default 10, capped at 20)
     */
    async getFolderAncestors(
        folderId: string,
        maxDepth: number = 10,
    ): Promise<string[]> {
        if (!folderId) return [];

        const depth = Math.min(maxDepth, 20);

        // Recursive Datalog query to walk up the folder hierarchy
        const script = `
            # Base case: direct parent
            ancestor[child, parent, depth] :=
                *folder_hierarchy{child, parent},
                child == $folder_id,
                depth = 1

            # Recursive case: parent's parent
            ancestor[child, ancestor_parent, depth] :=
                ancestor[child, parent, prev_depth],
                *folder_hierarchy{child: parent, parent: ancestor_parent},
                depth = prev_depth + 1,
                depth <= ${depth}

            # Get folder names for ancestors
            ?[name, depth] :=
                ancestor[$folder_id, ancestor_id, depth],
                *folders{id: ancestor_id, name}

            :order depth
        `;

        const result = await this.queryRunner.runRO(script, { folder_id: folderId }, {
            caps: { maxRows: depth },
        });

        if (!result.ok || !result.rows) {
            console.warn('[Retrieval] Folder ancestors query failed:', result.error);
            return [];
        }

        // Return names ordered by depth (closest ancestor first)
        return result.rows.map((row: any) => row[0]);
    }
}

