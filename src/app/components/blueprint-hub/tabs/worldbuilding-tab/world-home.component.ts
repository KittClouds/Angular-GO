import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
    DEFAULT_SNAPSHOT,
    type ActDelta,
    type ActStake,
    type CanonConstraint,
    type LoreThread,
    type WorldPillar,
    type WorldSnapshot,
} from '../../../../lib/services/world-building.service';
import type { CalendarEvent } from '../../../../lib/fantasy-calendar/types';
import type { WorldModuleSummary, WorldSourceState } from './world-home.models';
import { WorldHomeFacade } from './world-home.facade';

type ComposerKind = 'constraint' | 'pillar' | 'stake' | 'delta' | 'lore' | null;
type ModuleComposerKind = 'cultures' | 'magic' | 'religion' | 'politics' | null;

@Component({
    selector: 'app-world-home',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './world-home.component.html',
    styleUrl: './world-home.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [WorldHomeFacade],
})
export class WorldHomeComponent {
    readonly facade = inject(WorldHomeFacade);
    readonly vm = this.facade.viewModel;
    readonly hasNarrative = this.facade.hasNarrative;
    readonly isActScope = this.facade.isActScope;
    readonly scopeChip = computed(() => this.getScopeChipLabel(this.vm().scope.scopeType));

    editingSnapshot = false;
    editingStatusQuo = false;
    editingPolitics = false;
    activeComposer: ComposerKind = null;
    activeModuleComposer: ModuleComposerKind = null;

    snapshotDraft: WorldSnapshot = cloneSnapshot(DEFAULT_SNAPSHOT);
    toneDraft = '';
    statusQuoDraft = '';
    politicsDraft = '';

    constraintText = '';
    pillarTitle = '';
    pillarDescription = '';
    stakeTitle = '';
    stakeDetails = '';
    stakePressure: ActStake['pressure'] = 'warning';
    deltaTitle = '';
    deltaDescription = '';
    deltaType: ActDelta['type'] = 'changed';
    loreQuestion = '';
    loreEntityText = '';
    cultureName = '';
    cultureSummary = '';
    systemName = '';
    systemDescription = '';
    religionName = '';
    religionDescription = '';

    constructor() {
        effect(() => {
            const model = this.vm();
            if (!this.editingSnapshot) {
                this.snapshotDraft = cloneSnapshot(model.snapshot);
                this.toneDraft = model.snapshot.tone.join(', ');
            }
            if (!this.editingStatusQuo) {
                this.statusQuoDraft = model.statusQuo;
            }
            if (!this.editingPolitics) {
                this.politicsDraft = model.politicsSummary;
            }
        });
    }

    getSourceLabel(state: WorldSourceState): string {
        if (state === 'local-overrides') return 'Local';
        if (state === 'inherited') return 'Inherited';
        return 'Base';
    }

    getScopeChipLabel(scopeType: string): string {
        if (scopeType === 'act') return 'Act Scope';
        if (scopeType === 'narrative') return 'Narrative Scope';
        if (scopeType === 'folder') return 'Folder Scope';
        if (scopeType === 'note') return 'Note Scope';
        return 'Global Scope';
    }

    startSnapshotEdit(): void {
        const snapshot = this.vm().snapshot;
        this.snapshotDraft = cloneSnapshot(snapshot);
        this.toneDraft = snapshot.tone.join(', ');
        this.editingSnapshot = true;
    }

    cancelSnapshotEdit(): void {
        this.editingSnapshot = false;
        const snapshot = this.vm().snapshot;
        this.snapshotDraft = cloneSnapshot(snapshot);
        this.toneDraft = snapshot.tone.join(', ');
    }

    async saveSnapshot(): Promise<void> {
        const draft = cloneSnapshot(this.snapshotDraft);
        draft.tone = this.toneDraft.split(',').map((entry) => entry.trim()).filter(Boolean);
        await this.facade.saveSnapshot(draft);
        this.editingSnapshot = false;
    }

    startStatusQuoEdit(): void {
        this.statusQuoDraft = this.vm().statusQuo;
        this.editingStatusQuo = true;
    }

    cancelStatusQuoEdit(): void {
        this.editingStatusQuo = false;
        this.statusQuoDraft = this.vm().statusQuo;
    }

    async saveStatusQuo(): Promise<void> {
        await this.facade.saveStatusQuo(this.statusQuoDraft.trim());
        this.editingStatusQuo = false;
    }

    startPoliticsEdit(): void {
        this.politicsDraft = this.vm().politicsSummary;
        this.editingPolitics = true;
    }

    cancelPoliticsEdit(): void {
        this.editingPolitics = false;
        this.politicsDraft = this.vm().politicsSummary;
    }

    async savePolitics(): Promise<void> {
        await this.facade.savePoliticsSummary(this.politicsDraft.trim());
        this.editingPolitics = false;
    }

    toggleComposer(kind: ComposerKind): void {
        this.activeComposer = this.activeComposer === kind ? null : kind;
    }

    toggleModuleComposer(kind: ModuleComposerKind): void {
        this.activeModuleComposer = this.activeModuleComposer === kind ? null : kind;
    }

