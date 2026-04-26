import { describe, expect, it } from 'vitest';

import { registryEdgeToProjection, storeEntityToRegistered } from './phoenix-projection.service';

describe('PhoenixProjectionService entity mapping', () => {
    it('maps native store entities into the shared registered entity shape', () => {
        const registered = storeEntityToRegistered({
            id: 'entity-kai',
            label: 'Kai',
            kind: 'CHARACTER',
            aliases: ['The Blade'],
            firstNote: 'note-8',
            totalMentions: 3,
            narrativeId: 'narrative-1',
            createdBy: 'extraction',
            createdAt: 1000,
            updatedAt: 2000,
        });

        expect(registered).toMatchObject({
            id: 'entity-kai',
            label: 'Kai',
            kind: 'CHARACTER',
            aliases: ['The Blade'],
            firstNote: 'note-8',
            totalMentions: 3,
            createdBy: 'extraction',
            noteId: 'note-8',
        });
        expect(registered.mentionsByNote.get('note-8')).toBe(3);
        expect(registered.attributes).toEqual({ narrativeId: 'narrative-1' });
    });

    it('maps live registry edges into graph projection edges', () => {
        expect(registryEdgeToProjection({
            id: 'edge-aella-kai',
            sourceId: 'entity-aella',
            targetId: 'entity-kai',
            type: 'mentions',
            confidence: 0.75,
            sourceNote: 'note-10',
        })).toEqual({
            id: 'edge-aella-kai',
            sourceId: 'entity-aella',
            targetId: 'entity-kai',
            type: 'mentions',
            confidence: 0.75,
            sourceNote: 'note-10',
        });
    });
});
