import { describe, expect, it } from 'vitest';

import { projectionSummaryRequestsRefresh } from './graph-atlas-refresh-summary';

describe('graph atlas projection refresh summaries', () => {
    it('refreshes after semantic atlas scans even when a later summary may replace the receipt', () => {
        expect(projectionSummaryRequestsRefresh({
            kind: 'atlas-rich-scan',
            details: {
                includeSemanticAtlas: true,
                embeddingCounts: { leaf: 0, entity: 0, lens: 0 },
            },
        }, 'hopf')).toBe(true);
    });

    it('ignores text-only scans without semantic rows', () => {
        expect(projectionSummaryRequestsRefresh({
            kind: 'atlas-rich-scan',
            details: {
                includeSemanticAtlas: false,
                embeddingCounts: { leaf: 8, entity: 2, lens: 0 },
            },
        }, 'hybrid')).toBe(false);
    });

    it('refreshes when an external manifold snapshot completes for the active projection', () => {
        expect(projectionSummaryRequestsRefresh({
            kind: 'manifold-load',
            details: { manifold: 'hopf', nodes: 12 },
        }, 'hopf')).toBe(true);
    });

    it('does not refresh from the preview component own load completion', () => {
        expect(projectionSummaryRequestsRefresh({
            kind: 'manifold-load',
            details: { owner: 'graph-atlas-preview', manifold: 'hopf', nodes: 12 },
        }, 'hopf')).toBe(false);
    });
});