    async addConstraint(): Promise<void> {
        const text = this.constraintText.trim();
        if (!text) return;
        const next: CanonConstraint[] = [...this.vm().constraints, { id: crypto.randomUUID(), text, isActive: true }];
        await this.facade.saveConstraints(next);
        this.constraintText = '';
        this.activeComposer = null;
    }

    async toggleConstraint(constraintId: string): Promise<void> {
        const next = this.vm().constraints.map((constraint) => (
            constraint.id === constraintId ? { ...constraint, isActive: !constraint.isActive } : constraint
        ));
        await this.facade.saveConstraints(next);
    }

    async removeConstraint(constraintId: string): Promise<void> {
        const next = this.vm().constraints.filter((constraint) => constraint.id !== constraintId);
        await this.facade.saveConstraints(next);
    }

    async addPillar(): Promise<void> {
        const title = this.pillarTitle.trim();
        const description = this.pillarDescription.trim();
        if (!title && !description) return;
        const next: WorldPillar[] = [...this.vm().pillars, {
            id: crypto.randomUUID(),
            title: title || 'Untitled Pillar',
            description,
            icon: 'pi pi-sparkles',
        }];
        await this.facade.savePillars(next);
        this.pillarTitle = '';
        this.pillarDescription = '';
        this.activeComposer = null;
    }

    async removePillar(pillarId: string): Promise<void> {
        const next = this.vm().pillars.filter((pillar) => pillar.id !== pillarId);
        await this.facade.savePillars(next);
    }

    async addStake(): Promise<void> {
        const title = this.stakeTitle.trim();
        const details = this.stakeDetails.trim();
        if (!title && !details) return;
        const next: ActStake[] = [...this.vm().stakes, {
            id: crypto.randomUUID(),
            title: title || 'Unnamed stake',
            details,
            pressure: this.stakePressure,
        }];
        await this.facade.saveStakes(next);
        this.stakeTitle = '';
        this.stakeDetails = '';
        this.stakePressure = 'warning';
        this.activeComposer = null;
    }

    async removeStake(stakeId: string): Promise<void> {
        const next = this.vm().stakes.filter((stake) => stake.id !== stakeId);
        await this.facade.saveStakes(next);
    }

    async addDelta(): Promise<void> {
        const title = this.deltaTitle.trim();
        const description = this.deltaDescription.trim();
        if (!title && !description) return;
        const next: ActDelta[] = [...this.vm().deltas, {
            id: crypto.randomUUID(),
            title: title || 'Untitled change',
            description,
            type: this.deltaType,
        }];
        await this.facade.saveDeltas(next);
        this.deltaTitle = '';
        this.deltaDescription = '';
        this.deltaType = 'changed';
        this.activeComposer = null;
    }

    async removeDelta(deltaId: string): Promise<void> {
        const next = this.vm().deltas.filter((delta) => delta.id !== deltaId);
        await this.facade.saveDeltas(next);
    }

    async addLoreThread(): Promise<void> {
        const question = this.loreQuestion.trim();
        if (!question) return;
        const current = this.facade.worldData().loreThreads;
        const next: LoreThread[] = [...current, {
            id: crypto.randomUUID(),
            question,
            status: 'open',
            connectedEntities: this.loreEntityText.split(',').map((entry) => entry.trim()).filter(Boolean),
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }];
        await this.facade.saveLoreThreads(next);
        this.loreQuestion = '';
        this.loreEntityText = '';
        this.activeComposer = null;
    }

    async updateLoreStatus(threadId: string, status: LoreThread['status']): Promise<void> {
        const next = this.facade.worldData().loreThreads.map((thread) => (
            thread.id === threadId ? { ...thread, status, updatedAt: Date.now() } : thread
        ));
        await this.facade.saveLoreThreads(next);
    }

    async createModule(module: WorldModuleSummary): Promise<void> {
        if (module.id === 'cultures') {
            await this.facade.createCulture(this.cultureName, this.cultureSummary);
            this.cultureName = '';
            this.cultureSummary = '';
            this.activeModuleComposer = null;
            return;
        }
        if (module.id === 'magic') {
            await this.facade.createPowerSystem(this.systemName, this.systemDescription);
            this.systemName = '';
            this.systemDescription = '';
            this.activeModuleComposer = null;
            return;
        }
        if (module.id === 'religion') {
            await this.facade.createReligion(this.religionName, this.religionDescription);
            this.religionName = '';
            this.religionDescription = '';
            this.activeModuleComposer = null;
        }
    }

    async openCalendar(): Promise<void> {
        await this.facade.openCalendarView('calendar');
    }

    async openBoard(): Promise<void> {
        await this.facade.openCalendarView('kanban');
    }

    openCharacter(entityId: string): void {
        this.facade.openCharacter(entityId);
    }

    formatEventDate(event: CalendarEvent): string {
        return `Y${event.date.year} • M${event.date.monthIndex + 1} • D${event.date.dayIndex + 1}`;
    }

    trackById(_index: number, item: { id: string }): string {
        return item.id;
    }
}

function cloneSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
    return {
        logline: snapshot.logline,
        description: snapshot.description,
        tone: [...snapshot.tone],
    };
}
