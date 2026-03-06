
import { Injectable, inject } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable, switchMap, map, of } from 'rxjs';
import { db, Folder } from '../dexie/db';
import { GoKittStoreService } from '../../services/gokitt-store.service';

export interface WorldSnapshot {
    logline: string;
    tone: string[]; // e.g., ["Grimdark", "High Magic"]
    description: string; // The "Prose" part
}

export interface CanonConstraint {
    id: string;
    text: string;
    isActive: boolean;
}

export interface WorldPillar {
    id: string;
    title: string;
    description: string;
    icon: string; // PrimeIcons
}

export interface ActDelta {
    id: string;
    title: string;
    description: string;
    type: 'new' | 'changed' | 'removed';
}

export type StakePressure = 'safe' | 'warning' | 'critical';

export interface ActStake {
    id: string;
    title: string;
    details: string;
    pressure: StakePressure;
}

export const DEFAULT_SNAPSHOT: WorldSnapshot = {
    logline: '',
    tone: [],
    description: ''
};

// ===================================
// CULTURE TYPES
// ===================================

export interface Culture {
    id: string;
    name: string;
    icon: string;        // Emoji or icon class
    color: string;       // Hex or Tailwind class

    // Modules
    identity: {
        values: string[];
        virtues: string[];
        vices: string[];
    };
    structure: {
        hierarchy: string;  // Simple text desc
        family: string;
        gender: string;
    };
    customs: {
        greetings: string;
        rituals: string;
        taboos: string[];
    };
    language: {
        name: string;
        description: string;
    };

    // The "Scene Fuel"
    hooks: {
        misunderstandings: string[];
        rituals: string[];
        obligations: string[];
    };
}

export interface CultureOverride {
    status: 'Stable' | 'Reforming' | 'Fragmenting' | 'Occupied' | 'Extinct';
    changelog: string; // "What changed since last act?"
}

// ===================================
// POWER SYSTEM TYPES (Magic & Tech)
// ===================================

export interface PowerCapability {
    id: string;
    name: string;
    type: 'spell' | 'tech' | 'artifact' | 'hybrid';
    description: string;
    cost: string[];     // e.g. ["Mana", "Health", "Fuel"]
    risks: string[];    // e.g. ["Corruption", "Explosion"]
    prerequisites: string[]; // IDs of other capabilities
    position?: { x: number, y: number }; // For the visual Graph/Map
}

export interface PowerSystem {
    id: string;
    name: string;
    type: 'magic' | 'tech' | 'hybrid';
    description: string;
    rules: {
        limits: string;
        costs: string;
        failureModes: string;
    };
    capabilities: PowerCapability[];
}

export interface PowerProgression {
    status: 'unknown' | 'rumored' | 'known' | 'unlocked' | 'forbidden';
    note?: string; // Optional context for this act
}

// ===================================
// RELIGION TYPES
// ===================================

export interface Deity {
    id: string;
    name: string;
    domains: string[]; // e.g., "War", "Love"
    symbol: string;
    description: string;
}

export interface MythBlock {
    id: string;
    title: string;
    content: string;
    type: 'creation' | 'prophecy' | 'hero' | 'cautionary' | 'endtimes';
}

export interface Sect {
    id: string;
    name: string;
    description: string;
    divergence: string; // Core disagreement
}

export interface Religion {
    id: string;
    name: string;
    // e.g. "Monotheistic", "Polytheistic", "Animist", etc.
    type: string;
    description: string;

    // Fast Facts
    symbols: string[];
    adjectives: string[]; // e.g. "Orthodox", "Mystical"

    // Core Beliefs
    cosmology: {
        creation: string;
        afterlife: string;
        moralCode: string; // Sin/Virtue
    };

    // Practices
    practices: {
        rituals: string;
        holidays: string[];
        taboos: string[];
    };

    // Pantheon
    deities: Deity[];

