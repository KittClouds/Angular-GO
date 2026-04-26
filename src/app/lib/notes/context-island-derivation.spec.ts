import { describe, expect, it } from 'vitest';

import { deriveGlobalContextIslands } from './context-island-derivation';

const folders = [
    folder('sea-root', 'Sea Shelf', ''),
    folder('bot-root', 'Quant Lab', ''),
    folder('vault-root', 'Narrative Vault', '', 'vault-1', true),
];

describe('context island derivation', () => {
    it('separates unrelated global worlds and excludes hard narrative vault notes', () => {
        const result = deriveGlobalContextIslands({
            now: 100,
            folders,
            notes: [
                note('pirate-1', 'Zoro harbor duel', 'sea-root'),
                note('pirate-2', 'Luffy harbor aftermath', 'sea-root'),
                note('quant-1', 'Turboquant oscillator', 'bot-root'),
                note('vault-note', 'Zoro canon outline', 'vault-root', 'vault-1'),
            ],
            blocks: [
                block('pirate-1', 'Zoro sailed into the harbor with Luffy and the pirate crew.'),
                block('pirate-2', 'Luffy met Zoro at the harbor after the pirate duel.'),
                block('quant-1', 'RSI supertrend volatility strategy with mapped ONNX signals.'),
                block('vault-note', 'This hard vault note should never bleed into global islands.'),
            ],
        });

        const memberships = new Map(result.memberships.map(row => [row.noteId, row.islandId]));
        expect(memberships.get('pirate-1')).toBe(memberships.get('pirate-2'));
        expect(memberships.get('quant-1')).not.toBe(memberships.get('pirate-1'));
        expect(memberships.has('vault-note')).toBe(false);
        expect(result.islands).toHaveLength(2);
    });

    it('does not merge same-folder global notes on folder prior alone', () => {
        const result = deriveGlobalContextIslands({
            now: 100,
            folders: [folder('inbox', 'Inbox', '')],
            notes: [
                note('groceries', 'Grocery list', 'inbox'),
                note('rust-ann', 'Rust HNSW mmap', 'inbox'),
            ],
            blocks: [
                block('groceries', 'Apples, milk, rice, and soup prep.'),
                block('rust-ann', 'Hyperbolic ANN mmap cache and SIMD graph traversal.'),
            ],
        });

        expect(new Set(result.memberships.map(row => row.islandId)).size).toBe(2);
    });

    it('builds evidence bridges between related islands without over-merging them', () => {
        const bridgeFolders = [
            folder('projects', 'Projects', ''),
            folder('pirates', 'Pirates', 'projects'),
            folder('shipping', 'Shipping', 'projects'),
        ];
        const result = deriveGlobalContextIslands({
            now: 100,
            folders: bridgeFolders,
            notes: [
                note('raid-1', 'Pirate moon raid', 'pirates'),
                note('raid-2', 'Pirate reef raid', 'pirates'),
                note('cargo-1', 'Cargo ledger intake', 'shipping'),
                note('cargo-2', 'Cargo ledger routes', 'shipping'),
            ],
            blocks: [
                block('raid-1', 'Harbor raid pirate cannon moon', 'heading'),
                block('raid-2', 'Harbor raid pirate reef moon', 'heading'),
                block('cargo-1', 'Harbor ledger cargo tariff route', 'heading'),
                block('cargo-2', 'Harbor ledger cargo manifest route', 'heading'),
            ],
        });

        const raidIsland = result.memberships.find(row => row.noteId === 'raid-1')?.islandId;
        const cargoIsland = result.memberships.find(row => row.noteId === 'cargo-1')?.islandId;
        expect(raidIsland).toBeDefined();
        expect(cargoIsland).toBeDefined();
        expect(raidIsland).not.toBe(cargoIsland);
        expect(result.bridges.some(bridge =>
            bridge.sharedTerms.includes('harbor') &&
            (bridge.sourceIslandId === raidIsland || bridge.targetIslandId === raidIsland) &&
            (bridge.sourceIslandId === cargoIsland || bridge.targetIslandId === cargoIsland)
        )).toBe(true);
    });
});

function folder(id: string, name: string, parentId: string, narrativeId = '', isNarrativeRoot = false) {
    return { id, worldId: '', name, parentId, narrativeId, isNarrativeRoot };
}

function note(id: string, title: string, folderId: string, narrativeId = '') {
    return { id, worldId: '', title, folderId, narrativeId, updatedAt: 100 };
}

function block(noteId: string, text: string, nodeType = 'paragraph') {
    return { noteId, text, nodeType, ordinal: 0 };
}
