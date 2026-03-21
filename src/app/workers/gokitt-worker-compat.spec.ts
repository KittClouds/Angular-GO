import { describe, expect, it } from 'vitest';

import {
    formatGoKittCompatibilityError,
    getMissingGoKittMethods,
    REQUIRED_GOKITT_METHODS,
} from './gokitt-worker-compat';

describe('gokitt worker compatibility helpers', () => {
    it('reports missing required exports without throwing', () => {
        const missing = getMissingGoKittMethods({
            initialize: () => '{}',
            scanImplicit: () => '[]',
        });

        expect(missing).toContain('storeListScopedDefinitions');
        expect(missing).toContain('storeDeleteScopedDefinition');
    });

    it('returns an empty list when all required exports are present', () => {
        const compatShape = Object.fromEntries(
            REQUIRED_GOKITT_METHODS.map((methodName) => [methodName, () => '{}'])
        );

        expect(getMissingGoKittMethods(compatShape)).toEqual([]);
    });

    it('formats a stable mismatch error message for logging and worker errors', () => {
        const message = formatGoKittCompatibilityError(['storeListScopedDefinitions']);

        expect(message).toContain('storeListScopedDefinitions');
        expect(message).toContain('stale relative to gokitt.worker.ts');
    });
});
