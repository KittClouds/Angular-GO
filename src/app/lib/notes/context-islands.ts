import { db } from '../dexie/db';
import {
    deriveGlobalContextIslands,
    type ContextIslandDerivationResult,
} from './context-island-derivation';
import {
    signalEntriesForContextIslandBridges,
    signalEntriesForContextIslandMemberships,
} from './signal-quality-ledger';

export interface ContextIslandRebuildOptions {
    worldId?: string;
    now?: number;
}

export interface ContextIslandRebuildResult {
    worldIds: string[];
    islands: number;
    memberships: number;
    bridges: number;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWorldIds = new Set<string>();

export function scheduleGlobalContextIslandRefresh(worldId: string = '', delayMs = 750): void {
    pendingWorldIds.add(worldId || '');
    if (refreshTimer) {
        return;
    }
    refreshTimer = setTimeout(() => {
        const worldIds = Array.from(pendingWorldIds);
        pendingWorldIds.clear();
        refreshTimer = null;
        void rebuildWorlds(worldIds).catch((error) => {
            console.warn('[ContextIslands] Refresh failed:', error);
        });
    }, delayMs);
    (refreshTimer as { unref?: () => void }).unref?.();
}

export async function flushGlobalContextIslandRefresh(): Promise<ContextIslandRebuildResult[]> {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    const worldIds = Array.from(pendingWorldIds);
    pendingWorldIds.clear();
    return rebuildWorlds(worldIds);
}

export function isGlobalContextScope(scope?: { narrativeId?: string | null }): boolean {
    return !!scope && !scope.narrativeId;
}

export async function rebuildGlobalContextIslands(
    options: ContextIslandRebuildOptions = {},
): Promise<ContextIslandRebuildResult> {
    const hasWorldFilter = options.worldId !== undefined;
    const [notes, folders, blocks] = await Promise.all([
        hasWorldFilter ? db.notes.where('worldId').equals(options.worldId || '').toArray() : db.notes.toArray(),
        db.folders.toArray(),
        hasWorldFilter ? db.noteBlocks.where('worldId').equals(options.worldId || '').toArray() : db.noteBlocks.toArray(),
    ]);

    const result = deriveGlobalContextIslands({
        notes,
        folders,
        blocks,
        now: options.now,
        options: hasWorldFilter ? { worldId: options.worldId || '' } : undefined,
    });
    let worldIds = result.worldIds.length
        ? result.worldIds
        : hasWorldFilter ? [options.worldId || ''] : [];
    if (!hasWorldFilter && !worldIds.length) {
        const existing = await db.contextIslands.where('kind').equals('global_derived').toArray();
        worldIds = Array.from(new Set(existing.map(island => island.worldId || ''))).sort();
    }
    await replaceDerivedRows(result, worldIds);
    return {
        worldIds,
        islands: result.islands.length,
        memberships: result.memberships.length,
        bridges: result.bridges.length,
    };
}

async function rebuildWorlds(worldIds: string[]): Promise<ContextIslandRebuildResult[]> {
    if (!worldIds.length) {
        return [await rebuildGlobalContextIslands()];
    }
    const results: ContextIslandRebuildResult[] = [];
    for (const worldId of Array.from(new Set(worldIds)).sort()) {
        results.push(await rebuildGlobalContextIslands({ worldId }));
    }
    return results;
}

async function replaceDerivedRows(
    result: ContextIslandDerivationResult,
    worldIds: string[],
): Promise<void> {
    const worldSet = new Set(worldIds);
    await db.transaction(
        'rw',
        db.contextIslands,
        db.contextIslandMemberships,
        db.contextIslandBridges,
        db.signalQualityLedger,
        async () => {
            const existing = await db.contextIslands.where('kind').equals('global_derived').toArray();
            const staleIslandIds = existing
                .filter(island => worldSet.has(island.worldId || ''))
                .map(island => island.id);

            if (staleIslandIds.length) {
                await db.contextIslandMemberships.where('islandId').anyOf(staleIslandIds).delete();
                await db.contextIslandBridges.where('sourceIslandId').anyOf(staleIslandIds).delete();
                await db.contextIslandBridges.where('targetIslandId').anyOf(staleIslandIds).delete();
                await db.signalQualityLedger.where('targetUnitId').anyOf(staleIslandIds).delete();
                await db.signalQualityLedger.where('sourceUnitId').anyOf(staleIslandIds).delete();
                await db.contextIslands.bulkDelete(staleIslandIds);
            }
            if (result.islands.length) {
                await db.contextIslands.bulkPut(result.islands);
            }
            if (result.memberships.length) {
                await db.contextIslandMemberships.bulkPut(result.memberships);
            }
            if (result.bridges.length) {
                await db.contextIslandBridges.bulkPut(result.bridges);
            }
            const signalRows = [
                ...signalEntriesForContextIslandMemberships(result.memberships),
                ...signalEntriesForContextIslandBridges(result.bridges),
            ];
            if (signalRows.length) {
                await db.signalQualityLedger.bulkPut(signalRows);
            }
        },
    );
}
