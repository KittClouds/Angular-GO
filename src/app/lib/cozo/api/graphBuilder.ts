import { cozoDb } from '../db';
import { buildCooccurrenceGraph } from '../graph/cooccurrenceBuilder';
import { mergeEdgesAcrossScopes, mergeNotesIntoFolder } from '../graph/scopeMerger';
import { extractCausalLinks } from '../graph/causalLinks';
import type { GraphScope } from '../types';

export interface CooccurrenceConfig {
    enabled: boolean;
    windowSize: number;
    minWeight: number;
    calculatePMI: boolean;
}

export interface CausalConfig {
    enabled: boolean;
    useLLM: boolean;
    llmConfig?: {
        apiKey?: string;
        model?: string;
        endpoint?: string;
    };
}

export interface GraphBuildOptions {
    scope: GraphScope;
    scopeId: string;
    childIds?: string[]; // IDs of notes (for folder scope) or folders (for vault scope)
    cooccurrence: CooccurrenceConfig;
    causal: CausalConfig;
    mergeFromParentScope: boolean;
    onProgress?: (progress: number, step: string) => void;
}

export interface GraphBuildResult {
    edgeCount: number;
    causalLinkCount: number;
    mergedEdgeCount: number;
    duration: number;
}

export async function buildGraph(
    options: GraphBuildOptions
): Promise<GraphBuildResult> {
    const startTime = Date.now();
    let totalEdges = 0;
    let totalCausalLinks = 0;
    let mergedEdges = 0;

    try {
        if (options.cooccurrence.enabled) {
            options.onProgress?.(10, 'Building co-occurrence graph');

            const result = await buildCooccurrenceGraph({
                scope: options.scope,
                scopeId: options.scopeId,
                windowSize: options.cooccurrence.windowSize,
                minWeight: options.cooccurrence.minWeight,
                calculatePMI: options.cooccurrence.calculatePMI,
            });

            totalEdges = result.edgeCount;
            options.onProgress?.(40, `Created ${totalEdges} co-occurrence edges`);
        }

        if (options.causal.enabled) {
            options.onProgress?.(50, 'Extracting causal relationships');

            const result = await extractCausalLinks({
                scope: options.scope,
                scopeId: options.scopeId,
                useLLM: options.causal.useLLM,
                llmConfig: options.causal.llmConfig,
            });

            totalCausalLinks = result.linkCount;
            options.onProgress?.(70, `Extracted ${totalCausalLinks} causal links`);
        }

        if (options.mergeFromParentScope && options.childIds) {
            options.onProgress?.(80, 'Merging edges from child scopes');

            if (options.scope === 'folder') {
                const result = await mergeNotesIntoFolder(options.scopeId, options.childIds);
                mergedEdges = result.newCount;
            } else if (options.scope === 'vault') {
                for (const folderId of options.childIds) {
                    const result = await mergeEdgesAcrossScopes({
                        sourceScope: 'folder',
                        targetScope: 'vault',
                        sourceScopeId: folderId,
                        targetScopeId: 'global',
                        mergeStrategy: 'sum',
                    });
                    mergedEdges += result.newCount;
                }
            }

            options.onProgress?.(90, `Merged ${mergedEdges} edges from child scopes`);
        }

        options.onProgress?.(100, 'Graph building complete');

        return {
            edgeCount: totalEdges,
            causalLinkCount: totalCausalLinks,
            mergedEdgeCount: mergedEdges,
            duration: Date.now() - startTime,
        };
    } catch (err) {
        console.error('Graph building failed:', err);
        throw err;
    }
}

export async function buildNoteGraph(
    noteId: string,
    options?: Partial<Omit<GraphBuildOptions, 'scope' | 'scopeId'>>
): Promise<GraphBuildResult> {
    return buildGraph({
        scope: 'note',
        scopeId: noteId,
        cooccurrence: {
            enabled: true,
            windowSize: 2,
            minWeight: 1,
            calculatePMI: true,
            ...options?.cooccurrence,
        },
        causal: {
            enabled: true,
            useLLM: false,
            ...options?.causal,
        },
        mergeFromParentScope: false,
        onProgress: options?.onProgress,
    });
}


