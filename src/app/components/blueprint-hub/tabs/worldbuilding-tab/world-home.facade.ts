import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { combineLatest, from, map, of, switchMap } from 'rxjs';

import { ScopeService, GLOBAL_SCOPE, type ResolvedScope } from '../../../../lib/services/scope.service';
import { ScopedDocumentService } from '../../../../lib/services/scoped-document.service';
import { RightSidebarService } from '../../../../lib/services/right-sidebar.service';
import { EntitySelectionService } from '../../../../lib/services/entity-selection.service';
import { BlueprintHubService } from '../../blueprint-hub.service';
import {
    DEFAULT_SNAPSHOT,
    WorldBuildingService,
    type ActDelta,
    type ActStake,
    type CanonConstraint,
    type Culture,
    type CultureOverride,
    type LoreThread,
    type PowerProgression,
    type PowerSystem,
    type Religion,
    type ReligionOverride,
    type WorldPillar,
    type WorldSnapshot,
} from '../../../../lib/services/world-building.service';
import { FactSheetService } from '../../../fact-sheets/fact-sheet.service';
import { CalendarService } from '../../../../services/calendar.service';
import type { CalendarEvent } from '../../../../lib/fantasy-calendar/types';
import type { RegisteredEntity } from '../../../../lib/registry';
import {
    type CalendarSummary,
    type CharacterRollupSummary,
    type KanbanSummary,
    type LoreThreadSummary,
    type ScopeInheritanceState,
    type WorldHomeViewModel,
    type WorldModuleSummary,
    type WorldSourceState,
} from './world-home.models';

const DOC_KEY = 'data';
const POLITICS_NAMESPACE = 'world.politics';
const OVERVIEW_NAMESPACE = 'world.overview';
const ACT_OVERVIEW_NAMESPACE = 'world.overview.act';
const CULTURES_NAMESPACE = 'world.cultures';
const CULTURE_OVERRIDES_NAMESPACE = 'world.cultures.overrides';
const MAGIC_NAMESPACE = 'world.magic';
const MAGIC_OVERRIDES_NAMESPACE = 'world.magic.overrides';
const RELIGION_NAMESPACE = 'world.religion';
const RELIGION_OVERRIDES_NAMESPACE = 'world.religion.overrides';
const MYSTERY_NAMESPACE = 'world.mystery';
const EMPTY_CALENDAR: CalendarSummary = { total: 0, upcoming: [], recent: [], emptyLabel: 'No scoped events yet.' };
const EMPTY_KANBAN: KanbanSummary = { todo: 0, inProgress: 0, completed: 0, total: 0 };
const DEFAULT_WORLD_DATA = {
    snapshot: DEFAULT_SNAPSHOT,
    constraints: [] as CanonConstraint[],
    pillars: [] as WorldPillar[],
    cultures: [] as Culture[],
    powerSystems: [] as PowerSystem[],
    religions: [] as Religion[],
    mysteries: [],
    loreThreads: [] as LoreThread[],
};
const DEFAULT_ACT_DATA = {
    statusQuo: '',
    deltas: [] as ActDelta[],
    stakes: [] as ActStake[],
    cultureOverrides: {} as Record<string, CultureOverride>,
    powerProgression: {} as Record<string, PowerProgression>,
    religionOverrides: {} as Record<string, ReligionOverride>,
};

interface PoliticsDocument {
    summary: string;
}

@Injectable()
export class WorldHomeFacade {
    private scopeService = inject(ScopeService);
    private worldBuilding = inject(WorldBuildingService);
    private scopedDocuments = inject(ScopedDocumentService);
    private factSheets = inject(FactSheetService);
    private calendar = inject(CalendarService);
    private router = inject(Router);
    private rightSidebar = inject(RightSidebarService);
    private entitySelection = inject(EntitySelectionService);
    private hub = inject(BlueprintHubService);