    // Structure
    structure: {
        hierarchy: string; // "Top-down", "Democratic"
        leadership: string; // "High Priest", "Council"
    };

    // Sects
    sects: Sect[];

    // Texts
    scriptures: string[];

    // Myths
    myths: MythBlock[];

    // Scene-Use Snippets
    prayers: string[]; // Short snippets for copy-paste
}

export interface ReligionOverride {
    status: 'Stable' | 'Schism' | 'Reform' | 'Persecuted' | 'Dominant';
    changes: string[]; // Log of changes in this act
}

// ===================================
// MYSTERY / CLUE SYSTEM
// ===================================
export type ClueType = 'artifact' | 'testimony' | 'record' | 'anomaly' | 'symbol';
export type ClueStatus = 'Open' | 'Chasing' | 'Stalled' | 'Resolved' | 'Retconned';

/** @deprecated Use LoreThread instead */
export interface MysteryClue {
    id: string;
    summary: string;
    type: ClueType;
    provenance: string; // Where found + who logged
    timeBounds: string; // Earliest / Latest
    reliability: string; // Witness quality / chain of custody
    confidence: number; // 0-100
    status: ClueStatus;

    // Act association (for swimlanes) - Optional, null means global/backstory
    actId?: string;

    // Locks
    locks: {
        access: string;
        skill: string;
        ally: string;
        location: string;
        event: string;
    };

    // Costs/Risks
    risks: {
        attention: string;
        resource: string;
        moral: string;
        escalation: string;
        contradiction: string;
    };

    // Interested Parties
    parties: {
        name: string;
        motivation: string;
    }[];

    // Payoff
    payoff: {
        decision: string;
        spawns: string;
    };
}

// ===================================
// LORE THREADS (Simplified v2)
// ===================================
export type ThreadStatus = 'open' | 'hinted' | 'revealed' | 'dropped';

export interface LoreThread {
    id: string;
    /** The mystery question (e.g. "Who killed the old king?") */
    question: string;
    /** Current status of this thread */
    status: ThreadStatus;
    /** Note ID where this was first planted */
    plantedIn?: string;
    /** The answer/resolution (hidden until status = revealed) */
    answer?: string;
    /** Linked entity IDs */
    connectedEntities: string[];
    /** When this was created */
    createdAt: number;
    /** Last update */
    updatedAt: number;
}

export interface WorldScopeData {
    // Global Data (stored on Narrative Root)
    snapshot: WorldSnapshot;
    constraints: CanonConstraint[];
    pillars: WorldPillar[];
    cultures: Culture[];
    powerSystems: PowerSystem[];
    religions: Religion[]; // Added Religions
    mysteries: MysteryClue[]; // @deprecated - use loreThreads
    loreThreads: LoreThread[]; // NEW: Simplified lore tracking

    // Act Data (stored on Act Folder)
    statusQuo: string;
    deltas: ActDelta[];
    stakes: ActStake[];
    cultureOverrides: Record<string, CultureOverride>;
    powerProgression: Record<string, PowerProgression>;
    religionOverrides: Record<string, ReligionOverride>; // Added Religion Overrides
}

@Injectable({
    providedIn: 'root'
})
export class WorldBuildingService {
    private goKittStore = inject(GoKittStoreService);

    constructor() { }

