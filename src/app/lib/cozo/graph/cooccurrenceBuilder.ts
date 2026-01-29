import { cozoDb } from '../db';
import type { CozoEntityEdge, GraphScope } from '../types';
import { generateId } from '../utils';

export interface CooccurrenceOptions {
    windowSize: number;
    minWeight: number;
    calculatePMI: boolean;
    scope: GraphScope;
    scopeId: string;
}

export interface CooccurrenceResult {
    edgeCount: number;
    pairCount: number;
}

interface EntityPair {
    entity1Id: string;
    entity2Id: string;
    episodeId: string;
    noteId: string;
    sentenceIndex: number;
}

interface AggregatedEdge {
    sourceId: string;
    targetId: string;
    episodeIds: string[];
    noteIds: Set<string>;
    weight: number;
}

export async function buildCooccurrenceGraph(
    options: CooccurrenceOptions
): Promise<CooccurrenceResult> {
    const groupId = options.scope === 'vault'
        ? 'vault:global'
        : `${options.scope}:${options.scopeId}`;

    const pairs = await extractEntityPairs(groupId, options.windowSize);
    console.log(`Extracted ${pairs.length} entity pairs`);

    const edges = aggregatePairs(pairs, groupId, options.scope);
    console.log(`Aggregated into ${edges.length} unique edges`);

    const filteredEdges = edges.filter(e => e.weight >= options.minWeight);
    console.log(`${filteredEdges.length} edges after weight filtering`);

    if (options.calculatePMI) {
        await calculatePMIScores(filteredEdges, groupId);
    }

    await insertCooccurrenceEdges(filteredEdges);

    return {
        edgeCount: filteredEdges.length,
        pairCount: pairs.length,
    };
}

async function extractEntityPairs(
    groupId: string,
    windowSize: number
): Promise<EntityPair[]> {
    const query = `
    entity_pairs[e1_id, e2_id, episode_id, note_id, sent_idx] :=
      *mentions{episode_id, entity_id: e1_id, sentence_index: s1},
      *mentions{episode_id, entity_id: e2_id, sentence_index: s2},
      e1_id < e2_id,
      s1 != null,
      s2 != null,
      abs(s1 - s2) <= $window_size,
      *episode{id: episode_id, note_id, group_id},
      group_id == $group_id,
      sent_idx = min(s1, s2)

    ?[e1_id, e2_id, episode_id, note_id, sent_idx] :=
      entity_pairs[e1_id, e2_id, episode_id, note_id, sent_idx]
  `;

    try {
        const result = cozoDb.runQuery(query, {
            group_id: groupId,
            window_size: Math.max(0, windowSize - 1),
        });

        if (!result.rows) return [];

        return result.rows.map((row: unknown[]) => ({
            entity1Id: row[0] as string,
            entity2Id: row[1] as string,
            episodeId: row[2] as string,
            noteId: row[3] as string,
            sentenceIndex: row[4] as number,
        }));
    } catch (err) {
        console.error('Failed to extract entity pairs:', err);
        return [];
    }
}

function aggregatePairs(
    pairs: EntityPair[],
    groupId: string,
    scope: GraphScope
): CozoEntityEdge[] {
    const pairMap = new Map<string, AggregatedEdge>();

    for (const pair of pairs) {
        const key = `${pair.entity1Id}:${pair.entity2Id}`;

        if (!pairMap.has(key)) {
            pairMap.set(key, {
                sourceId: pair.entity1Id,
                targetId: pair.entity2Id,
                episodeIds: [],
                noteIds: new Set(),
                weight: 0,
            });
        }

        const aggregate = pairMap.get(key)!;
        aggregate.episodeIds.push(pair.episodeId);
        aggregate.noteIds.add(pair.noteId);
        aggregate.weight += 1;
    }

    return Array.from(pairMap.values()).map(agg => ({
        id: generateId(),
        sourceId: agg.sourceId,
        targetId: agg.targetId,
        createdAt: new Date(),
        validAt: new Date(),
        groupId,
        scopeType: scope,
        edgeType: 'CO_OCCURS',
        episodeIds: agg.episodeIds,
        noteIds: Array.from(agg.noteIds),
        weight: agg.weight,
        confidence: 1.0,
        extractionMethods: ['cooccurrence'],
    }));
}

