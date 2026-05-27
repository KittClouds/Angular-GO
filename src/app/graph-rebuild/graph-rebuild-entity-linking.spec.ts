import { describe, expect, it } from 'vitest';

import { buildGraphRebuildEntityLinkSuggestions } from './graph-rebuild-entity-linking';
import { buildGraphRebuildStructuralPostProcess } from './graph-rebuild-structural-postprocess';
import type {
    GraphRebuildEdge,
    GraphRebuildEntityAnchor,
    GraphRebuildMention,
    GraphRebuildNode,
} from './graph-rebuild-snapshot';

describe('graph rebuild entity linking', () => {
    it('suggests alias and unresolved mention links from indexed surfaces', () => {
        const anchors = [
            anchor('a-kai', 'e-kai', 'Kai'),
            anchor('a-kai-rowan', 'e-kai', 'Kai Rowan'),
            anchor('a-rowan', 'e-rowan', 'Rowan'),
        ];
        const nodes = [
            node('e-kai', 'Kai', 'CHARACTER', ['K']),
            node('e-rowan', 'Rowan', 'CHARACTER', []),
            node('e-nemo', 'Nemo', 'NETWORK', []),
        ];
        const mentions = [
            ...anchors,
            mention('m-nemo', 'Nemo', 'dropped', 42, 46),
            mention('m-unknown', 'Silver Door', 'dropped', 60, 71),
        ];

        const result = buildGraphRebuildEntityLinkSuggestions({
            mentions,
            entityAnchors: anchors,
            nodes,
            edges: [edge('e-kai', 'e-rowan', 2)],
            structuralPostProcess: buildGraphRebuildStructuralPostProcess(nodes, [edge('e-kai', 'e-rowan', 2)]),
        });

        expect(result.suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({ decision: 'alias_of', surface: 'Kai Rowan', candidateEntityId: 'e-kai' }),
            expect.objectContaining({ decision: 'same_entity', surface: 'Nemo', candidateEntityId: 'e-nemo' }),
            expect.objectContaining({ decision: 'new_entity', surface: 'Silver Door' }),
        ]));
        expect(result.counters).toMatchObject({
            candidateMentions: 2,
            aliasOf: 1,
            newEntity: 1,
        });
    });

    it('keeps candidate output bounded and deterministic for heavy batches', () => {
        const nodes = Array.from({ length: 80 }, (_, index) =>
            node(`e-${index}`, `Entity ${index}`, index % 3 === 0 ? 'NETWORK' : 'CHARACTER', []));
        const anchors = nodes.map((row, index) => anchor(`a-${index}`, row.id, row.label));
        const mentions = [
            ...anchors,
            ...Array.from({ length: 320 }, (_, index) =>
                mention(`m-${index}`, index % 5 === 0 ? 'Unknown Surface' : `Entity ${index % 80}`, 'dropped', index * 3, index * 3 + 2)),
        ];
        const edges = nodes.slice(1).map((row, index) => edge(nodes[index].id, row.id, 1));

        const first = buildGraphRebuildEntityLinkSuggestions({
            mentions,
            entityAnchors: anchors,
            nodes,
            edges,
            structuralPostProcess: buildGraphRebuildStructuralPostProcess(nodes, edges),
        });
        const second = buildGraphRebuildEntityLinkSuggestions({
            mentions,
            entityAnchors: anchors,
            nodes,
            edges,
            structuralPostProcess: buildGraphRebuildStructuralPostProcess(nodes, edges),
        });

        expect(first.suggestions.length).toBeLessThanOrEqual(48);
        expect(first.suggestions.map((suggestion) => suggestion.id)).toEqual(second.suggestions.map((suggestion) => suggestion.id));
        expect(new Set(first.suggestions.map((suggestion) => suggestion.id)).size).toBe(first.suggestions.length);
    });

    it('builds narrow linker candidate packets from dynamic mentions without exact surface scans', () => {
        const anchors = [
            anchor('a-ryan', 'e-ryan', 'Ryan'),
            anchor('a-new-rome', 'e-new-rome', 'New Rome'),
            anchor('a-dynamis', 'e-dynamis', 'Dynamis'),
        ];
        const nodes = [
            node('e-ryan', 'Ryan', 'CHARACTER', ['Quicksave'], 5),
            node('e-new-rome', 'New Rome', 'LOCATION', [], 4),
            node('e-dynamis', 'Dynamis', 'NETWORK', [], 3),
            node('e-red-mesa', 'Red Mesa', 'LOCATION', [], 2),
        ];
        const mentions = [
            ...anchors,
            mention('m-new-roman', 'New Roman quarter', 'dropped', 900, 917),
        ];

        const result = buildGraphRebuildEntityLinkSuggestions({
            mentions,
            entityAnchors: anchors,
            nodes,
            edges: [edge('e-ryan', 'e-new-rome', 2)],
            structuralPostProcess: buildGraphRebuildStructuralPostProcess(nodes, [edge('e-ryan', 'e-new-rome', 2)]),
        });

        expect(result.suggestions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'entity-link:linker:m-new-roman:e-new-rome',
                candidateEntityId: 'e-new-rome',
                linkerCandidateEntityIds: ['e-new-rome'],
                linkerWindowId: 'note:1',
            }),
        ]));
        expect(result.counters.linkerCandidates).toBe(1);
    });
});

function node(id: string, label: string, kind: string, aliases: string[], totalMentions = 1): GraphRebuildNode {
    return {
        id,
        entityId: id,
        label,
        kind,
        aliases,
        anchorIds: [],
        noteIds: ['note'],
        totalMentions,
    };
}

function anchor(id: string, entityId: string, surface: string): GraphRebuildEntityAnchor {
    return {
        id,
        noteId: 'note',
        chunkId: 'chunk',
        surface,
        sourceStart: 0,
        sourceEnd: surface.length,
        source: 'dictionary_match',
        confidence: 0.9,
        entityId,
        status: 'accepted',
        generation: 1,
    };
}

function mention(id: string, surface: string, status: GraphRebuildMention['status'], sourceStart: number, sourceEnd: number): GraphRebuildMention {
    return {
        id,
        noteId: 'note',
        chunkId: 'chunk',
        surface,
        sourceStart,
        sourceEnd,
        source: 'machine_suggestion',
        confidence: 0.8,
        status,
    };
}

function edge(sourceId: string, targetId: string, weight: number): GraphRebuildEdge {
    return {
        id: `${sourceId}:anchored-cooccurrence:${targetId}`,
        sourceId,
        targetId,
        type: 'anchored-cooccurrence',
        weight,
        confidence: 0.8,
        evidenceAnchorIds: [],
        scopeKeys: ['chunk'],
        noteIds: ['note'],
    };
}
