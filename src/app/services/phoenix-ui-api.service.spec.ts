import { describe, expect, it } from 'vitest';

import { phoenixUiApiServiceTestHooks } from './phoenix-ui-api.service';

const dictionary = [
    { id: 'entity-kai', label: 'Kai', kind: 'CHARACTER', aliases: [] },
    { id: 'entity-brynwynn', label: 'Brynwynn', kind: 'CHARACTER', aliases: [] },
    { id: 'entity-phaeris', label: 'Phaeris', kind: 'CHARACTER', aliases: ['Lady Phaeris'] },
];

describe('PhoenixUiApiService known mention spans', () => {
    it('fills registered entity highlights not returned by Phoenix scan', () => {
        const text = 'Kai saw Brynwynn. Kai waited. Phaeris answered.';

        const spans = phoenixUiApiServiceTestHooks.knownMentionsToSpans(text, [], dictionary);

        expect(spans.map((span) => [span.entityId, span.from, span.to, span.matchedText])).toEqual([
            ['entity-kai', 0, 3, 'Kai'],
            ['entity-brynwynn', 8, 16, 'Brynwynn'],
            ['entity-kai', 18, 21, 'Kai'],
            ['entity-phaeris', 30, 37, 'Phaeris'],
        ]);
    });

    it('matches possessive registered names without coloring the apostrophe suffix', () => {
        const text = "Kai's hand tightened. Phaeris’s feathers stilled.";

        const spans = phoenixUiApiServiceTestHooks.knownMentionsToSpans(text, [], dictionary);

        expect(spans.map((span) => [span.entityId, span.matchedText])).toEqual([
            ['entity-kai', 'Kai'],
            ['entity-phaeris', 'Phaeris'],
        ]);
    });

    it('does not match registered names inside larger words', () => {
        const text = 'Kaiser watched Brynwynnish rumors pass.';

        const spans = phoenixUiApiServiceTestHooks.knownMentionsToSpans(text, [], dictionary);

        expect(spans).toEqual([]);
    });

    it('keeps Phoenix-resolved spans when dictionary fallback overlaps', () => {
        const text = 'Kai waited.';
        const spans = phoenixUiApiServiceTestHooks.knownMentionsToSpans(text, [
            {
                entityRef: { known: 'entity-kai' },
                range: { start: 0, end: 3 },
                surface: 'Kai',
                source: 'resolver',
                confidence: 0.72,
            },
        ], dictionary);

        expect(spans).toHaveLength(1);
        expect(spans[0]).toMatchObject({
            entityId: 'entity-kai',
            matchSource: 'resolver',
            confidence: 0.72,
        });
    });

    it('drops scan mentions that are not in the active dictionary generation', () => {
        const spans = phoenixUiApiServiceTestHooks.knownMentionsToSpans('Old Kai waited.', [
            {
                entityRef: { known: 'stale-entity' },
                range: { start: 4, end: 7 },
                surface: 'Kai',
                source: 'resolver',
                confidence: 0.91,
            },
        ], []);

        expect(spans).toEqual([]);
    });
});

describe('PhoenixUiApiService runtime graph view mapping', () => {
    it('maps graph delta chunks and nodes without resurrecting orphan edges', () => {
        const graph = phoenixUiApiServiceTestHooks.graphDeltaToKnowledgeGraph({
            sessionId: 'phoenix-ui-main',
            chunks: [{
                vertexId: 'leaf-note-a-0',
                chunkId: 'note-a:chunk:0',
                documentId: 'note-a',
                noteId: 'note-a',
                chapterId: 0,
                start: 0,
                end: 12,
            }],
            nodes: [{
                nodeId: 'entity-kai',
                kind: 'entity',
                label: 'Kai',
                entityId: 'entity-kai',
                weight: 1,
            }],
            edges: [
                { sourceId: 'entity-kai', targetId: 'leaf-note-a-0', edgeType: 'mentions', weight: 1 },
                { sourceId: 'entity-kai', targetId: 'missing', edgeType: 'mentions', weight: 1 },
            ],
            diagnostics: [],
        });

        expect(Object.keys(graph.nodes).sort()).toEqual(['entity-kai', 'leaf-note-a-0']);
        expect(graph.edges).toEqual([{
            source: 'entity-kai',
            target: 'leaf-note-a-0',
            relation: 'mentions',
            weight: 1,
            props: {},
        }]);
    });
});
