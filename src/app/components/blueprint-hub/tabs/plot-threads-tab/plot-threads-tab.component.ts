
import { Component, signal, inject, computed, effect } from '@angular/core';
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

import {
    THREAD_TYPES,
    THREAD_STATUSES,
    ThreadTypeDef,
    ThreadStatusDef
} from '../../../../lib/services/codex.service';
import { ScopeService } from '../../../../lib/services/scope.service';
import { ScopedDocumentService } from '../../../../lib/services/scoped-document.service';
import { db } from '../../../../lib/dexie/db';

interface PlotBeat {
    id: string;
    title: string;
    description: string;
    status: 'planned' | 'complete';
    order: number;
    createdAt: number;
    updatedAt: number;
}

interface PlotThread {
    id: string;
    title: string;
    description: string;
    status: 'active' | 'dormant' | 'resolved';
    category?: string;
    color?: string;
    order: number;
    beats: PlotBeat[];
    createdAt: number;
    updatedAt: number;
}

interface PlotThreadsDocument {
    threads: PlotThread[];
}

const PLOT_THREADS_NAMESPACE = 'plot_threads';
const PLOT_THREADS_KEY = 'threads';
const DEFAULT_THREADS_DOC: PlotThreadsDocument = { threads: [] };

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
export class PlotThreadsTabComponent {
    private scopeService = inject(ScopeService);
    private scopedDocuments = inject(ScopedDocumentService);
    private messageService = inject(MessageService);

    allThreads = signal<PlotThread[]>([]);
    selectedThreadId = signal<string | null>(null);
    threadTypes = signal<ThreadTypeDef[]>(THREAD_TYPES);
    threadStatuses = signal<ThreadStatusDef[]>(THREAD_STATUSES);
    private refreshTick = signal(0);

    selectedThread = computed(() => {
        const id = this.selectedThreadId();
        if (!id) return null;
        return this.allThreads().find(t => t.id === id) ?? null;
    });

    threadBeats = computed(() => this.selectedThread()?.beats ?? []);
    threadCount = computed(() => this.allThreads().length);
    activeCount = computed(() => this.allThreads().filter(t => t.status === 'active').length);

    showNewThreadDialog = signal(false);
    newThreadTitle = '';
    selectedThreadType: ThreadTypeDef | null = null;

    newBeatTitle = '';
    isAddingBeat = signal(false);

    editingNotes = signal(false);
    notesBuffer = '';

    constructor() {
        effect(() => {
            this.scopeService.resolvedScope();
            this.refreshTick();
            void this.loadThreads();
        });

        effect(() => {
            const threadId = this.selectedThreadId();
            if (threadId && !this.allThreads().some(thread => thread.id === threadId)) {
                this.selectedThreadId.set(this.allThreads()[0]?.id || null);
            }
        });
    }

    private async loadThreads() {
        const scope = this.scopeService.resolvedScope();
        const narrativeId = scope.narrativeId;
        if (!narrativeId || scope.scopeFolderId === 'vault:global') {
            this.allThreads.set([]);
            this.selectedThreadId.set(null);
            return;
        }

        const doc = await this.getThreadsDocument(scope.scopeFolderId, narrativeId);
        const threads = [...doc.threads].sort((a, b) => a.order - b.order);
        this.allThreads.set(threads);

        const currentId = this.selectedThreadId();
        if (!currentId || !threads.find(t => t.id === currentId)) {
            this.selectedThreadId.set(threads[0]?.id || null);
        }
    }

