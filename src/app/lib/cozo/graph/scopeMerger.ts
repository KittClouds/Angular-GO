import { cozoDb } from '../db';
import type { GraphScope } from '../types';
import { generateId } from '../utils';

export type MergeStrategy = 'sum' | 'average' | 'max';

export interface MergeOptions {
    sourceScope: 'note' | 'folder';
    targetScope: 'folder' | 'vault';
    sourceScopeId: string;
    targetScopeId: string;
    mergeStrategy: MergeStrategy;
}

export interface MergeResult {
    mergedCount: number;
    newCount: number;
}

interface SourceEdge {
    sourceId: string;
    targetId: string;
    weight: number;
    pmiScore: number | null;
    episodeIds: string[];
    noteIds: string[];
}

interface AggregatedEdge {
    sourceId: string;
    targetId: string;
    weights: number[];
    pmiScores: number[];
    episodeIds: Set<string>;
    noteIds: Set<string>;
}

export async function mergeEdgesAcrossScopes(
    options: MergeOptions
): Promise<MergeResult> {
    const sourceGroupId = `${options.sourceScope}:${options.sourceScopeId}`;
    const targetGroupId = options.targetScope === 'vault'
        ? 'vault:global'
        : `${options.targetScope}:${options.targetScopeId}`;

    try {
        const sourceEdges = await getSourceEdges(sourceGroupId);
        console.log(`Found ${sourceEdges.length} edges in source scope`);

        if (sourceEdges.length === 0) {
            return { mergedCount: 0, newCount: 0 };
        }

        const entityMappings = await mapEntitiesToTargetScope(
            sourceEdges,
            sourceGroupId,
            targetGroupId,
            options.targetScope
        );

        const mergedEdges = aggregateEdgesForTarget(
            sourceEdges,
            entityMappings,
            targetGroupId,
            options.targetScope,
            options.mergeStrategy
        );

        console.log(`Aggregated into ${mergedEdges.length} edges for target scope`);

        await upsertTargetEdges(mergedEdges, targetGroupId, options.targetScope);

        return {
            mergedCount: sourceEdges.length,
            newCount: mergedEdges.length,
        };
    } catch (err) {
        console.error('Failed to merge edges across scopes:', err);
        return { mergedCount: 0, newCount: 0 };
    }
}

async function getSourceEdges(sourceGroupId: string): Promise<SourceEdge[]> {
    const result = cozoDb.runQuery(`
    ?[source_id, target_id, weight, pmi_score, episode_ids, note_ids] :=
      *entity_edge{source_id, target_id, weight, pmi_score, episode_ids, note_ids, group_id},
      group_id == $source_group_id
  `, { source_group_id: sourceGroupId });

    if (!result.rows) return [];

    return result.rows.map((row: unknown[]) => ({
        sourceId: row[0] as string,
        targetId: row[1] as string,
        weight: row[2] as number,
        pmiScore: row[3] as number | null,
        episodeIds: row[4] as string[],
        noteIds: row[5] as string[],
    }));
}

async function mapEntitiesToTargetScope(
    sourceEdges: SourceEdge[],
    sourceGroupId: string,
    targetGroupId: string,
    targetScope: string
): Promise<Map<string, string>> {
    const entityIds = new Set<string>();
    for (const edge of sourceEdges) {
        entityIds.add(edge.sourceId);
        entityIds.add(edge.targetId);
    }

    const sourceEntitiesResult = cozoDb.runQuery(`
    ?[id, name, entity_kind, entity_subtype] :=
      *entity{id, name, entity_kind, entity_subtype, group_id},
      group_id == $source_group_id
  `, { source_group_id: sourceGroupId });

    if (!sourceEntitiesResult.rows) return new Map();

    const mappings = new Map<string, string>();

    for (const row of sourceEntitiesResult.rows) {
        const sourceId = row[0] as string;
        const name = row[1] as string;
        const kind = row[2] as string;
        const subtype = row[3] as string | null;

        if (!entityIds.has(sourceId)) continue;

        const targetResult = cozoDb.runQuery(`
      ?[id] :=
        *entity{id, name, entity_kind, group_id},
        name == $name,
        entity_kind == $kind,
        group_id == $target_group_id
    `, {
            name,
            kind,
            target_group_id: targetGroupId,
        });

        if (targetResult.rows && targetResult.rows.length > 0) {
            mappings.set(sourceId, targetResult.rows[0][0] as string);
        } else {
            const newId = generateId();

            cozoDb.runQuery(`
        ?[id, name, entity_kind, entity_subtype, group_id, scope_type, created_at,
          extraction_method, aliases, frequency, participants] <- [[
            $id, $name, $kind, $subtype, $group_id, $scope_type, $created_at,
            "merged", [], 0, []
          ]]

        :put entity {
          id, name, entity_kind, entity_subtype, group_id, scope_type,
          created_at, extraction_method, aliases, frequency, participants
        }
      `, {
                id: newId,
                name,
                kind,
                subtype,
                group_id: targetGroupId,
                scope_type: targetScope,
                created_at: Date.now(),
            });

            mappings.set(sourceId, newId);
        }
    }

    return mappings;
}

