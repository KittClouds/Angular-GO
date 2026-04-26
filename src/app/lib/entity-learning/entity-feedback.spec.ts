import { describe, expect, it } from 'vitest';

import { entityFeedbackTestHooks, normalizeEntitySurface } from './entity-feedback';

describe('entity feedback learning keys', () => {
    it('normalizes human-selected surfaces into stable dictionary keys', () => {
        expect(normalizeEntitySurface('  Monkey   D. Luffy  ')).toBe('monkey d. luffy');
    });

    it('keys rejected suggestions by provider instead of entity id', () => {
        const id = entityFeedbackTestHooks.feedbackId('rejected_suggestion', 'aella', 'fst');

        expect(id).toBe('rejected_suggestion:fst:aella');
    });

    it('keys learned aliases by entity id', () => {
        const id = entityFeedbackTestHooks.feedbackId('manual_tag', 'luffy', undefined, 'entity-monkey-d-luffy');

        expect(id).toBe('manual_tag:entity-monkey-d-luffy:luffy');
    });
});
