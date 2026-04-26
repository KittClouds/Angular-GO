import { describe, expect, it } from 'vitest';

import {
    PhoenixLineSearchIndex,
    matchLiteralPatterns,
    type PhoenixLiteralPattern,
} from './phoenix-line-search';

describe('PhoenixLineSearchIndex', () => {
    it('returns exact line hits with context and offsets', () => {
        const index = new PhoenixLineSearchIndex([
            {
                noteId: 'note-a',
                title: 'Harbor scene',
                content: [
                    'The crew arrived before dawn.',
                    'Nami gave the compass to Zoro beside the harbor.',
                    'The ship left quietly.',
                ].join('\n'),
            },
        ], 'test-1');

        const hits = index.search('"gave the compass"', { before: 1, after: 1 });

        expect(hits).toHaveLength(1);
        expect(hits[0].noteId).toBe('note-a');
        expect(hits[0].lineNumber).toBe(2);
        expect(hits[0].lineText).toContain('Nami gave the compass');
        expect(hits[0].matches[0].from).toBe(5);
        expect(hits[0].matches[0].text).toBe('gave the compass');
        expect(hits[0].before).toEqual(['The crew arrived before dawn.']);
        expect(hits[0].after).toEqual(['The ship left quietly.']);
        expect(hits[0].generation).toBe('test-1');
    });

    it('honors narrative and folder scopes', () => {
        const index = new PhoenixLineSearchIndex([
            {
                noteId: 'note-a',
                title: 'Alpha',
                content: 'The relic is hidden under the chapel.',
                narrativeId: 'timeline-a',
                folderId: 'folder-a',
            },
            {
                noteId: 'note-b',
                title: 'Beta',
                content: 'The relic is hidden under the observatory.',
                narrativeId: 'timeline-b',
                folderId: 'folder-b',
            },
        ]);

        const hits = index.search('relic', {
            scope: { narrativeId: 'timeline-b', folderPath: 'folder-b' },
        });

        expect(hits.map((hit) => hit.noteId)).toEqual(['note-b']);
    });

    it('boosts title matches over body-only matches', () => {
        const index = new PhoenixLineSearchIndex([
            {
                noteId: 'title-hit',
                title: 'Solar Crown',
                content: 'A quiet line with no named artifact.',
            },
            {
                noteId: 'body-hit',
                title: 'Archive',
                content: 'The solar crown appears in a distant paragraph.',
            },
        ]);

        const hits = index.search('solar crown', { limit: 2 });

        expect(hits[0].noteId).toBe('title-hit');
        expect(hits[0].lineNumber).toBe(0);
    });

    it('supports bounded regex line matches', () => {
        const index = new PhoenixLineSearchIndex([
            {
                noteId: 'note-a',
                title: 'Telemetry',
                content: 'depth audit: 3.965618s\nscope probes: 1.913131s',
            },
        ]);

        const hits = index.search('/\\d+\\.\\d+s/', { mode: 'regex' });

        expect(hits).toHaveLength(2);
        expect(hits[0].matches[0].text).toMatch(/\d+\.\d+s/);
    });
});

describe('matchLiteralPatterns', () => {
    it('keeps longest whole-word non-overlapping matches', () => {
        const patterns: Array<PhoenixLiteralPattern<{ id: string }>> = [
            { text: 'Zoro', payload: { id: 'short' } },
            { text: 'Roronoa Zoro', payload: { id: 'long' } },
        ];

        const matches = matchLiteralPatterns('Roronoa Zoro trained. Zoroland did not match.', patterns, {
            wholeWord: true,
        });

        expect(matches).toHaveLength(1);
        expect(matches[0].text).toBe('Roronoa Zoro');
        expect(matches[0].payload?.id).toBe('long');
    });
});