export async function buildFolderGraph(
    folderId: string,
    options?: Partial<Omit<GraphBuildOptions, 'scope' | 'scopeId'>>
): Promise<GraphBuildResult> {
    return buildGraph({
        scope: 'folder',
        scopeId: folderId,
        cooccurrence: {
            enabled: true,
            windowSize: 2,
            minWeight: 1,
            calculatePMI: true,
            ...options?.cooccurrence,
        },
        causal: {
            enabled: true,
            useLLM: false,
            ...options?.causal,
        },
        mergeFromParentScope: options?.mergeFromParentScope ?? true,
        onProgress: options?.onProgress,
    });
}

export async function buildVaultGraph(
    options?: Partial<Omit<GraphBuildOptions, 'scope' | 'scopeId'>>
): Promise<GraphBuildResult> {
    return buildGraph({
        scope: 'vault',
        scopeId: 'global',
        cooccurrence: {
            enabled: true,
            windowSize: 2,
            minWeight: 2,
            calculatePMI: true,
            ...options?.cooccurrence,
        },
        causal: {
            enabled: true,
            useLLM: false,
            ...options?.causal,
        },
        mergeFromParentScope: options?.mergeFromParentScope ?? true,
        onProgress: options?.onProgress,
    });
}

export async function getGraphStats(
    groupId: string
): Promise<{
    entityCount: number;
    edgeCount: number;
    avgDegree: number;
    density: number;
    topEntities: Array<{ id: string; name: string; frequency: number }>;
    topEdges: Array<{ sourceId: string; targetId: string; weight: number }>;
}> {
    try {
        const entityResult = cozoDb.runQuery(`
      ?[id, name, frequency] :=
        *entities{id, name, frequency, group_id}, // table is 'entities'
        group_id == $group_id
      :order -frequency
      :limit 10
    `, { group_id: groupId });

        const edgeResult = cozoDb.runQuery(`
      ?[source_id, target_id, weight] :=
        *entity_edge{source_id, target_id, weight, group_id},
        group_id == $group_id
      :order -weight
      :limit 10
    `, { group_id: groupId });

        const countResult = cozoDb.runQuery(`
      entity_count[count] := count = count(*entities{group_id}, group_id == $group_id)
      edge_count[count] := count = count(*entity_edge{group_id}, group_id == $group_id)
      
      ?[entity_count, edge_count] :=
        entity_count[entity_count],
        edge_count[edge_count]
    `, { group_id: groupId });

        const entityCount = countResult.rows?.[0]?.[0] as number ?? 0;
        const edgeCount = countResult.rows?.[0]?.[1] as number ?? 0;

        const avgDegree = entityCount > 0 ? (2 * edgeCount) / entityCount : 0;
        const density = entityCount > 1
            ? (2 * edgeCount) / (entityCount * (entityCount - 1))
            : 0;

        return {
            entityCount,
            edgeCount,
            avgDegree,
            density,
            topEntities: (entityResult.rows ?? []).map((row: unknown[]) => ({
                id: row[0] as string,
                name: row[1] as string,
                frequency: row[2] as number,
            })),
            topEdges: (edgeResult.rows ?? []).map((row: unknown[]) => ({
                sourceId: row[0] as string,
                targetId: row[1] as string,
                weight: row[2] as number,
            })),
        };
    } catch (err) {
        console.error('Failed to get graph stats:', err);
        return {
            entityCount: 0,
            edgeCount: 0,
            avgDegree: 0,
            density: 0,
            topEntities: [],
            topEdges: [],
        };
    }
}

export async function clearGraphData(
    groupId: string
): Promise<void> {
    try {
        cozoDb.runQuery(`
      ?[id] := *entity_edge{id, group_id}, group_id == $group_id
      :rm entity_edge { id }
    `, { group_id: groupId });

        cozoDb.runQuery(`
      ?[id] := *entities{id}
      :rm entities { id }
    `, { group_id: groupId });

        console.log(`Cleared graph data for scope: ${groupId}`);
    } catch (err) {
        console.error('Failed to clear graph data:', err);
    }
}

