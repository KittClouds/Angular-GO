
import { Injectable, inject, signal } from '@angular/core';
import { Observable, combineLatest, from, map, of, switchMap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { db } from '../dexie/db';
import { ScopeService } from './scope.service';
import { ScopedDocumentService } from './scoped-document.service';

export interface WorldSnapshot {
    logline: string;
    tone: string[];
    description: string;
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
    icon: string;
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

export interface Culture {
    id: string;
    name: string;
    icon: string;
    color: string;
    identity: {
        values: string[];
        virtues: string[];
        vices: string[];
    };
    structure: {
        hierarchy: string;
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
    hooks: {
        misunderstandings: string[];
        rituals: string[];
        obligations: string[];
    };
}

export interface CultureOverride {
    status: 'Stable' | 'Reforming' | 'Fragmenting' | 'Occupied' | 'Extinct';
    changelog: string;
}

export interface PowerCapability {
    id: string;
    name: string;
    type: 'spell' | 'tech' | 'artifact' | 'hybrid';
    description: string;
    cost: string[];
    risks: string[];
    prerequisites: string[];
    position?: { x: number, y: number };
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
    note?: string;
}

export interface Deity {
    id: string;
    name: string;
    domains: string[];
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
    divergence: string;
}

export interface Religion {
    id: string;
    name: string;
    type: string;
    description: string;
    symbols: string[];
    adjectives: string[];
    cosmology: {
        creation: string;
        afterlife: string;
        moralCode: string;
    };
    practices: {
        rituals: string;
        holidays: string[];
        taboos: string[];
    };
    deities: Deity[];
    structure: {
        hierarchy: string;
        leadership: string;
    };
    sects: Sect[];
    scriptures: string[];
    myths: MythBlock[];
    prayers: string[];
}

export interface ReligionOverride {
    status: 'Stable' | 'Schism' | 'Reform' | 'Persecuted' | 'Dominant';
    changes: string[];
}

export type ClueType = 'artifact' | 'testimony' | 'record' | 'anomaly' | 'symbol';
export type ClueStatus = 'Open' | 'Chasing' | 'Stalled' | 'Resolved' | 'Retconned';

export interface MysteryClue {
    id: string;
    summary: string;
    type: ClueType;
    provenance: string;
    timeBounds: string;
    reliability: string;
    confidence: number;
    status: ClueStatus;
    actId?: string;
    locks: {
        access: string;
        skill: string;
        ally: string;
        location: string;
        event: string;
    };
    risks: {
        attention: string;
        resource: string;
        moral: string;
        escalation: string;
        contradiction: string;
    };
    parties: {
        name: string;
        motivation: string;
    }[];
    payoff: {
        decision: string;
        spawns: string;
    };
}

export type ThreadStatus = 'open' | 'hinted' | 'revealed' | 'dropped';

export interface LoreThread {
    id: string;
    question: string;
    status: ThreadStatus;
    plantedIn?: string;
    answer?: string;
    connectedEntities: string[];
    createdAt: number;
    updatedAt: number;
}

export interface WorldScopeData {
    snapshot: WorldSnapshot;
    constraints: CanonConstraint[];
    pillars: WorldPillar[];
    cultures: Culture[];
    powerSystems: PowerSystem[];
    religions: Religion[];
    mysteries: MysteryClue[];
    loreThreads: LoreThread[];
    statusQuo: string;
    deltas: ActDelta[];
    stakes: ActStake[];
    cultureOverrides: Record<string, CultureOverride>;
    powerProgression: Record<string, PowerProgression>;
    religionOverrides: Record<string, ReligionOverride>;
}

interface OverviewDocument {
    snapshot: WorldSnapshot;
    constraints: CanonConstraint[];
    pillars: WorldPillar[];
}

interface CulturesDocument {
    cultures: Culture[];
}

interface CultureOverridesDocument {
    overrides: Record<string, CultureOverride>;
}

interface MagicDocument {
    powerSystems: PowerSystem[];
}

interface MagicOverridesDocument {
    progression: Record<string, PowerProgression>;
}

interface ReligionDocument {
    religions: Religion[];
}

interface ReligionOverridesDocument {
    overrides: Record<string, ReligionOverride>;
}

interface MysteryDocument {
    mysteries: MysteryClue[];
    loreThreads: LoreThread[];
}

interface ActOverviewDocument {
    statusQuo: string;
    deltas: ActDelta[];
    stakes: ActStake[];
}

const WORLD_OVERVIEW_NAMESPACE = 'world.overview';
const WORLD_CULTURES_NAMESPACE = 'world.cultures';
const WORLD_CULTURE_OVERRIDES_NAMESPACE = 'world.cultures.overrides';
const WORLD_MAGIC_NAMESPACE = 'world.magic';
const WORLD_MAGIC_OVERRIDES_NAMESPACE = 'world.magic.overrides';
const WORLD_RELIGION_NAMESPACE = 'world.religion';
const WORLD_RELIGION_OVERRIDES_NAMESPACE = 'world.religion.overrides';
const WORLD_MYSTERY_NAMESPACE = 'world.mystery';
const WORLD_GEOGRAPHY_NAMESPACE = 'world.geography';
const WORLD_POLITICS_NAMESPACE = 'world.politics';
const WORLD_ACT_OVERVIEW_NAMESPACE = 'world.overview.act';
const DOC_KEY = 'data';

const DEFAULT_OVERVIEW_DOC: OverviewDocument = {
    snapshot: DEFAULT_SNAPSHOT,
    constraints: [],
    pillars: [],
};

const DEFAULT_CULTURES_DOC: CulturesDocument = {
    cultures: [],
};

const DEFAULT_CULTURE_OVERRIDES_DOC: CultureOverridesDocument = {
    overrides: {},
};

const DEFAULT_MAGIC_DOC: MagicDocument = {
    powerSystems: [],
};

const DEFAULT_MAGIC_OVERRIDES_DOC: MagicOverridesDocument = {
    progression: {},
};

const DEFAULT_RELIGION_DOC: ReligionDocument = {
    religions: [],
};

const DEFAULT_RELIGION_OVERRIDES_DOC: ReligionOverridesDocument = {
    overrides: {},
};

const DEFAULT_MYSTERY_DOC: MysteryDocument = {
    mysteries: [],
    loreThreads: [],
};

const DEFAULT_ACT_OVERVIEW_DOC: ActOverviewDocument = {
    statusQuo: '',
    deltas: [],
    stakes: [],
};

@Injectable({
    providedIn: 'root'
})
export class WorldBuildingService {
    private scopedDocuments = inject(ScopedDocumentService);
    private scopeService = inject(ScopeService);
    private refresh = signal(0);
    
    // Evaluate toObservable() once during class instantiation to leverage active injection context
    private scope$ = toObservable(this.scopeService.resolvedScope);
    private refresh$ = toObservable(this.refresh);

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
        const DEFAULT = { snapshot: DEFAULT_SNAPSHOT, constraints: [], pillars: [], cultures: [], powerSystems: [], religions: [], mysteries: [], loreThreads: [] };

        return combineLatest([
            this.scope$,
            this.refresh$,
        ]).pipe(
            switchMap(([scope]) => {
                if (!narrativeId) return of(DEFAULT);
                return from(this.loadWorldData(narrativeId, scope.scopeFolderId || narrativeId));
            })
        );
    }

    getActData$(actFolderId: string): Observable<{
        statusQuo: string;
        deltas: ActDelta[];
        stakes: ActStake[];
        cultureOverrides: Record<string, CultureOverride>;
        powerProgression: Record<string, PowerProgression>;
        religionOverrides: Record<string, ReligionOverride>;
    }> {
        const DEFAULT = { statusQuo: '', deltas: [], stakes: [], cultureOverrides: {}, powerProgression: {}, religionOverrides: {} };

        if (!actFolderId) return of(DEFAULT);

        return this.refresh$.pipe(
            switchMap(() => from(this.loadActData(actFolderId)))
        );
    }

    async updateWorldData(narrativeId: string, data: Partial<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
        powerSystems: PowerSystem[];
        religions: Religion[];
        mysteries: MysteryClue[];
    }>): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);

        const overview = await this.loadOverviewDocument(scopeFolderId, narrativeId);
        const cultures = await this.loadCulturesDocument(scopeFolderId, narrativeId);
        const magic = await this.loadMagicDocument(scopeFolderId, narrativeId);
        const religion = await this.loadReligionDocument(scopeFolderId, narrativeId);
        const mystery = await this.loadMysteryDocument(scopeFolderId, narrativeId);

        if (data.snapshot) overview.snapshot = data.snapshot;
        if (data.constraints) overview.constraints = data.constraints;
        if (data.pillars) overview.pillars = data.pillars;
        if (data.cultures) cultures.cultures = data.cultures;
        if (data.powerSystems) magic.powerSystems = data.powerSystems;
        if (data.religions) religion.religions = data.religions;
        if (data.mysteries) mystery.mysteries = data.mysteries;

        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_OVERVIEW_NAMESPACE, DOC_KEY, overview);
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_CULTURES_NAMESPACE, DOC_KEY, cultures);
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_MAGIC_NAMESPACE, DOC_KEY, magic);
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_RELIGION_NAMESPACE, DOC_KEY, religion);
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_MYSTERY_NAMESPACE, DOC_KEY, mystery);
        await this.ensurePlaceholderScopeDocs(scopeFolderId, narrativeId);
        this.bumpRefresh();
    }

    async updateActData(actFolderId: string, data: Partial<{
        statusQuo: string;
        deltas: ActDelta[];
        stakes: ActStake[];
        cultureOverrides: Record<string, CultureOverride>;
        powerProgression: Record<string, PowerProgression>;
        religionOverrides: Record<string, ReligionOverride>;
    }>): Promise<void> {
        const actFolder = await db.folders.get(actFolderId);
        if (!actFolder?.narrativeId) throw new Error('Act folder not found');

        const overview = await this.loadActOverviewDocument(actFolderId, actFolder.narrativeId);
        const cultureOverrides = await this.loadCultureOverridesDocument(actFolderId, actFolder.narrativeId);
        const magicOverrides = await this.loadMagicOverridesDocument(actFolderId, actFolder.narrativeId);
        const religionOverrides = await this.loadReligionOverridesDocument(actFolderId, actFolder.narrativeId);

        if (data.statusQuo !== undefined) overview.statusQuo = data.statusQuo;
        if (data.deltas) overview.deltas = data.deltas;
        if (data.stakes) overview.stakes = data.stakes;
        if (data.cultureOverrides) cultureOverrides.overrides = data.cultureOverrides;
        if (data.powerProgression) magicOverrides.progression = data.powerProgression;
        if (data.religionOverrides) religionOverrides.overrides = data.religionOverrides;

        await this.scopedDocuments.savePayload(actFolderId, actFolder.narrativeId, WORLD_ACT_OVERVIEW_NAMESPACE, DOC_KEY, overview);
        await this.scopedDocuments.savePayload(actFolderId, actFolder.narrativeId, WORLD_CULTURE_OVERRIDES_NAMESPACE, DOC_KEY, cultureOverrides);
        await this.scopedDocuments.savePayload(actFolderId, actFolder.narrativeId, WORLD_MAGIC_OVERRIDES_NAMESPACE, DOC_KEY, magicOverrides);
        await this.scopedDocuments.savePayload(actFolderId, actFolder.narrativeId, WORLD_RELIGION_OVERRIDES_NAMESPACE, DOC_KEY, religionOverrides);
        await this.ensurePlaceholderScopeDocs(actFolderId, actFolder.narrativeId);
        this.bumpRefresh();
    }

    async updateCultures(narrativeId: string, cultures: Culture[]): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);
        const doc = await this.loadCulturesDocument(scopeFolderId, narrativeId);
        doc.cultures = cultures;
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_CULTURES_NAMESPACE, DOC_KEY, doc);
        this.bumpRefresh();
    }

    async updateActCultureOverrides(actFolderId: string, overrides: Record<string, CultureOverride>): Promise<void> {
        const folder = await db.folders.get(actFolderId);
        if (!folder?.narrativeId) throw new Error('Act folder not found');
        await this.scopedDocuments.savePayload(actFolderId, folder.narrativeId, WORLD_CULTURE_OVERRIDES_NAMESPACE, DOC_KEY, { overrides });
        this.bumpRefresh();
    }

    async updatePowerSystems(narrativeId: string, powerSystems: PowerSystem[]): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);
        const doc = await this.loadMagicDocument(scopeFolderId, narrativeId);
        doc.powerSystems = powerSystems;
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_MAGIC_NAMESPACE, DOC_KEY, doc);
        this.bumpRefresh();
    }

    async updateActPowerProgression(actFolderId: string, progression: Record<string, PowerProgression>): Promise<void> {
        const folder = await db.folders.get(actFolderId);
        if (!folder?.narrativeId) throw new Error('Act folder not found');
        await this.scopedDocuments.savePayload(actFolderId, folder.narrativeId, WORLD_MAGIC_OVERRIDES_NAMESPACE, DOC_KEY, { progression });
        this.bumpRefresh();
    }

    async updateReligions(narrativeId: string, religions: Religion[]): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);
        const doc = await this.loadReligionDocument(scopeFolderId, narrativeId);
        doc.religions = religions;
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_RELIGION_NAMESPACE, DOC_KEY, doc);
        this.bumpRefresh();
    }

    async updateActReligionOverrides(actFolderId: string, overrides: Record<string, ReligionOverride>): Promise<void> {
        const folder = await db.folders.get(actFolderId);
        if (!folder?.narrativeId) throw new Error('Act folder not found');
        await this.scopedDocuments.savePayload(actFolderId, folder.narrativeId, WORLD_RELIGION_OVERRIDES_NAMESPACE, DOC_KEY, { overrides });
        this.bumpRefresh();
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

    async updateMysteries(narrativeId: string, mysteries: MysteryClue[]): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);
        const doc = await this.loadMysteryDocument(scopeFolderId, narrativeId);
        doc.mysteries = mysteries;
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_MYSTERY_NAMESPACE, DOC_KEY, doc);
        this.bumpRefresh();
    }

    getLoreThreads$(narrativeId: string): Observable<LoreThread[]> {
        return this.getWorldData$(narrativeId).pipe(map(data => data.loreThreads));
    }

    async updateLoreThreads(narrativeId: string, threads: LoreThread[]): Promise<void> {
        const scopeFolderId = this.resolveCurrentWorldScopeFolderId(narrativeId);
        const doc = await this.loadMysteryDocument(scopeFolderId, narrativeId);
        doc.loreThreads = threads;
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, WORLD_MYSTERY_NAMESPACE, DOC_KEY, doc);
        this.bumpRefresh();
    }

    generateId(): string {
        return crypto.randomUUID();
    }

    private async loadWorldData(narrativeId: string, currentScopeFolderId: string): Promise<{
        snapshot: WorldSnapshot;
        constraints: CanonConstraint[];
        pillars: WorldPillar[];
        cultures: Culture[];
        powerSystems: PowerSystem[];
        religions: Religion[];
        mysteries: MysteryClue[];
        loreThreads: LoreThread[];
    }> {
        const scopeFolderId = this.isScopeInNarrative(currentScopeFolderId, narrativeId) ? currentScopeFolderId : narrativeId;
        const overview = await this.loadOverviewDocument(scopeFolderId, narrativeId);
        const cultures = await this.loadCulturesDocument(scopeFolderId, narrativeId);
        const magic = await this.loadMagicDocument(scopeFolderId, narrativeId);
        const religion = await this.loadReligionDocument(scopeFolderId, narrativeId);
        const mystery = await this.loadMysteryDocument(scopeFolderId, narrativeId);

        return {
            snapshot: overview.snapshot,
            constraints: overview.constraints,
            pillars: overview.pillars,
            cultures: cultures.cultures,
            powerSystems: magic.powerSystems,
            religions: religion.religions,
            mysteries: mystery.mysteries,
            loreThreads: mystery.loreThreads,
        };
    }

    private async loadActData(actFolderId: string): Promise<{
        statusQuo: string;
        deltas: ActDelta[];
        stakes: ActStake[];
        cultureOverrides: Record<string, CultureOverride>;
        powerProgression: Record<string, PowerProgression>;
        religionOverrides: Record<string, ReligionOverride>;
    }> {
        const folder = await db.folders.get(actFolderId);
        if (!folder?.narrativeId) {
            return { statusQuo: '', deltas: [], stakes: [], cultureOverrides: {}, powerProgression: {}, religionOverrides: {} };
        }

        const overview = await this.loadActOverviewDocument(actFolderId, folder.narrativeId);
        const cultureOverrides = await this.loadCultureOverridesDocument(actFolderId, folder.narrativeId);
        const magicOverrides = await this.loadMagicOverridesDocument(actFolderId, folder.narrativeId);
        const religionOverrides = await this.loadReligionOverridesDocument(actFolderId, folder.narrativeId);

        return {
            statusQuo: overview.statusQuo,
            deltas: overview.deltas,
            stakes: overview.stakes,
            cultureOverrides: cultureOverrides.overrides,
            powerProgression: magicOverrides.progression,
            religionOverrides: religionOverrides.overrides,
        };
    }

    private async loadOverviewDocument(scopeFolderId: string, narrativeId: string): Promise<OverviewDocument> {
        return this.loadScopedWithNarrativeFallback(scopeFolderId, narrativeId, WORLD_OVERVIEW_NAMESPACE, DEFAULT_OVERVIEW_DOC, () => this.migrateLegacyNarrativeDocument(narrativeId, WORLD_OVERVIEW_NAMESPACE));
    }

    private async loadCulturesDocument(scopeFolderId: string, narrativeId: string): Promise<CulturesDocument> {
        return this.loadScopedWithNarrativeFallback(scopeFolderId, narrativeId, WORLD_CULTURES_NAMESPACE, DEFAULT_CULTURES_DOC, () => this.migrateLegacyNarrativeDocument(narrativeId, WORLD_CULTURES_NAMESPACE));
    }

    private async loadMagicDocument(scopeFolderId: string, narrativeId: string): Promise<MagicDocument> {
        return this.loadScopedWithNarrativeFallback(scopeFolderId, narrativeId, WORLD_MAGIC_NAMESPACE, DEFAULT_MAGIC_DOC, () => this.migrateLegacyNarrativeDocument(narrativeId, WORLD_MAGIC_NAMESPACE));
    }

    private async loadReligionDocument(scopeFolderId: string, narrativeId: string): Promise<ReligionDocument> {
        return this.loadScopedWithNarrativeFallback(scopeFolderId, narrativeId, WORLD_RELIGION_NAMESPACE, DEFAULT_RELIGION_DOC, () => this.migrateLegacyNarrativeDocument(narrativeId, WORLD_RELIGION_NAMESPACE));
    }

    private async loadMysteryDocument(scopeFolderId: string, narrativeId: string): Promise<MysteryDocument> {
        return this.loadScopedWithNarrativeFallback(scopeFolderId, narrativeId, WORLD_MYSTERY_NAMESPACE, DEFAULT_MYSTERY_DOC, () => this.migrateLegacyNarrativeDocument(narrativeId, WORLD_MYSTERY_NAMESPACE));
    }

    private async loadActOverviewDocument(actFolderId: string, narrativeId: string): Promise<ActOverviewDocument> {
        return this.scopedDocuments.getPayload(
            actFolderId,
            narrativeId,
            WORLD_ACT_OVERVIEW_NAMESPACE,
            DOC_KEY,
            DEFAULT_ACT_OVERVIEW_DOC,
            () => this.migrateLegacyActDocument(actFolderId, WORLD_ACT_OVERVIEW_NAMESPACE)
        );
    }

    private async loadCultureOverridesDocument(actFolderId: string, narrativeId: string): Promise<CultureOverridesDocument> {
        return this.scopedDocuments.getPayload(
            actFolderId,
            narrativeId,
            WORLD_CULTURE_OVERRIDES_NAMESPACE,
            DOC_KEY,
            DEFAULT_CULTURE_OVERRIDES_DOC,
            () => this.migrateLegacyActDocument(actFolderId, WORLD_CULTURE_OVERRIDES_NAMESPACE)
        );
    }

    private async loadMagicOverridesDocument(actFolderId: string, narrativeId: string): Promise<MagicOverridesDocument> {
        return this.scopedDocuments.getPayload(
            actFolderId,
            narrativeId,
            WORLD_MAGIC_OVERRIDES_NAMESPACE,
            DOC_KEY,
            DEFAULT_MAGIC_OVERRIDES_DOC,
            () => this.migrateLegacyActDocument(actFolderId, WORLD_MAGIC_OVERRIDES_NAMESPACE)
        );
    }

    private async loadReligionOverridesDocument(actFolderId: string, narrativeId: string): Promise<ReligionOverridesDocument> {
        return this.scopedDocuments.getPayload(
            actFolderId,
            narrativeId,
            WORLD_RELIGION_OVERRIDES_NAMESPACE,
            DOC_KEY,
            DEFAULT_RELIGION_OVERRIDES_DOC,
            () => this.migrateLegacyActDocument(actFolderId, WORLD_RELIGION_OVERRIDES_NAMESPACE)
        );
    }

    private async loadScopedWithNarrativeFallback<T>(
        scopeFolderId: string,
        narrativeId: string,
        namespace: string,
        defaultValue: T,
        legacyRootFallback: () => Promise<T | undefined>
    ): Promise<T> {
        const exact = await this.scopedDocuments.findPayload(scopeFolderId, namespace, DOC_KEY, defaultValue);
        if (exact) {
            return exact;
        }

        if (scopeFolderId !== narrativeId) {
            const narrativeValue = await this.scopedDocuments.getPayload(
                narrativeId,
                narrativeId,
                namespace,
                DOC_KEY,
                defaultValue,
                legacyRootFallback
            );
            return narrativeValue;
        }

        return this.scopedDocuments.getPayload(
            narrativeId,
            narrativeId,
            namespace,
            DOC_KEY,
            defaultValue,
            legacyRootFallback
        );
    }

    private async migrateLegacyNarrativeDocument(narrativeId: string, namespace: string): Promise<any | undefined> {
        const folder = await db.folders.get(narrativeId);
        if (!folder) return undefined;

        const world = folder.attributes?.['world'] || {};

        switch (namespace) {
            case WORLD_OVERVIEW_NAMESPACE:
                if (world.snapshot || world.constraints || world.pillars) {
                    return {
                        snapshot: world.snapshot || DEFAULT_SNAPSHOT,
                        constraints: world.constraints || [],
                        pillars: world.pillars || [],
                    } satisfies OverviewDocument;
                }
                break;
            case WORLD_CULTURES_NAMESPACE:
                if (world.cultures) {
                    return { cultures: world.cultures || [] } satisfies CulturesDocument;
                }
                break;
            case WORLD_MAGIC_NAMESPACE:
                if (world.powerSystems) {
                    return { powerSystems: world.powerSystems || [] } satisfies MagicDocument;
                }
                break;
            case WORLD_RELIGION_NAMESPACE:
                if (world.religions) {
                    return { religions: world.religions || [] } satisfies ReligionDocument;
                }
                break;
            case WORLD_MYSTERY_NAMESPACE:
                if (world.mysteries || world.loreThreads) {
                    return {
                        mysteries: world.mysteries || [],
                        loreThreads: world.loreThreads || [],
                    } satisfies MysteryDocument;
                }
                break;
        }

        return undefined;
    }

    private async migrateLegacyActDocument(actFolderId: string, namespace: string): Promise<any | undefined> {
        const folder = await db.folders.get(actFolderId);
        if (!folder) return undefined;

        const act = folder.attributes?.['act'] || {};

        switch (namespace) {
            case WORLD_ACT_OVERVIEW_NAMESPACE:
                if (act.statusQuo || act.deltas || act.stakes) {
                    return {
                        statusQuo: act.statusQuo || '',
                        deltas: act.deltas || [],
                        stakes: act.stakes || [],
                    } satisfies ActOverviewDocument;
                }
                break;
            case WORLD_CULTURE_OVERRIDES_NAMESPACE:
                if (act.cultureOverrides) {
                    return { overrides: act.cultureOverrides || {} } satisfies CultureOverridesDocument;
                }
                break;
            case WORLD_MAGIC_OVERRIDES_NAMESPACE:
                if (act.powerProgression) {
                    return { progression: act.powerProgression || {} } satisfies MagicOverridesDocument;
                }
                break;
            case WORLD_RELIGION_OVERRIDES_NAMESPACE:
                if (act.religionOverrides) {
                    return { overrides: act.religionOverrides || {} } satisfies ReligionOverridesDocument;
                }
                break;
        }

        return undefined;
    }

    private resolveCurrentWorldScopeFolderId(narrativeId: string): string {
        const scope = this.scopeService.resolvedScope();
        if (scope.narrativeId === narrativeId && scope.scopeFolderId && scope.scopeFolderId !== 'vault:global') {
            return scope.scopeFolderId;
        }
        return narrativeId;
    }

    private isScopeInNarrative(scopeFolderId: string, narrativeId: string): boolean {
        const scope = this.scopeService.resolvedScope();
        return scope.scopeFolderId === scopeFolderId && scope.narrativeId === narrativeId;
    }

    private async ensurePlaceholderScopeDocs(scopeFolderId: string, narrativeId: string): Promise<void> {
        await this.scopedDocuments.getPayload(scopeFolderId, narrativeId, WORLD_GEOGRAPHY_NAMESPACE, DOC_KEY, {});
        await this.scopedDocuments.getPayload(scopeFolderId, narrativeId, WORLD_POLITICS_NAMESPACE, DOC_KEY, {});
    }

    private bumpRefresh(): void {
        this.refresh.update(value => value + 1);
    }
}