    private refresh = signal(0);
    private politicsSummaryStore = signal('');
    private inheritanceStore = signal<ScopeInheritanceState>({
        state: 'base',
        label: 'Base narrative',
        detail: 'World Home reads the narrative layer directly.',
        scopeLabel: 'Global',
        scopeType: 'global',
    });
    private charactersStore = signal<CharacterRollupSummary[]>([]);
    private moduleSources = signal<Record<string, WorldSourceState>>({
        cultures: 'base',
        magic: 'base',
        religion: 'base',
        politics: 'base',
        mystery: 'base',
    });

    readonly scope = this.scopeService.resolvedScope;
    readonly narrativeId = computed(() => this.scope().narrativeId ?? null);
    readonly hasNarrative = computed(() => !!this.narrativeId() && this.scope().scopeFolderId !== 'vault:global');
    readonly isActScope = computed(() => !!this.scope().actFolderId);
    readonly inheritance = computed(() => this.inheritanceStore());
    readonly characters = computed(() => this.charactersStore());
    readonly politicsSummary = computed(() => this.politicsSummaryStore());

    readonly worldData = toSignal(
        toObservable(this.narrativeId).pipe(
            switchMap((narrativeId) => narrativeId ? this.worldBuilding.getWorldData$(narrativeId) : of(DEFAULT_WORLD_DATA))
        ),
        { initialValue: DEFAULT_WORLD_DATA }
    );

    readonly actData = toSignal(
        toObservable(this.scope).pipe(
            switchMap((scope) => scope.actFolderId ? this.worldBuilding.getActData$(scope.actFolderId) : of(DEFAULT_ACT_DATA))
        ),
        { initialValue: DEFAULT_ACT_DATA }
    );

    readonly loreSummary = computed<LoreThreadSummary>(() => {
        const threads = this.worldData().loreThreads;
        return {
            total: threads.length,
            open: threads.filter((thread) => thread.status === 'open').length,
            hinted: threads.filter((thread) => thread.status === 'hinted').length,
            revealed: threads.filter((thread) => thread.status === 'revealed').length,
            dropped: threads.filter((thread) => thread.status === 'dropped').length,
            featured: [...threads]
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .slice(0, 4),
        };
    });

    readonly calendarSummary = computed<CalendarSummary>(() => {
        const events = [...this.calendar.events()].sort((left, right) => toFantasyOrdinal(left) - toFantasyOrdinal(right));
        if (!events.length) return EMPTY_CALENDAR;
        const pivot = toFantasyOrdinal({ date: this.calendar.viewDate() } as CalendarEvent);
        return {
            total: events.length,
            upcoming: events.filter((event) => toFantasyOrdinal(event) >= pivot).slice(0, 4),
            recent: [...events].reverse().slice(0, 3),
            emptyLabel: 'No scoped events yet.',
        };
    });

    readonly kanbanSummary = computed<KanbanSummary>(() => {
        const events = this.calendar.events();
        const todo = events.filter((event) => !event.status || event.status === 'todo').length;
        const inProgress = events.filter((event) => event.status === 'in-progress').length;
        const completed = events.filter((event) => event.status === 'completed').length;
        return { todo, inProgress, completed, total: events.length };
    });

