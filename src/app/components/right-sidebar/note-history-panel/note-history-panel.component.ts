import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    Download,
    History,
    LucideAngularModule,
    Plus,
    RotateCcw,
} from 'lucide-angular';
import { EditorService } from '../../../services/editor.service';
import type { NoteSnapshot } from '../../../lib/dexie/db';
import {
    formatSnapshotStamp,
    NoteSnapshotService,
} from '../../../lib/services/note-snapshot.service';
import { DocumentExportService } from '../../../lib/services/document-export.service';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';

@Component({
    selector: 'app-note-history-panel',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
        <section class="h-full min-h-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
            <div class="shrink-0 border-b border-border/60 p-4 space-y-3">
                <div class="flex items-center gap-3">
                    <div class="h-10 w-10 rounded-md border border-teal-500/25 bg-teal-500/10 flex items-center justify-center text-teal-300">
                        <lucide-icon [img]="HistoryIcon" size="20"></lucide-icon>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-lg font-semibold leading-tight">Note History</h2>
                        <p class="text-xs uppercase tracking-[0.16em] text-slate-400">manual snapshots</p>
                    </div>
                </div>

                <div class="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                    <p class="truncate text-sm font-semibold text-slate-100">{{ currentTitle() }}</p>
                    <p class="mt-1 text-xs text-slate-500">{{ snapshots().length }} snapshots saved</p>
                </div>

                <button
                    type="button"
                    class="w-full h-10 rounded-md bg-teal-400 text-black font-semibold tracking-wide hover:bg-teal-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    [disabled]="!currentNote() || busy()"
                    (click)="createSnapshot()"
                >
                    <lucide-icon [img]="PlusIcon" size="18"></lucide-icon>
                    Snapshot Now
                </button>

                @if (message()) {
                    <p class="text-xs text-teal-300">{{ message() }}</p>
                }
                @if (error()) {
                    <p class="text-xs text-red-300">{{ error() }}</p>
                }
            </div>

            <div class="flex-1 min-h-0 overflow-auto custom-scrollbar p-3">
                @if (!currentNote()) {
                    <div class="h-full flex flex-col items-center justify-center text-center px-6">
                        <div class="h-14 w-14 rounded-md bg-black/30 flex items-center justify-center text-slate-500">
                            <lucide-icon [img]="HistoryIcon" size="24"></lucide-icon>
                        </div>
                        <h3 class="mt-4 text-base font-semibold text-slate-200">Open a note first</h3>
                        <p class="mt-2 text-sm text-slate-500">Snapshots attach to the active editor note.</p>
                    </div>
                } @else if (snapshots().length === 0) {
                    <div class="h-full flex flex-col items-center justify-center text-center px-6">
                        <div class="h-14 w-14 rounded-md bg-black/30 flex items-center justify-center text-slate-500">
                            <lucide-icon [img]="HistoryIcon" size="24"></lucide-icon>
                        </div>
                        <h3 class="mt-4 text-base font-semibold text-slate-200">No snapshots yet</h3>
                        <p class="mt-2 text-sm text-slate-500">Create one before a big rewrite, import, or experiment.</p>
                    </div>
                } @else {
                    <div class="space-y-2">
                        @for (snapshot of snapshots(); track snapshot.id) {
                            <article class="rounded-md border border-white/10 bg-black/20 p-3">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0">
                                        <p class="text-sm font-semibold text-slate-100">
                                            {{ stamp(snapshot.createdAt) }}
                                        </p>
                                        <p class="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                                            {{ snapshot.reason }} · {{ snapshot.markdownContent.length }} chars
                                        </p>
                                    </div>
                                    <span class="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400">
                                        {{ snapshot.markdownHash }}
                                    </span>
                                </div>

                                <p class="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                                    {{ preview(snapshot) }}
                                </p>

                                <div class="mt-3 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        class="h-9 rounded-md border border-teal-500/25 bg-teal-500/10 text-teal-200 text-sm font-semibold hover:bg-teal-500/20 transition-colors flex items-center justify-center gap-2"
                                        [disabled]="busy()"
                                        (click)="restoreAsCopy(snapshot)"
                                    >
                                        <lucide-icon [img]="RestoreIcon" size="16"></lucide-icon>
                                        Restore Copy
                                    </button>
                                    <button
                                        type="button"
                                        class="h-9 rounded-md border border-white/10 bg-white/5 text-slate-200 text-sm font-semibold hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                                        [disabled]="busy()"
                                        (click)="exportSnapshot(snapshot)"
                                    >
                                        <lucide-icon [img]="DownloadIcon" size="16"></lucide-icon>
                                        Export
                                    </button>
                                </div>
                            </article>
                        }
                    </div>
                }
            </div>
        </section>
    `,
    styles: [`
        .custom-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.14) transparent;
        }

        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.14);
            border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255, 255, 255, 0.24);
        }
    `],
})
export class NoteHistoryPanelComponent {
    readonly HistoryIcon = History;
    readonly PlusIcon = Plus;
    readonly RestoreIcon = RotateCcw;
    readonly DownloadIcon = Download;

    private readonly editorService = inject(EditorService);
    private readonly exportService = inject(DocumentExportService);
    private readonly noteStore = inject(NoteEditorStore);
    private readonly snapshotService = inject(NoteSnapshotService);
    private loadSerial = 0;

    readonly currentNote = this.noteStore.currentNote;
    readonly snapshots = signal<NoteSnapshot[]>([]);
    readonly busy = signal(false);
    readonly message = signal('');
    readonly error = signal('');

    readonly currentTitle = computed(() => this.currentNote()?.title || 'No active note');

    constructor() {
        effect(() => {
            const note = this.currentNote();
            void this.loadSnapshots(note?.id || '');
        });
    }

    async createSnapshot(): Promise<void> {
        const note = this.currentNote();
        if (!note || this.busy()) return;

        this.busy.set(true);
        this.message.set('');
        this.error.set('');

        try {
            const live = this.editorService.captureSnapshot('api');
            const markdownContent = live?.markdown ?? note.markdownContent ?? '';
            const content = live ? JSON.stringify(live.json) : (note.content || '{}');

            if (live) {
                await this.noteStore.saveContentNow(live.json, live.markdown, note.id);
            }

            await this.snapshotService.createSnapshot({
                note,
                content,
                markdownContent,
                reason: 'manual',
            });
            await this.loadSnapshots(note.id);
            this.message.set('Snapshot saved.');
        } catch (err) {
            this.error.set(getErrorMessage(err, 'Snapshot failed.'));
        } finally {
            this.busy.set(false);
        }
    }

    async restoreAsCopy(snapshot: NoteSnapshot): Promise<void> {
        if (this.busy()) return;

        this.busy.set(true);
        this.message.set('');
        this.error.set('');

        try {
            const noteId = await this.snapshotService.restoreAsCopy(snapshot);
            await this.noteStore.openNote(noteId);
            this.message.set('Snapshot opened as a new note.');
        } catch (err) {
            this.error.set(getErrorMessage(err, 'Restore failed.'));
        } finally {
            this.busy.set(false);
        }
    }

    async exportSnapshot(snapshot: NoteSnapshot): Promise<void> {
        if (this.busy()) return;

        this.busy.set(true);
        this.message.set('');
        this.error.set('');

        try {
            const result = await this.exportService.exportText(
                `${snapshot.title} ${formatSnapshotStamp(snapshot.createdAt)}`,
                snapshot.markdownContent
            );
            this.message.set(result.status === 'cancelled' ? 'Export cancelled.' : `Exported ${result.fileName}.`);
        } catch (err) {
            this.error.set(getErrorMessage(err, 'Export failed.'));
        } finally {
            this.busy.set(false);
        }
    }

    stamp(timestamp: number): string {
        return formatSnapshotStamp(timestamp);
    }

    preview(snapshot: NoteSnapshot): string {
        return snapshot.markdownContent.replace(/\s+/g, ' ').trim() || '(empty note)';
    }

    private async loadSnapshots(noteId: string): Promise<void> {
        const serial = ++this.loadSerial;
        if (!noteId) {
            this.snapshots.set([]);
            return;
        }

        const snapshots = await this.snapshotService.listSnapshots(noteId);
        if (serial === this.loadSerial) {
            this.snapshots.set(snapshots);
        }
    }
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}