async function calculatePMIScores(
    edges: CozoEntityEdge[],
    groupId: string
): Promise<void> {
    const freqQuery = `
    ?[entity_id, frequency] :=
      *entity{id: entity_id, frequency, group_id},
      group_id == $group_id
  `;

    try {
        const freqResult = cozoDb.runQuery(freqQuery, { group_id: groupId });

        if (!freqResult.rows) return;

        const frequencies = new Map<string, number>(
            freqResult.rows.map((row: unknown[]) => [row[0] as string, row[1] as number])
        );

        const totalPairs = edges.reduce((sum, e) => sum + e.weight, 0);
        if (totalPairs === 0) return;

        for (const edge of edges) {
            const freqA = frequencies.get(edge.sourceId) || 1;
            const freqB = frequencies.get(edge.targetId) || 1;
            const cooccurFreq = edge.weight;

            const pAB = cooccurFreq / totalPairs;
            const pA = freqA / totalPairs;
            const pB = freqB / totalPairs;

            if (pA > 0 && pB > 0 && pAB > 0) {
                const pmi = Math.log(pAB / (pA * pB));
                edge.pmiScore = pmi;
            }
        }
    } catch (err) {
        console.error('Failed to calculate PMI scores:', err);
    }
}

async function insertCooccurrenceEdges(edges: CozoEntityEdge[]): Promise<void> {
    if (edges.length === 0) return;

    for (const edge of edges) {
        try {
            const query = `
        ?[id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, episode_ids, note_ids, weight, pmi_score, confidence,
          extraction_methods] <- [[
            $id, $source_id, $target_id, $created_at, $valid_at, $group_id, $scope_type,
            $edge_type, $episode_ids, $note_ids, $weight, $pmi_score, $confidence,
            $extraction_methods
          ]]

        :put entity_edge {
          id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, episode_ids, note_ids, weight, pmi_score, confidence,
          extraction_methods
        }
      `;

            cozoDb.runQuery(query, {
                id: edge.id,
                source_id: edge.sourceId,
                target_id: edge.targetId,
                created_at: edge.createdAt.getTime(),
                valid_at: edge.validAt.getTime(),
                group_id: edge.groupId,
                scope_type: edge.scopeType,
                edge_type: edge.edgeType,
                episode_ids: edge.episodeIds,
                note_ids: edge.noteIds,
                weight: edge.weight,
                pmi_score: edge.pmiScore ?? null,
                confidence: edge.confidence,
                extraction_methods: edge.extractionMethods,
            });
        } catch (err) {
            console.error('Failed to insert edge:', err);
        }
    }
}

export async function getCooccurrenceEdges(
    groupId: string,
    minWeight: number = 1,
    minPMI?: number
): Promise<CozoEntityEdge[]> {
    let query = `
    ?[id, source_id, target_id, weight, pmi_score, episode_ids, note_ids] :=
      *entity_edge{id, source_id, target_id, group_id, edge_type, weight, pmi_score, episode_ids, note_ids},
      group_id == $group_id,
      edge_type == "CO_OCCURS",
      weight >= $min_weight
  `;

    if (minPMI !== undefined) {
        query += `,\n      pmi_score >= $min_pmi`;
    }

    query += '\n    :order -weight';

    try {
        const result = cozoDb.runQuery(query, {
            group_id: groupId,
            min_weight: minWeight,
            min_pmi: minPMI ?? 0,
        });

        if (!result.rows) return [];

        return result.rows.map((row: unknown[]) => ({
            id: row[0] as string,
            sourceId: row[1] as string,
            targetId: row[2] as string,
            weight: row[3] as number,
            pmiScore: row[4] as number | undefined,
            episodeIds: row[5] as string[],
            noteIds: row[6] as string[],
            createdAt: new Date(),
            validAt: new Date(),
            groupId,
            scopeType: 'note' as GraphScope,
            edgeType: 'CO_OCCURS',
            confidence: 1.0,
            extractionMethods: ['cooccurrence'],
        }));
    } catch (err) {
        console.error('Failed to get co-occurrence edges:', err);
        return [];
    }
}
