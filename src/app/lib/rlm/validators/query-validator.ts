/**
 * Query Validators for RLM Two-Lane Execution
 *
 * Provides validation for Read-Only (RO) and Workspace (WS) query lanes.
 * Ensures model-authored Cozo queries stay within safe boundaries.
 */

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    error?: string;
    warnings?: string[];
    detectedType?: 'ro' | 'ws' | 'mixed' | 'unknown';
}

export interface QueryCaps {
    maxRuntimeMs: number;
    maxRows: number;
    maxOutputBytes: number;
    requireLimit: boolean;
}

export const DEFAULT_RO_CAPS: QueryCaps = {
    maxRuntimeMs: 5000,
    maxRows: 1000,
    maxOutputBytes: 1_000_000, // 1MB
    requireLimit: true,
};

export const DEFAULT_WS_CAPS: QueryCaps = {
    maxRuntimeMs: 10000,
    maxRows: 5000,
    maxOutputBytes: 5_000_000, // 5MB
    requireLimit: false,
};

// ============================================================================
// Patterns
// ============================================================================

/**
 * Mutation keywords in CozoScript
 */
const MUTATION_PATTERNS = [
    /:put\s+/i,
    /:rm\s+/i,
    /:update\s+/i,
    /:replace\s+/i,
    /:create\s+/i,
    /::create\s+/i,
    /::index\s+/i,
    /::hnsw\s+/i,
    /::fts\s+/i,
];

/**
 * Workspace relation patterns
 */
const WS_RELATION_PATTERN = /^\s*ws_(session|node|edge|view_cache|metric)\s*$/;

/**
 * Canonical relation patterns (non-workspace)
 */
const CANONICAL_RELATIONS = [
    'entities', 'entity_aliases', 'entity_mentions', 'entity_metadata',
    'entity_edge', 'relationship_provenance', 'relationship_attributes',
    'notes', 'folders', 'tags', 'note_tags',
    'blocks', 'episode_log',
    'spans', 'wormholes', 'span_mentions',
    'node_vectors', 'entity_clusters', 'cluster_members', 'cooccurrence_edges',
    'folder_hierarchy', 'network_instance', 'network_membership', 'network_relationship',
    'discovery_candidates', 'folder_schemas', 'entity_cards',
    'fact_sheet_card_schemas', 'fact_sheet_field_schemas',
];

/**
 * Indexed query patterns (FTS, HNSW) that don't require :limit
 */
