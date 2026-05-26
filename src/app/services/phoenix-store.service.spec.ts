import { describe, expect, it } from 'vitest';

import {
    derivedGraphRepairPrunedDocuments,
    formatPhoenixPersistenceSummary,
    hasActivePhoenixPersistence,
    rowToScopedDocument,
    scopedDocumentToRow,
} from './phoenix-store.service';
import type { LoadedPhoenixManifestState } from '../lib/sqlite/persistence/phoenix-wal';
import { createEmptyPhoenixManifest } from '../lib/sqlite/persistence/phoenix-wal';

function createLoadedState(overrides: Partial<LoadedPhoenixManifestState> = {}): LoadedPhoenixManifestState {
    return {
        manifest: null,
        manifestBytes: 0,
        backupManifestBytes: 0,
        contentCheckpoint: null,
        derivedCheckpoint: null,
        closedSegments: [],
        activeSegment: null,
        staleLegacyFiles: [],
        recoveredFromBackup: false,
        ...overrides,
    };
}

describe('PhoenixStoreService persistence diagnostics helpers', () => {
    it('treats legacy sqlite.db artifacts as non-active restore state', () => {
        const state = createLoadedState({
            staleLegacyFiles: ['sqlite.db', 'sqlite.db.bak'],
        });

        expect(hasActivePhoenixPersistence(state)).toBe(false);
        expect(formatPhoenixPersistenceSummary(state)).toContain('manifest=no');
        expect(formatPhoenixPersistenceSummary(state)).toContain('legacyArtifacts=2');
    });

    it('treats a manifest-free boot as empty Phoenix persistence', () => {
        const state = createLoadedState();

        expect(hasActivePhoenixPersistence(state)).toBe(false);
        expect(formatPhoenixPersistenceSummary(state)).toContain('contentCheckpointBytes=0');
        expect(formatPhoenixPersistenceSummary(state)).toContain('activeWalBytes=0');
    });

    it('treats manifest/checkpoint/WAL data as active Phoenix persistence', () => {
        const state = createLoadedState({
            manifest: createEmptyPhoenixManifest(1),
            manifestBytes: 128,
            contentCheckpoint: { file: 'checkpoints/content-2.bin', bytes: 512 },
            derivedCheckpoint: { file: 'checkpoints/derived-2.bin', bytes: 64 },
            activeSegment: { file: 'wal/content-active.log', bytes: 32 },
        });

        expect(hasActivePhoenixPersistence(state)).toBe(true);
        expect(formatPhoenixPersistenceSummary(state)).toContain('manifest=yes');
        expect(formatPhoenixPersistenceSummary(state)).toContain('contentCheckpointBytes=512');
        expect(formatPhoenixPersistenceSummary(state)).toContain('activeWalBytes=32');
    });

    it('normalizes native graph repair pruning counts', () => {
        expect(derivedGraphRepairPrunedDocuments({ prunedDocuments: 3 })).toBe(3);
        expect(derivedGraphRepairPrunedDocuments({ prunedDocuments: 0 })).toBe(0);
        expect(derivedGraphRepairPrunedDocuments(null)).toBe(0);
    });

    it('keeps scoped document payloads opaque for fast WAL writes', () => {
        const payload = JSON.stringify({ nested: { rows: Array.from({ length: 4 }, (_, id) => ({ id })) } });
        const row = scopedDocumentToRow({
            id: 'doc-1',
            scopeFolderId: 'global',
            narrativeId: '',
            namespace: 'test',
            documentKey: 'snapshot',
            payload,
            createdAt: 1,
            updatedAt: 2,
        });

        expect(row['payload']).toBe(payload);
        expect(rowToScopedDocument(row).payload).toBe(payload);
    });
});
