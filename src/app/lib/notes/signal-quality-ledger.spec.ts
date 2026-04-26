import { describe, expect, it } from 'vitest';

import {
    buildSignalQualityEntry,
    signalEntriesForContextIslandBridges,
    signalEntriesForContextIslandMemberships,
} from './signal-quality-ledger';

describe('signal quality ledger', () => {
    it('builds deterministic rows with clamped scores and sorted provenance', () => {
        const row = buildSignalQualityEntry({
            candidateId: 'candidate-1',
            sourceUnitId: 'note-1',
            targetUnitId: 'island-1',
            signalFamily: 'graph',
            supportScore: 1.4,
            contradictionScore: -1,
            freshness: 0.8,
            scopeConfidence: 0.7,
            islandConfidence: 0.9,
            pathConfidence: 0.6,
            provenance: ['b', 'a', 'a'],
            generation: 42,
        });

        expect(row).toMatchObject({
            candidateId: 'candidate-1',
            sourceUnitId: 'note-1',
            targetUnitId: 'island-1',
            signalFamily: 'graph',
            supportScore: 1,
            contradictionScore: 0,
            status: 'accepted',
            provenance: ['a', 'b'],
            generation: 42,
            updatedAt: 42,
        });
        expect(row.rerankScore).toBeGreaterThan(1);
        expect(row.id).toBe(buildSignalQualityEntry({
            candidateId: 'candidate-1',
            sourceUnitId: 'note-1',
            targetUnitId: 'island-1',
            signalFamily: 'graph',
            generation: 99,
        }).id);
    });

    it('routes contradiction-heavy rows to rejected or review deterministically', () => {
        expect(buildSignalQualityEntry({
            candidateId: 'candidate-2',
            sourceUnitId: 'claim-a',
            targetUnitId: 'claim-b',
            signalFamily: 'causal',
            supportScore: 0.3,
            contradictionScore: 0.9,
            generation: 10,
        }).status).toBe('rejected');

        expect(buildSignalQualityEntry({
            candidateId: 'candidate-3',
            sourceUnitId: 'claim-a',
            targetUnitId: 'claim-b',
            signalFamily: 'semantic',
            supportScore: 0.7,
            contradictionScore: 0.55,
            generation: 10,
        }).status).toBe('review');
    });

    it('projects context island memberships and bridges into structural signal rows', () => {
        const membershipRows = signalEntriesForContextIslandMemberships([{
            id: 'membership-1',
            islandId: 'island-1',
            noteId: 'note-1',
            worldId: '',
            narrativeId: '',
            folderId: 'folder-1',
            confidence: 0.76,
            primary: true,
            evidenceScore: 2.4,
            generation: 100,
            updatedAt: 100,
            evidence: { maxPairScore: 2.4, tokenCount: 12, folderPrior: 1.2 },
        }]);
        const bridgeRows = signalEntriesForContextIslandBridges([{
            id: 'bridge-1',
            worldId: '',
            narrativeId: '',
            sourceIslandId: 'island-1',
            targetIslandId: 'island-2',
            confidence: 0.48,
            evidenceScore: 1.2,
            sharedTerms: ['harbor'],
            generation: 100,
            updatedAt: 100,
            evidence: { edgeCount: 2, lexicalScore: 1.2, folderScore: 0 },
        }]);

        expect(membershipRows[0]).toMatchObject({
            candidateId: 'membership-1',
            sourceUnitId: 'note-1',
            targetUnitId: 'island-1',
            signalFamily: 'structural',
            status: 'accepted',
        });
        expect(bridgeRows[0]).toMatchObject({
            candidateId: 'bridge-1',
            sourceUnitId: 'island-1',
            targetUnitId: 'island-2',
            signalFamily: 'structural',
            status: 'deferred',
        });
        expect(bridgeRows[0].provenance).toContain('shared:harbor');
    });
});
