
import { Component, signal, inject, OnDestroy, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { Subscription } from 'rxjs';

import {
    CodexService,
    THREAD_TYPES,
    THREAD_STATUSES,
    ThreadTypeDef,
    ThreadStatusDef
} from '../../../../lib/services/codex.service';
import { ScopeService } from '../../../../lib/services/scope.service';
import { CodexEntry } from '../../../../lib/dexie/db';

@Component({
    selector: 'app-plot-threads-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        TagModule,
        ToastModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        SelectModule
    ],
    providers: [MessageService],
    templateUrl: './plot-threads-tab.component.html',
    styles: [`
        :host { display: block; height: 100%; }
        .thread-card { transition: all 0.2s ease; }
        .beat-item { transition: all 0.15s ease; }
    `]
})
export class PlotThreadsTabComponent implements OnDestroy {
    private codexService = inject(CodexService);
    private scopeService = inject(ScopeService);
    private messageService = inject(MessageService);
    private threadsSub?: Subscription;
    private beatsSub?: Subscription;

    // ─── Data ────────────────────────────────────────────────
    allThreads = signal<CodexEntry[]>([]);
    selectedThreadId = signal<string | null>(null);
    threadBeats = signal<CodexEntry[]>([]);
    threadTypes = signal<ThreadTypeDef[]>(THREAD_TYPES);
    threadStatuses = signal<ThreadStatusDef[]>(THREAD_STATUSES);

    // ─── Computed ────────────────────────────────────────────
    selectedThread = computed(() => {
        const id = this.selectedThreadId();
        if (!id) return null;
        return this.allThreads().find(t => t.id === id) ?? null;
    });

    threadCount = computed(() => this.allThreads().length);

    activeCount = computed(() =>
        this.allThreads().filter(t => t.status === 'active').length
    );

    // ─── New thread dialog ──────────────────────────────────
    showNewThreadDialog = signal(false);
    newThreadTitle = '';
    selectedThreadType: ThreadTypeDef | null = null;

    // ─── New beat inline ────────────────────────────────────
    newBeatTitle = '';
    isAddingBeat = signal(false);

    // ─── Editing notes ──────────────────────────────────────
    editingNotes = signal(false);
    notesBuffer = '';

    constructor() {
        // Load threads when narrative scope changes
        effect(() => {
            const narrativeId = this.scopeService.activeNarrativeId() || '';
            this.loadThreads(narrativeId);
        });

        // Load beats when selected thread changes
        effect(() => {
            const threadId = this.selectedThreadId();
            if (threadId) {
                this.loadBeatsForThread(threadId);
            } else {
                this.threadBeats.set([]);
            }
        });
    }

    ngOnDestroy() {
        this.threadsSub?.unsubscribe();
        this.beatsSub?.unsubscribe();
    }

    // ─── Data Loading ───────────────────────────────────────

    private loadThreads(narrativeId: string) {
        this.threadsSub?.unsubscribe();
        this.threadsSub = this.codexService.getThreads$(narrativeId).subscribe(threads => {
            this.allThreads.set(threads);
            // Auto-select first if nothing selected
            const currentId = this.selectedThreadId();
            if (!currentId || !threads.find(t => t.id === currentId)) {
                this.selectedThreadId.set(threads.length > 0 ? threads[0].id : null);
            }
        });
    }

    private loadBeatsForThread(threadId: string) {
        this.beatsSub?.unsubscribe();
        this.beatsSub = this.codexService.getBeatsForThread$(threadId).subscribe(beats => {
            this.threadBeats.set(beats);
        });
    }

    // ─── Thread Helpers ─────────────────────────────────────

    getThreadTypeLabel(category: string | undefined): string {
        if (!category) return 'Thread';
        return THREAD_TYPES.find(t => t.id === category)?.label || 'Thread';
    }

    getThreadTypeColor(category: string | undefined): string {
        if (!category) return '#8b5cf6';
        return THREAD_TYPES.find(t => t.id === category)?.color || '#8b5cf6';
    }

    getThreadTypeIcon(category: string | undefined): string {
        if (!category) return 'pi pi-bookmark';
        return THREAD_TYPES.find(t => t.id === category)?.icon || 'pi pi-bookmark';
    }

    getStatusDef(status: string): ThreadStatusDef {
        return THREAD_STATUSES.find(s => s.id === status) || THREAD_STATUSES[0];
    }

    getStatusSeverity(status: string): 'success' | 'warn' | 'secondary' | 'info' {
        return this.getStatusDef(status).severity;
    }