    /**
     * Get World Data (Snapshot, Constraints, Pillars, Cultures, PowerSystems, Religions) from the Narrative Root.
     */
    getWorldData$(narrativeId: string): Observable<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
        powerSystems: PowerSystem[];
        religions: Religion[];
        mysteries: MysteryClue[];
        loreThreads: LoreThread[];
    }> {
        const DEFAULT: any = { snapshot: DEFAULT_SNAPSHOT, constraints: [], pillars: [], cultures: [], powerSystems: [], religions: [], mysteries: [], loreThreads: [] };

        return from(liveQuery(async () => {
            const folder = await db.folders.get(narrativeId);
            if (!folder) return DEFAULT;

            const world = folder.attributes?.['world'] || {};
            return {
                snapshot: world.snapshot || DEFAULT.snapshot,
                constraints: world.constraints || [],
                pillars: world.pillars || [],
                cultures: world.cultures || [],
                powerSystems: world.powerSystems || [],
                religions: world.religions || [],
                mysteries: world.mysteries || [],
                loreThreads: world.loreThreads || []
            };
        }));
    }

    /**
     * Get Act Data (Status Quo, Deltas, Stakes, Culture Overrides, Power Progression, Religion Overrides) from an Act Folder.
     */
    getActData$(actFolderId: string): Observable<{
        statusQuo: string;
        deltas: ActDelta[];
        stakes: ActStake[];
        cultureOverrides: Record<string, CultureOverride>;
        powerProgression: Record<string, PowerProgression>;
        religionOverrides: Record<string, ReligionOverride>;
    }> {
        const DEFAULT: any = { statusQuo: '', deltas: [], stakes: [], cultureOverrides: {}, powerProgression: {}, religionOverrides: {} };

        if (!actFolderId) return of(DEFAULT);

        return from(liveQuery(async () => {
            const folder = await db.folders.get(actFolderId);
            if (!folder) return DEFAULT;

            const act = folder.attributes?.['act'] || {};
            return {
                statusQuo: act.statusQuo || '',
                deltas: act.deltas || [],
                stakes: act.stakes || [],
                cultureOverrides: act.cultureOverrides || {},
                powerProgression: act.powerProgression || {},
                religionOverrides: act.religionOverrides || {}
            };
        }));
    }

    // =========================================================================================
    // WRITE-THROUGH HELPER
    // =========================================================================================

    /**
     * After updating folder attributes in Dexie, sync the full folder to SQLite.
     * This ensures worldbuilding data survives refresh.
     */
    private async syncFolderToSqlite(folderId: string): Promise<void> {
        try {
            if (!this.goKittStore.isReady) return;
            const updated = await db.folders.get(folderId);
            if (updated) {
                await this.goKittStore.upsertFolder(GoKittStoreService.fromDexieFolder(updated));
            }
        } catch (err) {
            console.warn('[WorldBuildingService] SQLite sync failed (non-fatal):', err);
        }
    }

    // =========================================================================================
    // UPDATE METHODS (Persist to IndexedDB + write-through to SQLite)
    // =========================================================================================

    /**
     * Update Global World Data
     */
    async updateWorldData(narrativeId: string, data: Partial<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
        powerSystems: PowerSystem[];
        religions: Religion[];
        mysteries: MysteryClue[];
    }>): Promise<void> {
        const folder = await db.folders.get(narrativeId);
        if (!folder) throw new Error('Narrative root not found');

        const attributes = folder.attributes || {};
        const world = attributes['world'] || {};

        if (data.snapshot) world.snapshot = data.snapshot;
        if (data.constraints) world.constraints = data.constraints;
        if (data.pillars) world.pillars = data.pillars;
        if (data.cultures) world.cultures = data.cultures;
        if (data.powerSystems) world.powerSystems = data.powerSystems;
        if (data.religions) world.religions = data.religions;
        if (data.mysteries) world.mysteries = data.mysteries;

        attributes['world'] = world;

        await db.folders.update(narrativeId, {
            attributes,
            updatedAt: Date.now()
        });

        // Write-through to SQLite
        await this.syncFolderToSqlite(narrativeId);
    }

    /**
     * Update Act Data
     */
    async updateActData(actFolderId: string, data: Partial<{
        statusQuo: string;
        deltas: ActDelta[];
        stakes: ActStake[];
        cultureOverrides: Record<string, CultureOverride>;
        powerProgression: Record<string, PowerProgression>;
        religionOverrides: Record<string, ReligionOverride>;
    }>): Promise<void> {
        const folder = await db.folders.get(actFolderId);
        if (!folder) throw new Error('Act folder not found');

        const attributes = folder.attributes || {};
        const act = attributes['act'] || {};

        if (data.statusQuo !== undefined) act.statusQuo = data.statusQuo;
        if (data.deltas) act.deltas = data.deltas;
        if (data.stakes) act.stakes = data.stakes;
        if (data.cultureOverrides) act.cultureOverrides = data.cultureOverrides;
        if (data.powerProgression) act.powerProgression = data.powerProgression;
        if (data.religionOverrides) act.religionOverrides = data.religionOverrides;

        attributes['act'] = act;

        await db.folders.update(actFolderId, {
            attributes,
            updatedAt: Date.now()
        });

        // Write-through to SQLite
        await this.syncFolderToSqlite(actFolderId);
    }

    async updateCultures(narrativeId: string, cultures: Culture[]): Promise<void> {
        await this.updateWorldData(narrativeId, { cultures });
    }

    async updateActCultureOverrides(actFolderId: string, overrides: Record<string, CultureOverride>): Promise<void> {
        await this.updateActData(actFolderId, { cultureOverrides: overrides });
    }

    async updatePowerSystems(narrativeId: string, powerSystems: PowerSystem[]): Promise<void> {
        await this.updateWorldData(narrativeId, { powerSystems });
    }

    async updateActPowerProgression(actFolderId: string, progression: Record<string, PowerProgression>): Promise<void> {
        await this.updateActData(actFolderId, { powerProgression: progression });
    }

    async updateReligions(narrativeId: string, religions: Religion[]): Promise<void> {
        await this.updateWorldData(narrativeId, { religions });
    }

    async updateActReligionOverrides(actFolderId: string, overrides: Record<string, ReligionOverride>): Promise<void> {
        await this.updateActData(actFolderId, { religionOverrides: overrides });
    }

    getCultures$(narrativeId: string): Observable<Culture[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.cultures));
    }

    getActCultureOverrides$(actFolderId: string): Observable<Record<string, CultureOverride>> {
        return this.getActData$(actFolderId).pipe(map(data => data.cultureOverrides));
    }

    getPowerSystems$(narrativeId: string): Observable<PowerSystem[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.powerSystems));
    }

    getActPowerProgression$(actFolderId: string): Observable<Record<string, PowerProgression>> {
        return this.getActData$(actFolderId).pipe(map(data => data.powerProgression));
    }

    getReligions$(narrativeId: string): Observable<Religion[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.religions));
    }

    getMysteries$(narrativeId: string): Observable<MysteryClue[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.mysteries));
    }

    getActReligionOverrides$(actFolderId: string): Observable<Record<string, ReligionOverride>> {
        return this.getActData$(actFolderId).pipe(map(data => data.religionOverrides));
    }

    /** @deprecated Use getLoreThreads$ instead */
    // Helper to update mysteries
    async updateMysteries(narrativeId: string, mysteries: MysteryClue[]): Promise<void> {
        await this.updateWorldData(narrativeId, { mysteries });
    }

    // ===================================
    // LORE THREADS (v2)
    // ===================================

    getLoreThreads$(narrativeId: string): Observable<LoreThread[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.loreThreads));
    }

    async updateLoreThreads(narrativeId: string, threads: LoreThread[]): Promise<void> {
        const folder = await db.folders.get(narrativeId);
        if (!folder) throw new Error('Narrative root not found');

        const attributes = folder.attributes || {};
        const world = attributes['world'] || {};
        world.loreThreads = threads;
        attributes['world'] = world;

        await db.folders.update(narrativeId, {
            attributes,
            updatedAt: Date.now()
        });

        // Write-through to SQLite
        await this.syncFolderToSqlite(narrativeId);
    }

    /*
     * Helper to create a new unique ID
     */
    generateId(): string {
        return crypto.randomUUID();
    }
}