    readonly modules = computed<WorldModuleSummary[]>(() => {
        const worldData = this.worldData();
        const actData = this.actData();
        const politicsSummary = this.politicsSummary();
        const sources = this.moduleSources();
        return [
            {
                id: 'cultures',
                label: 'Cultures',
                state: sources['cultures'],
                totalCount: worldData.cultures.length,
                overrideCount: Object.keys(actData.cultureOverrides).length,
                headline: worldData.cultures.length ? `${worldData.cultures.length} culture profiles` : 'No cultures yet',
                detail: worldData.cultures.length
                    ? `Overrides in scope: ${Object.keys(actData.cultureOverrides).length}`
                    : 'Quick-add the cultural spine for this narrative.',
                sampleLabels: worldData.cultures.slice(0, 3).map((entry) => entry.name),
            },
            {
                id: 'magic',
                label: 'Magic & Tech',
                state: sources['magic'],
                totalCount: worldData.powerSystems.length,
                overrideCount: Object.keys(actData.powerProgression).length,
                headline: worldData.powerSystems.length ? `${worldData.powerSystems.length} systems tracked` : 'No systems yet',
                detail: worldData.powerSystems.length
                    ? `Progress markers in scope: ${Object.keys(actData.powerProgression).length}`
                    : 'Track the rules and progression that matter right now.',
                sampleLabels: worldData.powerSystems.slice(0, 3).map((entry) => entry.name),
            },
            {
                id: 'religion',
                label: 'Religion',
                state: sources['religion'],
                totalCount: worldData.religions.length,
                overrideCount: Object.keys(actData.religionOverrides).length,
                headline: worldData.religions.length ? `${worldData.religions.length} faiths in play` : 'No faiths yet',
                detail: worldData.religions.length
                    ? `Act changes in scope: ${Object.keys(actData.religionOverrides).length}`
                    : 'Keep myths, sects, and moral pressure readable.',
                sampleLabels: worldData.religions.slice(0, 3).map((entry) => entry.name),
            },
            {
                id: 'politics',
                label: 'Politics',
                state: sources['politics'],
                totalCount: politicsSummary ? 1 : 0,
                overrideCount: 0,
                headline: politicsSummary ? 'Politics notes available' : 'No politics notes yet',
                detail: politicsSummary || 'Use this as the compact power map for the current scope.',
                sampleLabels: [],
            },
        ];
    });

    readonly viewModel = computed<WorldHomeViewModel>(() => ({
        scope: this.scope(),
        inheritance: this.inheritance(),
        snapshot: this.worldData().snapshot,
        statusQuo: this.actData().statusQuo,
        constraints: this.worldData().constraints,
        pillars: this.worldData().pillars,
        deltas: this.actData().deltas,
        stakes: this.actData().stakes,
        cultures: this.worldData().cultures,
        powerSystems: this.worldData().powerSystems,
        religions: this.worldData().religions,
        politicsSummary: this.politicsSummary(),
        modules: this.modules(),
        characters: this.characters(),
        lore: this.loreSummary(),
        calendar: this.calendarSummary(),
        kanban: this.kanbanSummary(),
    }));

    constructor() {
        effect(() => {
            this.scope();
            this.refresh();
            void this.reloadInheritance();
            void this.reloadPolitics();
            void this.reloadCharacters();
        });
    }

