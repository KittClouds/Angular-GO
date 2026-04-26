import { describe, expect, it } from 'vitest';

import { projectNoteStructure } from './note-structure-projection';

const baseNote = {
    id: 'note-1',
    worldId: 'world-1',
    folderId: 'timeline-1',
    narrativeId: 'vault-1',
    version: 42,
    updatedAt: 100,
};

describe('note structure projection', () => {
    it('projects Milkdown blocks and logical lines with note scope metadata', () => {
        const projection = projectNoteStructure({
            ...baseNote,
            markdownContent: '',
            content: JSON.stringify({
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 2 },
                        content: [{ type: 'text', text: 'Arrival' }],
                    },
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'Alice crossed the harbor.' },
                            { type: 'hardBreak' },
                            { type: 'text', text: 'Zoro waited.' },
                        ],
                    },
                ],
            }),
        });

        expect(projection.blocks.map(block => block.text)).toEqual([
            'Arrival',
            'Alice crossed the harbor.\nZoro waited.',
        ]);
        expect(projection.blocks[0]).toMatchObject({
            noteId: 'note-1',
            worldId: 'world-1',
            folderId: 'timeline-1',
            narrativeId: 'vault-1',
            nodeType: 'heading',
            headingLevel: 2,
            lineCount: 1,
        });
        expect(projection.lines.map(line => line.text)).toEqual([
            'Arrival',
            'Alice crossed the harbor.',
            'Zoro waited.',
        ]);
        expect(projection.lines[1]).toMatchObject({
            blockId: projection.blocks[1].id,
            worldId: 'world-1',
            blockOrdinal: 1,
            lineOrdinal: 0,
            sourceVersion: 42,
        });
    });

    it('keeps block ids stable for text edits at the same document path', () => {
        const first = projectNoteStructure({
            ...baseNote,
            markdownContent: '',
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First draft' }] }],
            },
        });
        const second = projectNoteStructure({
            ...baseNote,
            markdownContent: '',
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second draft' }] }],
            },
        });

        expect(second.blocks[0].id).toBe(first.blocks[0].id);
        expect(second.blocks[0].textHash).not.toBe(first.blocks[0].textHash);
    });

    it('falls back to markdown blocks when the stored JSON is not a ProseMirror doc', () => {
        const projection = projectNoteStructure({
            ...baseNote,
            content: '{}',
            markdownContent: 'One life.\n\nAnother beat.',
        });

        expect(projection.blocks.map(block => block.nodeType)).toEqual([
            'markdown_block',
            'markdown_block',
        ]);
        expect(projection.blocks.map(block => block.text)).toEqual([
            'One life.',
            'Another beat.',
        ]);
    });
});