    private async getThreadsDocument(scopeFolderId: string, narrativeId: string): Promise<PlotThreadsDocument> {
        const exact = await this.scopedDocuments.findPayload(scopeFolderId, PLOT_THREADS_NAMESPACE, PLOT_THREADS_KEY, DEFAULT_THREADS_DOC);
        if (exact) return exact;

        if (scopeFolderId !== narrativeId) {
            return this.getThreadsDocument(narrativeId, narrativeId);
        }

        return this.scopedDocuments.getPayload(
            narrativeId,
            narrativeId,
            PLOT_THREADS_NAMESPACE,
            PLOT_THREADS_KEY,
            DEFAULT_THREADS_DOC,
            async () => {
                const threads = await db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'thread' as any])
                    .sortBy('order');

                if (threads.length === 0) return undefined;

                const beats = await db.codexEntries
                    .where('[narrativeId+entryType]')
                    .equals([narrativeId, 'beat'])
                    .toArray();

                return {
                    threads: threads.map(thread => ({
                        id: thread.id,
                        title: thread.title,
                        description: thread.description,
                        status: (thread.status as PlotThread['status']) || 'active',
                        category: thread.category,
                        color: thread.color,
                        order: thread.order,
                        createdAt: thread.createdAt,
                        updatedAt: thread.updatedAt,
                        beats: beats
                            .filter(beat => beat.parentId === thread.id)
                            .sort((a, b) => a.order - b.order)
                            .map(beat => ({
                                id: beat.id,
                                title: beat.title,
                                description: beat.description,
                                status: beat.status === 'complete' ? 'complete' : 'planned',
                                order: beat.order,
                                createdAt: beat.createdAt,
                                updatedAt: beat.updatedAt,
                            })),
                    })),
                } satisfies PlotThreadsDocument;
            }
        );
    }

    private async saveThreadsDocument(scopeFolderId: string, narrativeId: string, doc: PlotThreadsDocument): Promise<void> {
        await this.scopedDocuments.savePayload(scopeFolderId, narrativeId, PLOT_THREADS_NAMESPACE, PLOT_THREADS_KEY, doc);
        this.refreshTick.update(value => value + 1);
    }

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

    getThreadColor(thread: PlotThread): string {
        return thread.color || this.getThreadTypeColor(thread.category);
    }

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
        const scope = this.scopeService.resolvedScope();
        const narrativeId = scope.narrativeId;
        if (!narrativeId || scope.scopeFolderId === 'vault:global') return;

        const doc = await this.getThreadsDocument(scope.scopeFolderId, narrativeId);
        const typeId = this.selectedThreadType?.id || 'subplot';
        const typeDef = THREAD_TYPES.find(t => t.id === typeId);
        const nextOrder = doc.threads.reduce((max, thread) => Math.max(max, thread.order), 0) + 1;

        const thread: PlotThread = {
            id: crypto.randomUUID(),
            title: this.newThreadTitle.trim(),
            description: '',
            status: 'active',
            category: typeId,
            color: typeDef?.color || '#8b5cf6',
            order: nextOrder,
            beats: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        doc.threads.push(thread);
        await this.saveThreadsDocument(scope.scopeFolderId, narrativeId, doc);

        this.showNewThreadDialog.set(false);
        this.selectedThreadId.set(thread.id);
        this.messageService.add({
            severity: 'success',
            summary: 'Thread Created',
            detail: `"${this.newThreadTitle}" created`
        });
        this.newThreadTitle = '';
    }

    async deleteThread(threadId: string) {
        const scope = this.scopeService.resolvedScope();
        const narrativeId = scope.narrativeId;
        if (!narrativeId || scope.scopeFolderId === 'vault:global') return;

        const doc = await this.getThreadsDocument(scope.scopeFolderId, narrativeId);
        doc.threads = doc.threads.filter(thread => thread.id !== threadId);
        await this.saveThreadsDocument(scope.scopeFolderId, narrativeId, doc);

        if (this.selectedThreadId() === threadId) {
            this.selectedThreadId.set(doc.threads[0]?.id || null);
        }

        this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Thread and its beats removed'
        });
    }

    async updateThreadStatus(threadId: string, status: string) {
        await this.updateThread(threadId, thread => ({ ...thread, status: status as PlotThread['status'], updatedAt: Date.now() }));
    }

    async updateThreadType(threadId: string, typeId: string) {
        const typeDef = THREAD_TYPES.find(t => t.id === typeId);
        await this.updateThread(threadId, thread => ({
            ...thread,
            category: typeId,
            color: typeDef?.color || thread.color,
            updatedAt: Date.now(),
        }));
    }

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

        await this.updateThread(threadId, thread => {
            const nextOrder = thread.beats.reduce((max, beat) => Math.max(max, beat.order), 0) + 1;
            return {
                ...thread,
                updatedAt: Date.now(),
                beats: [
                    ...thread.beats,
                    {
                        id: crypto.randomUUID(),
                        title: this.newBeatTitle.trim(),
                        description: '',
                        status: 'planned',
                        order: nextOrder,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    }
                ]
            };
        });

        this.newBeatTitle = '';
    }

    async deleteBeat(beatId: string) {
        const threadId = this.selectedThreadId();
        if (!threadId) return;

        await this.updateThread(threadId, thread => ({
            ...thread,
            updatedAt: Date.now(),
            beats: thread.beats.filter(beat => beat.id !== beatId)
        }));
    }

    async toggleBeatStatus(beat: PlotBeat) {
        const threadId = this.selectedThreadId();
        if (!threadId) return;

        await this.updateThread(threadId, thread => ({
            ...thread,
            updatedAt: Date.now(),
            beats: thread.beats.map(item =>
                item.id === beat.id
                    ? { ...item, status: item.status === 'complete' ? 'planned' : 'complete', updatedAt: Date.now() }
                    : item
            )
        }));
    }

    startEditNotes() {
        const thread = this.selectedThread();
        this.notesBuffer = thread?.description || '';
        this.editingNotes.set(true);
    }

    async saveNotes() {
        const threadId = this.selectedThreadId();
        if (!threadId) return;

        await this.updateThread(threadId, thread => ({
            ...thread,
            description: this.notesBuffer,
            updatedAt: Date.now(),
        }));
        this.editingNotes.set(false);
    }

    cancelEditNotes() {
        this.editingNotes.set(false);
    }

    cancelNewThread() {
        this.showNewThreadDialog.set(false);
        this.newThreadTitle = '';
    }

    trackById(_index: number, item: PlotThread | PlotBeat): string {
        return item.id;
    }

    private async updateThread(threadId: string, mutate: (thread: PlotThread) => PlotThread) {
        const scope = this.scopeService.resolvedScope();
        const narrativeId = scope.narrativeId;
        if (!narrativeId || scope.scopeFolderId === 'vault:global') return;

        const doc = await this.getThreadsDocument(scope.scopeFolderId, narrativeId);
        doc.threads = doc.threads.map(thread => thread.id === threadId ? mutate(thread) : thread);
        await this.saveThreadsDocument(scope.scopeFolderId, narrativeId, doc);
    }
}