function aggregateEdgesForTarget(
    sourceEdges: SourceEdge[],
    entityMappings: Map<string, string>,
    targetGroupId: string,
    targetScope: string,
    mergeStrategy: MergeStrategy
): Array<{
    sourceId: string;
    targetId: string;
    weight: number;
    pmiScore: number | null;
    episodeIds: string[];
    noteIds: string[];
    groupId: string;
    scopeType: string;
}> {
    const edgeMap = new Map<string, AggregatedEdge>();

    for (const edge of sourceEdges) {
        const mappedSrc = entityMappings.get(edge.sourceId);
        const mappedTgt = entityMappings.get(edge.targetId);

        if (!mappedSrc || !mappedTgt) continue;

        const [src, tgt] = mappedSrc < mappedTgt
            ? [mappedSrc, mappedTgt]
            : [mappedTgt, mappedSrc];

        const key = `${src}:${tgt}`;

        if (!edgeMap.has(key)) {
            edgeMap.set(key, {
                sourceId: src,
                targetId: tgt,
                weights: [],
                pmiScores: [],
                episodeIds: new Set(),
                noteIds: new Set(),
            });
        }

        const agg = edgeMap.get(key)!;
        agg.weights.push(edge.weight);
        if (edge.pmiScore !== null) agg.pmiScores.push(edge.pmiScore);
        edge.episodeIds.forEach(id => agg.episodeIds.add(id));
        edge.noteIds.forEach(id => agg.noteIds.add(id));
    }

    return Array.from(edgeMap.values()).map(agg => {
        let finalWeight: number;

        if (mergeStrategy === 'sum') {
            finalWeight = agg.weights.reduce((sum, w) => sum + w, 0);
        } else if (mergeStrategy === 'average') {
            finalWeight = agg.weights.reduce((sum, w) => sum + w, 0) / agg.weights.length;
        } else {
            finalWeight = Math.max(...agg.weights);
        }

        const avgPMI = agg.pmiScores.length > 0
            ? agg.pmiScores.reduce((sum, p) => sum + p, 0) / agg.pmiScores.length
            : null;

        return {
            sourceId: agg.sourceId,
            targetId: agg.targetId,
            weight: Math.round(finalWeight),
            pmiScore: avgPMI,
            episodeIds: Array.from(agg.episodeIds),
            noteIds: Array.from(agg.noteIds),
            groupId: targetGroupId,
            scopeType: targetScope,
        };
    });
}

async function upsertTargetEdges(
    edges: Array<{
        sourceId: string;
        targetId: string;
        weight: number;
        pmiScore: number | null;
        episodeIds: string[];
        noteIds: string[];
        groupId: string;
        scopeType: string;
    }>,
    targetGroupId: string,
    targetScope: string
): Promise<void> {
    for (const edge of edges) {
        const existingResult = cozoDb.runQuery(`
      ?[id, weight, episode_ids, note_ids] :=
        *entity_edge{id, source_id, target_id, weight, episode_ids, note_ids, group_id},
        source_id == $source_id,
        target_id == $target_id,
        group_id == $group_id
    `, {
            source_id: edge.sourceId,
            target_id: edge.targetId,
            group_id: targetGroupId,
        });

        if (existingResult.rows && existingResult.rows.length > 0) {
            const [existingId, existingWeight, existingEpisodes, existingNotes] = existingResult.rows[0];

            const mergedEpisodes = [...new Set([...(existingEpisodes as string[]), ...edge.episodeIds])];
            const mergedNotes = [...new Set([...(existingNotes as string[]), ...edge.noteIds])];

            cozoDb.runQuery(`
        ?[id, weight, episode_ids, note_ids] <- [[
          $id, $weight, $episode_ids, $note_ids
        ]]

        :update entity_edge { id => weight, episode_ids, note_ids }
      `, {
                id: existingId,
                weight: (existingWeight as number) + edge.weight,
                episode_ids: mergedEpisodes,
                note_ids: mergedNotes,
            });
        } else {
            cozoDb.runQuery(`
        ?[id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, weight, pmi_score, episode_ids, note_ids, confidence,
          extraction_methods] <- [[
            $id, $source_id, $target_id, $created_at, $valid_at, $group_id, $scope_type,
            "CO_OCCURS", $weight, $pmi_score, $episode_ids, $note_ids, 1.0, ["merged"]
          ]]

        :put entity_edge {
          id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, weight, pmi_score, episode_ids, note_ids, confidence,
          extraction_methods
        }
      `, {
                id: generateId(),
                source_id: edge.sourceId,
                target_id: edge.targetId,
                created_at: Date.now(),
                valid_at: Date.now(),
                group_id: targetGroupId,
                scope_type: targetScope,
                weight: edge.weight,
                pmi_score: edge.pmiScore,
                episode_ids: edge.episodeIds,
                note_ids: edge.noteIds,
            });
        }
    }
}

export async function mergeNotesIntoFolder(
    folderId: string,
    noteIds: string[]
): Promise<MergeResult> {
    if (noteIds.length === 0) {
        return { mergedCount: 0, newCount: 0 };
    }

    let totalMerged = 0;
    let totalNew = 0;

    for (const noteId of noteIds) {
        const result = await mergeEdgesAcrossScopes({
            sourceScope: 'note',
            targetScope: 'folder',
            sourceScopeId: noteId,
            targetScopeId: folderId,
            mergeStrategy: 'sum',
        });

        totalMerged += result.mergedCount;
        totalNew += result.newCount;
    }

    return { mergedCount: totalMerged, newCount: totalNew };
}


export async function mergeFoldersIntoVault(
    folderIds: string[]
): Promise<MergeResult> {
    if (folderIds.length === 0) {
        return { mergedCount: 0, newCount: 0 };
    }

    let totalMerged = 0;
    let totalNew = 0;

    for (const folderId of folderIds) {
        const result = await mergeEdgesAcrossScopes({
            sourceScope: 'folder',
            targetScope: 'vault',
            sourceScopeId: folderId,
            targetScopeId: 'global',
            mergeStrategy: 'sum',
        });

        totalMerged += result.mergedCount;
        totalNew += result.newCount;
    }

    return { mergedCount: totalMerged, newCount: totalNew };
}
