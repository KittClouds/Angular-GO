
import { Component, signal, inject, OnInit, OnDestroy, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ScrollPanelModule } from 'primeng/scrollpanel';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { Subscription } from 'rxjs';

import { CodexService, ACTS, BEAT_TYPES, ActDef, BeatTypeDef } from '../../../../lib/services/codex.service';
import { ScopeService } from '../../../../lib/services/scope.service';
import { CodexEntry } from '../../../../lib/dexie/db';

interface ActWithBeats {
    act: ActDef;
    beats: CodexEntry[];
}

@Component({
    selector: 'app-story-beats-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        TagModule,
        ScrollPanelModule,
        ToastModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        SelectModule
    ],
    providers: [MessageService],
    templateUrl: './story-beats-tab.component.html',
    styles: [`
        :host { display: block; height: 100%; }
        .beat-card { transition: all 0.2s; }
    `]
})
export class StoryBeatsTabComponent implements OnDestroy {
    private codexService = inject(CodexService);
    private scopeService = inject(ScopeService);
    private messageService = inject(MessageService);
    private subscription?: Subscription;

    // Data
    allBeats = signal<CodexEntry[]>([]);
    acts = signal<ActDef[]>(ACTS);
    beatTypes = signal<BeatTypeDef[]>(BEAT_TYPES);

    // Computed: Group beats by act
    actsWithBeats = computed<ActWithBeats[]>(() => {
        const beats = this.allBeats();
        return this.acts().map(act => ({
            act,
            beats: beats.filter(b => b.category === act.id).sort((a, b) => a.order - b.order)
        }));
    });

    // Entity focus
    hasEntityFocus = signal(false);
    focusedEntityLabel = signal<string | null>(null);

    // Add beat dialog
    showAddDialog = signal(false);
    newBeatTitle = '';
    newBeatDescription = '';
    selectedAct: ActDef | null = null;
    selectedBeatType: BeatTypeDef | null = null;

    constructor() {
        effect(() => {
            const narrativeId = this.scopeService.activeNarrativeId() || '';
            this.loadBeats(narrativeId);
        });
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    private loadBeats(narrativeId: string) {
        this.subscription?.unsubscribe();
        this.subscription = this.codexService.getBeats$(narrativeId).subscribe(beats => {
            this.allBeats.set(beats);
        });
    }

    getBeatTypeColor(subcategory: string | undefined): string {
        if (!subcategory) return '#666';
        const bt = BEAT_TYPES.find(b => b.id === subcategory);
        return bt?.color || '#666';
    }

    getBeatTypeLabel(subcategory: string | undefined): string {
        if (!subcategory) return 'Beat';
        const bt = BEAT_TYPES.find(b => b.id === subcategory);
        return bt?.label || 'Beat';
    }

    getBeatTypeStyle(subcategory: string | undefined): any {
        const color = this.getBeatTypeColor(subcategory);
        return {
            backgroundColor: `${color}20`,
            color: color
        };
    }

    getActHeaderStyle(act: ActDef): any {
        return { backgroundColor: `${act.color}15` };
    }

    getActDotStyle(act: ActDef): any {
        return { backgroundColor: act.color };
    }

    getStatusSeverity(status: string): "success" | "secondary" | "info" | "warn" | "danger" | "contrast" | undefined {
        switch (status) {
            case 'planned': return 'secondary';
            case 'draft': return 'warn';
            case 'complete': return 'success';
            case 'locked': return 'info';
            default: return 'secondary';
        }
    }

    formatStatus(status: string): string {
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    // ─── Actions ────────────────────────────────────────────

    openAddBeatDialog(act: ActDef) {
        this.selectedAct = act;
        this.selectedBeatType = null;
        this.newBeatTitle = '';
        this.newBeatDescription = '';
        this.showAddDialog.set(true);
    }

    async createBeat() {
        if (!this.newBeatTitle.trim() || !this.selectedAct) {
            return;
        }

        const narrativeId = this.scopeService.activeNarrativeId() || '';
        const beatTypeId = this.selectedBeatType?.id || 'custom';

        try {
            await this.codexService.createEntry({
                narrativeId,
                entryType: 'beat',
                title: this.newBeatTitle.trim(),
                description: this.newBeatDescription.trim(),
                status: 'planned',
                category: this.selectedAct.id,
                subcategory: beatTypeId,
                order: this.actsWithBeats().find(a => a.act.id === this.selectedAct?.id)?.beats.length ?? 0 + 1,
                entityIds: [],
            });

            this.messageService.add({
                severity: 'success',
                summary: 'Beat Created',
                detail: `"${this.newBeatTitle}" added to ${this.selectedAct.name}`
            });

            this.showAddDialog.set(false);
            this.resetForm();
        } catch (err) {
            console.error('[StoryBeatsTab] Error creating beat:', err);
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to create beat'
            });
        }
    }

    cancelAdd() {
        this.showAddDialog.set(false);
        this.resetForm();
    }

    private resetForm() {
        this.newBeatTitle = '';
        this.newBeatDescription = '';
        this.selectedAct = null;
        this.selectedBeatType = null;
    }

    onAddAct() {
        // Acts are predefined (Save the Cat! structure), so we just show info
        this.messageService.add({
            severity: 'info',
            summary: 'Fixed Structure',
            detail: 'Acts follow the Save the Cat! beat sheet structure. Add beats within existing acts.'
        });
    }

    getBeatTypesForAct(actId: string): BeatTypeDef[] {
        return BEAT_TYPES.filter(bt => bt.actId === actId);
    }

    async deleteBeat(beatId: string) {
        try {
            await this.codexService.deleteEntry(beatId);
            this.messageService.add({
                severity: 'success',
                summary: 'Deleted',
                detail: 'Beat removed'
            });
        } catch (err) {
            console.error('[StoryBeatsTab] Error deleting beat:', err);
        }
    }
}