const INDEXED_QUERY_PATTERNS = [
    /~\w+:\w+\s*\{[^}]*\|\s*query\s*:/i,      // FTS: ~relation:index { ... | query: ... }
    /~\w+:\w+\s*\{[^}]*\|\s*query_vec\s*:/i,  // HNSW: ~relation:index { ... | query_vec: ... }
    /~\w+:\w+\s*\{[^}]*k\s*:/i,               // HNSW with k parameter
    /~\w+:\w+\s*\{/i,                         // Generic indexed query start
];

// ============================================================================
// Validators
// ============================================================================

/**
 * Detect if a script contains mutations
 */
export function detectMutations(script: string): boolean {
    return MUTATION_PATTERNS.some(pattern => pattern.test(script));
}

/**
 * Extract target relations from mutation statements
 */
export function extractMutationTargets(script: string): string[] {
    const targets: string[] = [];

    // Match :put relation, :rm relation, :update relation, :replace relation
    const patterns = [
        { regex: /:put\s+(\w+)/gi, prefix: /:put\s+/i },
        { regex: /:rm\s+(\w+)/gi, prefix: /:rm\s+/i },
        { regex: /:update\s+(\w+)/gi, prefix: /:update\s+/i },
        { regex: /:replace\s+(\w+)/gi, prefix: /:replace\s+/i },
    ];

    for (const { regex, prefix } of patterns) {
        const matches = script.match(regex);
        if (matches) {
            matches.forEach(m => {
                const rel = m.replace(prefix, '').trim();
                targets.push(rel);
            });
        }
    }

    return [...new Set(targets)];
}

/**
 * Check if query uses indexed operators (FTS, HNSW)
 */
export function isIndexedQuery(script: string): boolean {
    return INDEXED_QUERY_PATTERNS.some(pattern => pattern.test(script));
}

/**
 * Check if query has :limit clause
 */
export function hasLimitClause(script: string): boolean {
    // Check for :limit at the end of query or before next clause
    return /:limit\s+\d+/i.test(script) || /:limit\s+\$\w+/i.test(script);
}

/**
 * Validate Read-Only (RO) query
 * 
 * Rules:
 * - No mutations allowed
 * - Must have :limit for non-indexed queries
 * - Cannot modify any relations
 */
export function validateRO(script: string, caps: QueryCaps = DEFAULT_RO_CAPS): ValidationResult {
    const warnings: string[] = [];

    // Check for mutations
    if (detectMutations(script)) {
        return {
            valid: false,
            error: 'Mutations not allowed in RO mode. Use RunWS for workspace mutations.',
            detectedType: 'mixed',
        };
    }

    // Check for :limit requirement
    if (caps.requireLimit && !hasLimitClause(script) && !isIndexedQuery(script)) {
        return {
            valid: false,
            error: 'Non-indexed queries require :limit clause for safety.',
            warnings,
            detectedType: 'ro',
        };
    }

    // Warn about potentially expensive operations
    if (script.includes('*') && !script.includes(':limit')) {
        warnings.push('Query uses full scan without explicit limit - may be slow on large datasets');
    }

    return {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
        detectedType: 'ro',
    };
}

/**
 * Validate Workspace (WS) mutation query
 * 
 * Rules:
 * - Only ws_* relations can be mutated
 * - Cannot mutate canonical relations
 * - Schema modifications not allowed
 */
export function validateWS(script: string, caps: QueryCaps = DEFAULT_WS_CAPS): ValidationResult {
    const warnings: string[] = [];

    // Check for schema modifications
    if (/:create\s+/i.test(script) || /::index\s+/i.test(script) || /::hnsw\s+/i.test(script) || /::fts\s+/i.test(script)) {
        return {
            valid: false,
            error: 'Schema modifications not allowed in WS mode.',
            detectedType: 'unknown',
        };
    }

    // Extract mutation targets
    const targets = extractMutationTargets(script);

    if (targets.length === 0) {
        // No mutations found - could be a RO query in WS context
        warnings.push('No mutations detected in WS mode - consider using RO mode for read-only queries');
        return {
            valid: true,
            warnings,
            detectedType: 'ro',
        };
    }

    // Check each target is a workspace relation
    for (const target of targets) {
        if (!target.startsWith('ws_')) {
            return {
                valid: false,
                error: `Cannot mutate non-workspace relation: ${target}. Only ws_* relations are mutable in WS mode.`,
                detectedType: 'mixed',
            };
        }
    }

    // Verify workspace relation names are valid
    for (const target of targets) {
        if (!WS_RELATION_PATTERN.test(target)) {
            return {
                valid: false,
                error: `Unknown workspace relation: ${target}. Valid relations: ws_session, ws_node, ws_edge, ws_view_cache, ws_metric`,
                detectedType: 'ws',
            };
        }
    }

    return {
        valid: true,
        warnings: warnings.length > 0 ? warnings : undefined,
        detectedType: 'ws',
    };
}

/**
 * Auto-detect query type and validate accordingly
 */
export function validateAuto(script: string): ValidationResult & { suggestedLane: 'ro' | 'ws' } {
    const hasMutations = detectMutations(script);

    if (hasMutations) {
        const wsResult = validateWS(script);
        return {
            ...wsResult,
            suggestedLane: 'ws',
        };
    } else {
        const roResult = validateRO(script);
        return {
            ...roResult,
            suggestedLane: 'ro',
        };
    }
}

/**
 * Check if a script is safe to execute (either RO or WS valid)
 */
export function isSafeScript(script: string): boolean {
    const roResult = validateRO(script);
    if (roResult.valid) return true;

    const wsResult = validateWS(script);
    return wsResult.valid;
}