    getThreadColor(thread: CodexEntry): string {
        return thread.color || this.getThreadTypeColor(thread.category);
    }

    // ─── Thread Actions ─────────────────────────────────────

    selectThread(threadId: string) {
        this.selectedThreadId.set(threadId);
        this.isAddingBeat.set(false);
        this.editingNotes.set(false);
    }

    openNewThreadDialog() {
        this.newThreadTitle = '';
        this.selectedThreadType = THREAD_TYPES.find(t => t.id === 'subplot') || null;
        this.showNewThreadDialog.set(true);
    }

    async createThread() {
        if (!this.newThreadTitle.trim()) return;
        const narrativeId = this.scopeService.activeNarrativeId() || '';
        const typeId = this.selectedThreadType?.id || 'subplot';

        try {
            const id = await this.codexService.createThread(
                narrativeId,
                this.newThreadTitle.trim(),
                typeId
            );
            this.showNewThreadDialog.set(false);
            this.selectedThreadId.set(id);
            this.messageService.add({
                severity: 'success',
                summary: 'Thread Created',
                detail: `"${this.newThreadTitle}" created`
            });
            this.newThreadTitle = '';
        } catch (err) {
            console.error('[PlotThreads] Error creating thread:', err);
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to create thread'
            });
        }
    }

    async deleteThread(threadId: string) {
        try {
            // Delete all child beats first
            const beats = this.threadBeats();
            for (const beat of beats) {
                await this.codexService.deleteEntry(beat.id);
            }
            await this.codexService.deleteEntry(threadId);

            if (this.selectedThreadId() === threadId) {
                this.selectedThreadId.set(null);
            }
            this.messageService.add({
                severity: 'success',
                summary: 'Deleted',
                detail: 'Thread and its beats removed'
            });
        } catch (err) {
            console.error('[PlotThreads] Error deleting thread:', err);
        }
    }

    async updateThreadStatus(threadId: string, status: string) {
        try {
            await this.codexService.updateEntry(threadId, { status: status as any });
        } catch (err) {
            console.error('[PlotThreads] Error updating status:', err);
        }
    }

    async updateThreadType(threadId: string, typeId: string) {
        const typeDef = THREAD_TYPES.find(t => t.id === typeId);
        try {
            await this.codexService.updateEntry(threadId, {
                category: typeId,
                color: typeDef?.color
            });
        } catch (err) {
            console.error('[PlotThreads] Error updating type:', err);
        }
    }

    // ─── Beat Actions ───────────────────────────────────────

    startAddBeat() {
        this.newBeatTitle = '';
        this.isAddingBeat.set(true);
    }

    cancelAddBeat() {
        this.isAddingBeat.set(false);
        this.newBeatTitle = '';
    }

    async addBeat() {
        const threadId = this.selectedThreadId();
        if (!threadId || !this.newBeatTitle.trim()) return;

        const narrativeId = this.scopeService.activeNarrativeId() || '';
        try {
            await this.codexService.createBeatForThread(
                narrativeId,
                threadId,
                this.newBeatTitle.trim()
            );
            this.newBeatTitle = '';
            // Keep the input open for rapid entry
        } catch (err) {
            console.error('[PlotThreads] Error adding beat:', err);
        }
    }

    async deleteBeat(beatId: string) {
        try {
            await this.codexService.deleteEntry(beatId);
        } catch (err) {
            console.error('[PlotThreads] Error deleting beat:', err);
        }
    }

    async toggleBeatStatus(beat: CodexEntry) {
        const newStatus = beat.status === 'complete' ? 'planned' : 'complete';
        try {
            await this.codexService.updateEntry(beat.id, { status: newStatus as any });
        } catch (err) {
            console.error('[PlotThreads] Error toggling beat:', err);
        }
    }

    // ─── Notes ──────────────────────────────────────────────

    startEditNotes() {
        const thread = this.selectedThread();
        this.notesBuffer = thread?.description || '';
        this.editingNotes.set(true);
    }

    async saveNotes() {
        const threadId = this.selectedThreadId();
        if (!threadId) return;
        try {
            await this.codexService.updateEntry(threadId, {
                description: this.notesBuffer
            });
            this.editingNotes.set(false);
        } catch (err) {
            console.error('[PlotThreads] Error saving notes:', err);
        }
    }

    cancelEditNotes() {
        this.editingNotes.set(false);
    }

    cancelNewThread() {
        this.showNewThreadDialog.set(false);
        this.newThreadTitle = '';
    }

    trackById(_index: number, item: CodexEntry): string {
        return item.id;
    }
}
