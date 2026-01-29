import { cozoDb } from '../db';
import type { CozoEntityEdge, GraphScope } from '../types';
import { generateId } from '../utils';

export type WindowType = 'sentence' | 'word' | 'paragraph';

export interface WindowOptions {
    windowType: WindowType;
    windowSize: number;
    distanceWeight: boolean;
    scope: GraphScope;
    scopeId: string;
}

export interface WindowCooccurrenceResult {
    edgeCount: number;
}

interface MentionWithPosition {
    entityId: string;
    episodeId: string;
    charPosition: number;
    episodeText: string;
}

export async function buildWindowCooccurrenceGraph(
    options: WindowOptions
): Promise<WindowCooccurrenceResult> {
    const groupId = options.scope === 'vault'
        ? 'vault:global'
        : `${options.scope}:${options.scopeId}`;

    if (options.windowType === 'word') {
        return buildWordWindowGraph(groupId, options);
    } else if (options.windowType === 'paragraph') {
        return buildParagraphWindowGraph(groupId, options);
    } else {
        // Dynamic import to avoid circular dependency if possible, or just statically import
        // Since we are writing both files, static import is fine unless circularity is an issue.
        // cooccurrenceBuilder imports this? No, graphBuilder imports both.
        const { buildCooccurrenceGraph } = await import('./cooccurrenceBuilder');
        const result = await buildCooccurrenceGraph({
            windowSize: options.windowSize,
            minWeight: 1,
            calculatePMI: true,
            scope: options.scope,
            scopeId: options.scopeId,
        });
        return { edgeCount: result.edgeCount };
    }
}

async function buildWordWindowGraph(
    groupId: string,
    options: WindowOptions
): Promise<WindowCooccurrenceResult> {
    const query = `
    ?[entity_id, episode_id, char_position, episode_text] :=
      *mentions{entity_id, episode_id, char_position},
      char_position != null,
      *episode{id: episode_id, content_text: episode_text, group_id},
      group_id == $group_id

    :order episode_id, char_position
  `;

    try {
        const result = cozoDb.runQuery(query, { group_id: groupId });

        if (!result.rows || result.rows.length === 0) {
            return { edgeCount: 0 };
        }

        const episodeMentions = new Map<string, MentionWithPosition[]>();

        for (const row of result.rows) {
            const mention: MentionWithPosition = {
                entityId: row[0] as string,
                episodeId: row[1] as string,
                charPosition: row[2] as number,
                episodeText: row[3] as string,
            };

            if (!episodeMentions.has(mention.episodeId)) {
                episodeMentions.set(mention.episodeId, []);
            }
            episodeMentions.get(mention.episodeId)!.push(mention);
        }

        const edges: CozoEntityEdge[] = [];

        for (const [episodeId, mentions] of episodeMentions) {
            for (let i = 0; i < mentions.length; i++) {
                for (let j = i + 1; j < mentions.length; j++) {
                    const m1 = mentions[i];
                    const m2 = mentions[j];

                    if (m1.entityId === m2.entityId) continue;

                    const wordDistance = calculateWordDistance(
                        m1.episodeText,
                        m1.charPosition,
                        m2.charPosition
                    );

                    if (wordDistance <= options.windowSize) {
                        const weight = options.distanceWeight
                            ? Math.max(1, options.windowSize - wordDistance + 1)
                            : 1;

                        const [sourceId, targetId] = m1.entityId < m2.entityId
                            ? [m1.entityId, m2.entityId]
                            : [m2.entityId, m1.entityId];

                        edges.push({
                            id: generateId(),
                            sourceId,
                            targetId,
                            createdAt: new Date(),
                            validAt: new Date(),
                            groupId,
                            scopeType: options.scope,
                            edgeType: 'CO_OCCURS',
                            episodeIds: [episodeId],
                            noteIds: [],
                            weight,
                            confidence: 1.0,
                            extractionMethods: ['window_cooccurrence'],
                        });
                    }
                }
            }
        }

        const aggregated = aggregateEdges(edges, groupId, options.scope);
        await insertEdges(aggregated);

        return { edgeCount: aggregated.length };
    } catch (err) {
        console.error('Failed to build word window graph:', err);
        return { edgeCount: 0 };
    }
}