    async saveSnapshot(snapshot: WorldSnapshot): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId) return;
        await this.worldBuilding.updateWorldData(narrativeId, { snapshot });
        this.bump();
    }

    async saveStatusQuo(statusQuo: string): Promise<void> {
        const actFolderId = this.scope().actFolderId;
        if (!actFolderId) return;
        await this.worldBuilding.updateActData(actFolderId, { statusQuo });
        this.bump();
    }

    async saveConstraints(constraints: CanonConstraint[]): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId) return;
        await this.worldBuilding.updateWorldData(narrativeId, { constraints });
        this.bump();
    }

    async savePillars(pillars: WorldPillar[]): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId) return;
        await this.worldBuilding.updateWorldData(narrativeId, { pillars });
        this.bump();
    }

    async saveStakes(stakes: ActStake[]): Promise<void> {
        const actFolderId = this.scope().actFolderId;
        if (!actFolderId) return;
        await this.worldBuilding.updateActData(actFolderId, { stakes });
        this.bump();
    }

    async saveDeltas(deltas: ActDelta[]): Promise<void> {
        const actFolderId = this.scope().actFolderId;
        if (!actFolderId) return;
        await this.worldBuilding.updateActData(actFolderId, { deltas });
        this.bump();
    }

    async saveLoreThreads(threads: LoreThread[]): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId) return;
        await this.worldBuilding.updateLoreThreads(narrativeId, threads);
        this.bump();
    }

    async createCulture(name: string, summary: string): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId || !name.trim()) return;
        const next = [...this.worldData().cultures, defaultCulture(name, summary)];
        await this.worldBuilding.updateCultures(narrativeId, next);
        this.bump();
    }

    async createPowerSystem(name: string, description: string): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId || !name.trim()) return;
        const next = [...this.worldData().powerSystems, defaultPowerSystem(name, description)];
        await this.worldBuilding.updatePowerSystems(narrativeId, next);
        this.bump();
    }

    async createReligion(name: string, description: string): Promise<void> {
        const narrativeId = this.narrativeId();
        if (!narrativeId || !name.trim()) return;
        const next = [...this.worldData().religions, defaultReligion(name, description)];
        await this.worldBuilding.updateReligions(narrativeId, next);
        this.bump();
    }

    async savePoliticsSummary(summary: string): Promise<void> {
        const narrativeId = this.narrativeId();
        const scope = this.scope();
        if (!narrativeId || scope.scopeFolderId === 'vault:global') return;
        await this.scopedDocuments.savePayload(scope.scopeFolderId, narrativeId, POLITICS_NAMESPACE, DOC_KEY, { summary } satisfies PoliticsDocument);
        this.bump();
    }

    async openCalendarView(view: 'calendar' | 'kanban'): Promise<void> {
        await this.router.navigate(['/calendar'], { queryParams: { view } });
        this.hub.close();
    }

    openCharacter(entityId: string): void {
        this.entitySelection.select(entityId);
        this.rightSidebar.setActivePanel('entities');
        this.rightSidebar.open();
    }

    private bump(): void {
        this.refresh.update((value) => value + 1);
    }

    private async reloadPolitics(): Promise<void> {
        const narrativeId = this.narrativeId();
        const scope = this.scope();
        if (!narrativeId || scope.scopeFolderId === 'vault:global') {
            this.politicsSummaryStore.set('');
            return;
        }
        const direct = await this.scopedDocuments.findPayload(scope.scopeFolderId, POLITICS_NAMESPACE, DOC_KEY, { summary: '' });
        if (direct?.summary) {
            this.politicsSummaryStore.set(direct.summary);
            return;
        }
        if (scope.scopeFolderId !== narrativeId) {
            const fallback = await this.scopedDocuments.findPayload(narrativeId, POLITICS_NAMESPACE, DOC_KEY, { summary: '' });
            this.politicsSummaryStore.set(fallback?.summary || '');
            return;
        }
        this.politicsSummaryStore.set('');
    }

    private async reloadInheritance(): Promise<void> {
        const scope = this.scope();
        const narrativeId = this.narrativeId();
        if (!narrativeId || scope.scopeFolderId === 'vault:global') {
            this.inheritanceStore.set({
                state: 'base',
                label: 'Select a narrative',
                detail: 'World Home wakes up when the current note lives inside a narrative scope.',
                scopeLabel: 'Global',
                scopeType: scope.scopeType,
            });
            return;
        }
        if (scope.scopeFolderId === narrativeId) {
            this.moduleSources.set({
                cultures: 'base',
                magic: 'base',
                religion: 'base',
                politics: 'base',
                mystery: 'base',
            });
            this.inheritanceStore.set({
                state: 'base',
                label: 'Base narrative',
                detail: 'You are editing the narrative layer directly.',
                scopeLabel: scope.label || 'Narrative',
                scopeType: scope.scopeType,
            });
            return;
        }

        const [overview, actOverview, cultures, cultureOverrides, magic, magicOverrides, religion, religionOverrides, politics, mystery] = await Promise.all([
            this.scopedDocuments.findPayload(scope.scopeFolderId, OVERVIEW_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, ACT_OVERVIEW_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, CULTURES_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, CULTURE_OVERRIDES_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, MAGIC_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, MAGIC_OVERRIDES_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, RELIGION_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, RELIGION_OVERRIDES_NAMESPACE, DOC_KEY, {}),
            this.scopedDocuments.findPayload(scope.scopeFolderId, POLITICS_NAMESPACE, DOC_KEY, { summary: '' }),
            this.scopedDocuments.findPayload(scope.scopeFolderId, MYSTERY_NAMESPACE, DOC_KEY, {}),
        ]);

        const sources = {
            cultures: pickSource(cultures, cultureOverrides),
            magic: pickSource(magic, magicOverrides),
            religion: pickSource(religion, religionOverrides),
            politics: politics?.summary ? 'local-overrides' : 'inherited',
            mystery: mystery ? 'local-overrides' : 'inherited',
        } satisfies Record<string, WorldSourceState>;
        this.moduleSources.set(sources);

        const hasLocal = [overview, actOverview, cultures, cultureOverrides, magic, magicOverrides, religion, religionOverrides, politics, mystery].some(Boolean);
        this.inheritanceStore.set({
            state: hasLocal ? 'local-overrides' : 'inherited',
            label: hasLocal ? 'Local overrides' : 'Inherited state',
            detail: hasLocal
                ? 'This scope has its own stored world notes or act deltas.'
                : 'This scope is reading forward from the narrative without local world overrides yet.',
            scopeLabel: scope.label || 'Scoped world',
            scopeType: scope.scopeType,
        });
    }

    private async reloadCharacters(): Promise<void> {
        const scope = this.scope();
        const entities = this.scopeService.scopedEntities()
            .filter((entity) => entity.kind === 'CHARACTER')
            .sort((left, right) => right.lastSeenDate.getTime() - left.lastSeenDate.getTime())
            .slice(0, 6);

        const summaries = await Promise.all(entities.map((entity) => this.buildCharacterSummary(entity, scope)));
        this.charactersStore.set(summaries);
    }

    private async buildCharacterSummary(entity: RegisteredEntity, scope: ResolvedScope): Promise<CharacterRollupSummary> {
        const attributes = await this.factSheets.loadAttributes(entity.id, scope.scopeFolderId);
        return {
            entityId: entity.id,
            label: entity.label,
            fullName: readString(attributes, 'fullName') || entity.label,
            role: readString(attributes, 'occupation') || readString(attributes, 'role') || 'No role yet',
            status: readString(attributes, 'status') || readArray(attributes, 'statusConditions')[0] || 'Unspecified',
            factions: readArray(attributes, 'factions').slice(0, 3),
            totalMentions: entity.totalMentions,
            lastSeenLabel: entity.lastSeenDate.toLocaleDateString(),
        };
    }
}

