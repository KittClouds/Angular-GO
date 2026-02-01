
import { Injectable } from '@angular/core';
import { liveQuery, Observable as DexieObservable } from 'dexie';
import { from, Observable, switchMap, map, of } from 'rxjs';
import { db, Folder } from '../dexie/db';

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
    // Maybe allow overriding specific fields later if needed
}

export interface WorldScopeData {
    // Global Data (stored on Narrative Root)
    snapshot: WorldSnapshot;
    constraints: CanonConstraint[];
    pillars: WorldPillar[];
    cultures: Culture[]; // Added Cultures

    // Act Data (stored on Act Folder)
    statusQuo: string;
    deltas: ActDelta[];
    cultureOverrides: Record<string, CultureOverride>; // Keyed by CultureID
}

@Injectable({
    providedIn: 'root'
})
export class WorldBuildingService {

    constructor() { }

    /**
     * Get the root narrative folder for a given narrative ID.
     */
    private async getNarrativeFolder(narrativeId: string): Promise<Folder | undefined> {
        // Find the folder where isNarrativeRoot is true and narrativeId matches
        // OR simply get by ID if narrativeId IS the folder ID (which is true for roots)
        return db.folders.get(narrativeId);
    }

    /**
     * Get World Data (Snapshot, Constraints, Pillars, Cultures) from the Narrative Root.
     */
    getWorldData$(narrativeId: string): Observable<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
    }> {
        return from(liveQuery(async () => {
            const folder = await db.folders.get(narrativeId); // Assuming narrativeId is the root folder ID
            if (!folder) return { snapshot: DEFAULT_SNAPSHOT, constraints: [], pillars: [], cultures: [] };

            const world = folder.attributes?.['world'] || {};
            return {
                snapshot: world.snapshot || DEFAULT_SNAPSHOT,
                constraints: world.constraints || [],
                pillars: world.pillars || [],
                cultures: world.cultures || []
            };
        }));
    }

    /**
     * Get Act Data (Status Quo, Deltas, Culture Overrides) from an Act Folder.
     */
    getActData$(actFolderId: string): Observable<{
        statusQuo: string;
        deltas: ActDelta[];
        cultureOverrides: Record<string, CultureOverride>;
    }> {
        if (!actFolderId) return of({ statusQuo: '', deltas: [], cultureOverrides: {} });

        return from(liveQuery(async () => {
            const folder = await db.folders.get(actFolderId);
            if (!folder) return { statusQuo: '', deltas: [], cultureOverrides: {} };

            const act = folder.attributes?.['act'] || {};
            return {
                statusQuo: act.statusQuo || '',
                deltas: act.deltas || [],
                cultureOverrides: act.cultureOverrides || {}
            };
        }));
    }

    // =========================================================================================
    // UPDATE METHODS (Persist to IndexedDB)
    // =========================================================================================

    /**
     * Update Global World Data (Snapshot, Constraints, Pillars, Cultures)
     */
    async updateWorldData(narrativeId: string, data: Partial<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
    }>): Promise<void> {
        const folder = await db.folders.get(narrativeId);
        if (!folder) throw new Error('Narrative root not found');

        const attributes = folder.attributes || {};
        const world = attributes['world'] || {};

        if (data.snapshot) world.snapshot = data.snapshot;
        if (data.constraints) world.constraints = data.constraints;
        if (data.pillars) world.pillars = data.pillars;
        if (data.cultures) world.cultures = data.cultures;

        attributes['world'] = world;

        await db.folders.update(narrativeId, {
            attributes,
            updatedAt: Date.now()
        });
    }

    /**
     * Update Act Data (Status Quo, Deltas, Culture Overrides)
     */
    async updateActData(actFolderId: string, data: Partial<{
        statusQuo: string;
        deltas: ActDelta[];
        cultureOverrides: Record<string, CultureOverride>;
    }>): Promise<void> {
        const folder = await db.folders.get(actFolderId);
        if (!folder) throw new Error('Act folder not found');

        const attributes = folder.attributes || {};
        const act = attributes['act'] || {};

        if (data.statusQuo !== undefined) act.statusQuo = data.statusQuo;
        if (data.deltas) act.deltas = data.deltas;
        if (data.cultureOverrides) act.cultureOverrides = data.cultureOverrides;

        attributes['act'] = act;

        await db.folders.update(actFolderId, {
            attributes,
            updatedAt: Date.now()
        });
    }

    async updateCultures(narrativeId: string, cultures: Culture[]): Promise<void> {
        await this.updateWorldData(narrativeId, { cultures });
    }

    async updateActCultureOverrides(actFolderId: string, overrides: Record<string, CultureOverride>): Promise<void> {
        await this.updateActData(actFolderId, { cultureOverrides: overrides });
    }

    getCultures$(narrativeId: string): Observable<Culture[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.cultures));
    }

    getActCultureOverrides$(actFolderId: string): Observable<Record<string, CultureOverride>> {
        return this.getActData$(actFolderId).pipe(map(data => data.cultureOverrides));
    }

    /*
     * Helper to create a new unique ID
     */
    generateId(): string {
        return crypto.randomUUID();
    }
}