function calculateWordDistance(
    text: string,
    pos1: number,
    pos2: number
): number {
    const start = Math.min(pos1, pos2);
    const end = Math.max(pos1, pos2);
    const substring = text.slice(start, end);
    return substring.split(/\s+/).filter(Boolean).length;
}

function aggregateEdges(
    edges: CozoEntityEdge[],
    groupId: string,
    scope: GraphScope
): CozoEntityEdge[] {
    const edgeMap = new Map<string, CozoEntityEdge>();

    for (const edge of edges) {
        const key = `${edge.sourceId}:${edge.targetId}`;

        if (!edgeMap.has(key)) {
            edgeMap.set(key, { ...edge, episodeIds: [...edge.episodeIds], noteIds: [...edge.noteIds] });
        } else {
            const existing = edgeMap.get(key)!;
            existing.weight += edge.weight;
            existing.episodeIds.push(...edge.episodeIds);
            existing.noteIds.push(...edge.noteIds);
        }
    }

    return Array.from(edgeMap.values()).map(edge => ({
        ...edge,
        episodeIds: [...new Set(edge.episodeIds)],
        noteIds: [...new Set(edge.noteIds)],
    }));
}

async function buildParagraphWindowGraph(
    groupId: string,
    options: WindowOptions
): Promise<WindowCooccurrenceResult> {
    const query = `
    entity_pairs[e1_id, e2_id, episode_id] :=
      *mentions{episode_id, entity_id: e1_id, paragraph_index: p1},
      *mentions{episode_id, entity_id: e2_id, paragraph_index: p2},
      e1_id < e2_id,
      p1 != null,
      p2 != null,
      p1 == p2,
      *episode{id: episode_id, group_id},
      group_id == $group_id

    ?[e1_id, e2_id, episode_id] := entity_pairs[e1_id, e2_id, episode_id]
  `;

    try {
        const result = cozoDb.runQuery(query, { group_id: groupId });

        if (!result.rows || result.rows.length === 0) {
            return { edgeCount: 0 };
        }

        const edges: CozoEntityEdge[] = result.rows.map((row: unknown[]) => ({
            id: generateId(),
            sourceId: row[0] as string,
            targetId: row[1] as string,
            createdAt: new Date(),
            validAt: new Date(),
            groupId,
            scopeType: options.scope,
            edgeType: 'CO_OCCURS',
            episodeIds: [row[2] as string],
            noteIds: [],
            weight: 1,
            confidence: 1.0,
            extractionMethods: ['paragraph_cooccurrence'],
        }));

        const aggregated = aggregateEdges(edges, groupId, options.scope);
        await insertEdges(aggregated);

        return { edgeCount: aggregated.length };
    } catch (err) {
        console.error('Failed to build paragraph window graph:', err);
        return { edgeCount: 0 };
    }
}

async function insertEdges(edges: CozoEntityEdge[]): Promise<void> {
    if (edges.length === 0) return;

    for (const edge of edges) {
        try {
            cozoDb.runQuery(`
        ?[id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, episode_ids, note_ids, weight, confidence, extraction_methods] <- [[
            $id, $source_id, $target_id, $created_at, $valid_at, $group_id, $scope_type,
            $edge_type, $episode_ids, $note_ids, $weight, $confidence, $extraction_methods
          ]]

        :put entity_edge {
          id, source_id, target_id, created_at, valid_at, group_id, scope_type,
          edge_type, episode_ids, note_ids, weight, confidence, extraction_methods
        }
      `, {
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
                confidence: edge.confidence,
                extraction_methods: edge.extractionMethods,
            });
        } catch (err) {
            console.error('Failed to insert edge:', err);
        }
    }
}