function pickSource(primary: unknown, secondary?: unknown): WorldSourceState {
    return primary || secondary ? 'local-overrides' : 'inherited';
}

function readString(values: Record<string, any>, key: string): string {
    const value = values[key];
    return typeof value === 'string' ? value.trim() : '';
}

function readArray(values: Record<string, any>, key: string): string[] {
    const value = values[key];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()) : [];
}

function toFantasyOrdinal(event: Pick<CalendarEvent, 'date'>): number {
    return (event.date.year * 372) + (event.date.monthIndex * 31) + event.date.dayIndex;
}

function defaultCulture(name: string, summary: string): Culture {
    return {
        id: crypto.randomUUID(),
        name,
        icon: '◎',
        color: '#14b8a6',
        identity: { values: [], virtues: [], vices: [] },
        structure: { hierarchy: summary || 'No structure defined yet.', family: '', gender: '' },
        customs: { greetings: '', rituals: '', taboos: [] },
        language: { name: '', description: summary || '' },
        hooks: { misunderstandings: [], rituals: [], obligations: [] },
    };
}

function defaultPowerSystem(name: string, description: string): PowerSystem {
    return {
        id: crypto.randomUUID(),
        name,
        type: 'magic',
        description,
        rules: { limits: '', costs: '', failureModes: '' },
        capabilities: [],
    };
}

function defaultReligion(name: string, description: string): Religion {
    return {
        id: crypto.randomUUID(),
        name,
        type: 'Faith',
        description,
        symbols: [],
        adjectives: [],
        cosmology: { creation: '', afterlife: '', moralCode: '' },
        practices: { rituals: '', holidays: [], taboos: [] },
        deities: [],
        structure: { hierarchy: '', leadership: '' },
        sects: [],
        scriptures: [],
        myths: [],
        prayers: [],
    };
}
