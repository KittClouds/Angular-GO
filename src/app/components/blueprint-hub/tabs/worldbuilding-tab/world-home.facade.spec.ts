import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
    ɵEffectScheduler as EffectScheduler,
    type EnvironmentInjector,
} from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorldHomeFacade } from './world-home.facade';
import { ScopeService, type ResolvedScope } from '../../../../lib/services/scope.service';
import { WorldBuildingService, DEFAULT_SNAPSHOT, type Culture, type LoreThread, type PowerSystem, type Religion } from '../../../../lib/services/world-building.service';
import { ScopedDocumentService } from '../../../../lib/services/scoped-document.service';
import { FactSheetService } from '../../../fact-sheets/fact-sheet.service';
import { CalendarService } from '../../../../services/calendar.service';
import { RightSidebarService } from '../../../../lib/services/right-sidebar.service';
import { EntitySelectionService } from '../../../../lib/services/entity-selection.service';
import { BlueprintHubService } from '../../blueprint-hub.service';
import { Router } from '@angular/router';
import type { RegisteredEntity } from '../../../../lib/registry';

describe('WorldHomeFacade', () => {
    let injector: EnvironmentInjector;
    let facade: WorldHomeFacade;
    let scopeSignal: ReturnType<typeof signal<ResolvedScope>>;
    let scopedEntitiesSignal: ReturnType<typeof signal<RegisteredEntity[]>>;
    let worldDataSubject: BehaviorSubject<any>;
    let actDataSubject: BehaviorSubject<any>;
    let routerMock: { navigate: ReturnType<typeof vi.fn> };
    let rightSidebarMock: { setActivePanel: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
    let entitySelectionMock: { select: ReturnType<typeof vi.fn> };
    let hubMock: { close: ReturnType<typeof vi.fn> };
    let changeDetectionSchedulerMock: { notify: ReturnType<typeof vi.fn>; runningTick: boolean };
    let effectSchedulerMock: {
        add: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };

    const actScope: ResolvedScope = {
        type: 'act',
        id: 'act-2',
        scopeType: 'act',
        scopeFolderId: 'act-2',
        actFolderId: 'act-2',
        actId: 'act-2',
        narrativeId: 'nar-1',
        lineageFolderIds: ['nar-1', 'act-2'],
        label: 'Act 2',
    };

    const culture: Culture = {
        id: 'culture-1',
        name: 'Lantern Court',
        icon: 'O',
        color: '#14b8a6',
        identity: { values: ['duty'], virtues: ['discipline'], vices: ['rigidity'] },
        structure: { hierarchy: 'strict', family: 'clan', gender: 'egalitarian' },
        customs: { greetings: 'formal bows', rituals: 'dawn assembly', taboos: ['public weakness'] },
        language: { name: 'Court Tongue', description: 'precise and ceremonial' },
        hooks: { misunderstandings: ['silence means refusal'], rituals: ['night watch'], obligations: ['oaths'] },
    };

    const powerSystem: PowerSystem = {
        id: 'power-1',
        name: 'Embercraft',
        type: 'magic',
        description: 'Heat shaped into structures.',
        rules: { limits: 'burnout', costs: 'fuel', failureModes: 'flare collapse' },
        capabilities: [],
    };

    const religion: Religion = {
        id: 'religion-1',
        name: 'Church of Dawn',
        type: 'Faith',
        description: 'A solar doctrine.',
        symbols: ['sun'],
        adjectives: ['radiant'],
        cosmology: { creation: 'light first', afterlife: 'the warm shore', moralCode: 'protect the weak' },
        practices: { rituals: 'sunrise hymn', holidays: ['First Light'], taboos: ['oathbreaking'] },
        deities: [],
        structure: { hierarchy: 'tiers', leadership: 'high cantor' },
        sects: [],
        scriptures: [],
        myths: [],
        prayers: [],
    };

    const loreThread: LoreThread = {
        id: 'thread-1',
        question: 'Who broke the lantern seal?',
        status: 'open',
        connectedEntities: ['entity-aella'],
        createdAt: 10,
        updatedAt: 20,
    };

    beforeEach(() => {
        scopeSignal = signal(actScope);
        scopedEntitiesSignal = signal([
            createEntity('entity-aella', 'Aella', 12),
            createEntity('entity-kai', 'Kai', 9),
        ]);
        worldDataSubject = new BehaviorSubject({
            snapshot: { ...DEFAULT_SNAPSHOT, logline: 'The world bends but does not break.' },
            constraints: [{ id: 'rule-1', text: 'No resurrection.', isActive: true }],
            pillars: [{ id: 'pillar-1', title: 'Mercy costs', description: 'Compassion changes the board.', icon: 'pi pi-heart' }],
            cultures: [culture],
            powerSystems: [powerSystem],
            religions: [religion],
            mysteries: [],
            loreThreads: [loreThread],
        });
        actDataSubject = new BehaviorSubject({
            statusQuo: 'Act 2 is all fractures and pressure.',
            deltas: [{ id: 'delta-1', title: 'Seal cracked', description: 'The lantern failed.', type: 'changed' }],
            stakes: [{ id: 'stake-1', title: 'City stability', details: 'The ward network is failing.', pressure: 'critical' }],
            cultureOverrides: { 'culture-1': { status: 'Reforming', changelog: 'The court is splitting.' } },
            powerProgression: {},
            religionOverrides: {},
        });
        routerMock = { navigate: vi.fn().mockResolvedValue(true) };
        rightSidebarMock = { setActivePanel: vi.fn(), open: vi.fn() };
        entitySelectionMock = { select: vi.fn() };
        hubMock = { close: vi.fn() };
        changeDetectionSchedulerMock = {
            notify: vi.fn(),
            runningTick: false,
        };
        const scheduledEffects = new Set<{ dirty?: boolean; run: () => void }>();
        let flushPending = false;
        const flushEffects = () => {
            flushPending = false;
            for (const handle of Array.from(scheduledEffects)) {
                scheduledEffects.delete(handle);
                if (handle.dirty === false) continue;
                handle.run();
            }
        };
        const scheduleEffects = () => {
            if (flushPending) return;
            flushPending = true;
            Promise.resolve().then(flushEffects);
        };
        effectSchedulerMock = {
            add: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            schedule: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            flush: vi.fn(flushEffects),
            remove: vi.fn((handle) => {
                scheduledEffects.delete(handle);
            }),
        };

        injector = createEnvironmentInjector([
            {
                provide: ScopeService,
                useValue: {
                    resolvedScope: scopeSignal,
                    scopedEntities: scopedEntitiesSignal,
                },
            },
            {
                provide: WorldBuildingService,
                useValue: {
                    getWorldData$: () => worldDataSubject,
                    getActData$: () => actDataSubject,
                    saveSnapshot: vi.fn(),
                    updateWorldData: vi.fn(),
                    updateActData: vi.fn(),
                    updateLoreThreads: vi.fn(),
                    updateCultures: vi.fn(),
                    updatePowerSystems: vi.fn(),
                    updateReligions: vi.fn(),
                },
            },
            {
                provide: ScopedDocumentService,
                useValue: {
                    findPayload: vi.fn(async (scopeFolderId: string, namespace: string) => {
                        if (scopeFolderId !== 'act-2') return null;
                        if (namespace === 'world.cultures.overrides') return { overrides: { 'culture-1': true } };
                        if (namespace === 'world.overview.act') return { statusQuo: 'present' };
                        return null;
                    }),
                    savePayload: vi.fn(),
                },
            },
            {
                provide: FactSheetService,
                useValue: {
                    loadAttributes: vi.fn(async (entityId: string) => {
                        if (entityId === 'entity-aella') {
                            return {
                                fullName: 'Aella of Lantern Reach',
                                occupation: 'Warden',
                                status: 'Alive',
                                factions: ['Lantern Court'],
                            };
                        }
                        return {
                            fullName: 'Kai Voss',
                            occupation: 'Breaker',
                            statusConditions: ['Injured'],
                            factions: ['Harbor Watch'],
                        };
                    }),
                },
            },
            {
                provide: CalendarService,
                useValue: {
                    events: signal([
                        { id: 'event-1', title: 'Briefing', date: { year: 10, monthIndex: 2, dayIndex: 4 }, status: 'todo' },
                        { id: 'event-2', title: 'Collapse', date: { year: 10, monthIndex: 2, dayIndex: 5 }, status: 'in-progress' },
                        { id: 'event-3', title: 'Repair', date: { year: 10, monthIndex: 2, dayIndex: 6 }, status: 'completed' },
                    ]),
                    viewDate: signal({ year: 10, monthIndex: 2, dayIndex: 5 }),
                },
            },
            { provide: Router, useValue: routerMock },
            { provide: RightSidebarService, useValue: rightSidebarMock },
            { provide: EntitySelectionService, useValue: entitySelectionMock },
            { provide: BlueprintHubService, useValue: hubMock },
            { provide: ChangeDetectionScheduler, useValue: changeDetectionSchedulerMock },
            { provide: EffectScheduler, useValue: effectSchedulerMock },
        ], Injector.create({ providers: [] }));

        facade = runInInjectionContext(injector, () => new WorldHomeFacade());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('builds scoped summaries for an act and marks inherited vs local state', async () => {
        await flushAsync(effectSchedulerMock);

        const vm = facade.viewModel();

        expect(vm.inheritance.state).toBe('local-overrides');
        expect(vm.statusQuo).toBe('Act 2 is all fractures and pressure.');
        expect(vm.modules.find((entry) => entry.id === 'cultures')?.overrideCount).toBe(1);
        expect(vm.modules.find((entry) => entry.id === 'magic')?.headline).toContain('1 systems');
        expect(vm.characters[0]).toMatchObject({
            fullName: 'Aella of Lantern Reach',
            role: 'Warden',
            status: 'Alive',
            factions: ['Lantern Court'],
        });
        expect(vm.lore.open).toBe(1);
        expect(vm.calendar.total).toBe(3);
        expect(vm.kanban).toEqual({ todo: 1, inProgress: 1, completed: 1, total: 3 });
    });

    it('deep-links into calendar and fact sheets from the facade actions', async () => {
        await facade.openCalendarView('kanban');
        facade.openCharacter('entity-aella');

        expect(routerMock.navigate).toHaveBeenCalledWith(['/calendar'], { queryParams: { view: 'kanban' } });
        expect(hubMock.close).toHaveBeenCalled();
        expect(entitySelectionMock.select).toHaveBeenCalledWith('entity-aella');
        expect(rightSidebarMock.setActivePanel).toHaveBeenCalledWith('entities');
        expect(rightSidebarMock.open).toHaveBeenCalled();
    });
});

function createEntity(id: string, label: string, mentions: number): RegisteredEntity {
    return {
        id,
        label,
        aliases: [],
        kind: 'CHARACTER',
        firstNote: `note-${id}`,
        mentionsByNote: new Map([[`note-${id}`, mentions]]),
        totalMentions: mentions,
        lastSeenDate: new Date(`2026-04-${mentions.toString().padStart(2, '0')}T00:00:00.000Z`),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: 'user',
        registeredAt: 0,
    };
}

async function flushAsync(effectSchedulerMock: { flush: () => void }): Promise<void> {
    await Promise.resolve();
    effectSchedulerMock.flush();
    await Promise.resolve();
    effectSchedulerMock.flush();
    await Promise.resolve();
}
