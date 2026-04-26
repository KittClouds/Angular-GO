import { Injectable, inject } from '@angular/core';
import { db, Folder } from '../dexie/db';
import { NotesService } from '../dexie/notes.service';
import { FolderService } from './folder.service';
import { NoteEditorStore } from '../store/note-editor.store';
import { ScopeService } from './scope.service';
import { PhoenixUiApiService, SearchScope } from '../../services/phoenix-ui-api.service';

export type DocumentIngestionMode = 'files' | 'folder';
export type DocumentIngestionConflictPolicy = 'suffix';

export interface DocumentIngestionRequest {
    mode: DocumentIngestionMode;
    destinationFolderId: string;
    files: File[];
    conflictPolicy: DocumentIngestionConflictPolicy;
}

export interface DocumentIngestionItemSuccess {
    fileName: string;
    noteId: string;
    title: string;
}

export interface DocumentIngestionItemFailure {
    fileName: string;
    reason: string;
}

export interface DocumentIngestionResult {
    created: DocumentIngestionItemSuccess[];
    skipped: DocumentIngestionItemFailure[];
    failed: DocumentIngestionItemFailure[];
}

export interface PickedDocumentBatch {
    mode: DocumentIngestionMode;
    files: File[];
}

@Injectable({
    providedIn: 'root'
})
export class DocumentIngestionService {
    private notesService = inject(NotesService);
    private folderService = inject(FolderService);
    private noteEditorStore = inject(NoteEditorStore);
    private scopeService = inject(ScopeService);
    private phoenixUiApi = inject(PhoenixUiApiService);

    async openFilesPicker(): Promise<PickedDocumentBatch | null> {
        const files = await this.openPicker('files');
        return files ? { mode: 'files', files } : null;
    }

    async openFolderPicker(): Promise<PickedDocumentBatch | null> {
        const files = await this.openPicker('folder');
        return files ? { mode: 'folder', files } : null;
    }

    async resolveDefaultDestinationFolderId(): Promise<string | null> {
        const scope = this.scopeService.activeScope();
        const scopeFolderId = this.getFolderIdFromScope(scope.type, scope.id, scope.actId);
        if (scopeFolderId) {
            const folder = await db.folders.get(scopeFolderId);
            if (folder) return folder.id;
        }

        const activeNote = this.noteEditorStore.currentNote();
        if (activeNote?.folderId) {
            const folder = await db.folders.get(activeNote.folderId);
            if (folder) return folder.id;
        }

        return null;
    }

    async ingestDocuments(
        request: DocumentIngestionRequest,
        onProgress?: (processed: number, total: number) => void
    ): Promise<DocumentIngestionResult> {
        if (!request.destinationFolderId) {
            throw new Error('Destination folder is required.');
        }

        const destination = await db.folders.get(request.destinationFolderId);
        if (!destination) {
            throw new Error(`Destination folder ${request.destinationFolderId} was not found.`);
        }

        const existingNotes = await db.notes.where('folderId').equals(request.destinationFolderId).toArray();
        const usedTitles = new Set(existingNotes.map(note => note.title.trim().toLowerCase()).filter(Boolean));
        const result: DocumentIngestionResult = { created: [], skipped: [], failed: [] };
        const supportedFiles = request.files.filter(file => this.isTxtFile(file.name));

        for (const file of request.files) {
            if (!this.isTxtFile(file.name)) {
                result.skipped.push({ fileName: file.name, reason: 'Only .txt files are supported right now.' });
            }
        }

        let processed = 0;
        for (const file of supportedFiles) {
            try {
                const text = await file.text();
                const baseTitle = this.getBaseTitle(file.name);
                const title = this.makeUniqueTitle(baseTitle || 'Untitled Note', usedTitles, request.conflictPolicy);

                const noteId = await this.notesService.createNote({
                    worldId: destination.worldId || '',
                    title,
                    content: '{}',
                    markdownContent: text,
                    folderId: destination.id,
                    entityKind: '',
                    entitySubtype: '',
                    isEntity: false,
                    isPinned: false,
                    favorite: false,
                    ownerId: destination.ownerId || '',
                    narrativeId: destination.narrativeId || '',
                });

                await this.syncImportedNote(noteId, title, text, destination);
                result.created.push({ fileName: file.name, noteId, title });
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Import failed.';
                result.failed.push({ fileName: file.name, reason });
            }

            processed += 1;
            onProgress?.(processed, supportedFiles.length);
        }

        return result;
    }

    async createDestinationFolder(
        parentId: string,
        entityKind: string,
        name: string
    ): Promise<string> {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Folder name is required.');
        }

        if (!parentId) {
            if (entityKind === 'NARRATIVE') {
                return this.folderService.createNarrativeVault(trimmedName);
            }
            if (entityKind) {
                return this.folderService.createTypedRootFolder(entityKind, trimmedName);
            }
            return this.folderService.createRootFolder(trimmedName);
        }

        if (entityKind) {
            return this.folderService.createTypedSubfolder(parentId, entityKind, trimmedName);
        }

        return this.folderService.createSubfolder(parentId, trimmedName);
    }

    private async syncImportedNote(noteId: string, title: string, text: string, destination: Folder): Promise<void> {
        const version = Date.now();
        const scope: SearchScope | undefined = destination.narrativeId || destination.id
            ? {
                narrativeId: destination.narrativeId || undefined,
                folderPath: destination.id || undefined,
            }
            : undefined;

        if (this.phoenixUiApi.isReady) {
            try {
                await this.phoenixUiApi.upsertNote(noteId, text, version);
            } catch (error) {
                console.warn('[DocumentIngestion] DocStore sync failed:', error);
            }

            try {
                await this.phoenixUiApi.indexNote(noteId, text, scope);
            } catch (error) {
                console.warn('[DocumentIngestion] Search indexing failed:', error);
            }
        }

    }

    private getFolderIdFromScope(type: string, id: string, actId?: string): string | null {
        if (type === 'folder' || type === 'narrative') return id || null;
        if (type === 'act') return actId || id || null;
        return null;
    }

    private isTxtFile(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.txt');
    }

    private getBaseTitle(fileName: string): string {
        return fileName.replace(/\.txt$/i, '').trim();
    }

    private makeUniqueTitle(
        requestedTitle: string,
        usedTitles: Set<string>,
        conflictPolicy: DocumentIngestionConflictPolicy
    ): string {
        const cleanTitle = requestedTitle.trim() || 'Untitled Note';
        if (conflictPolicy !== 'suffix') {
            usedTitles.add(cleanTitle.toLowerCase());
            return cleanTitle;
        }

        let title = cleanTitle;
        let suffix = 2;
        while (usedTitles.has(title.toLowerCase())) {
            title = `${cleanTitle} (${suffix})`;
            suffix += 1;
        }

        usedTitles.add(title.toLowerCase());
        return title;
    }

    private openPicker(mode: DocumentIngestionMode): Promise<File[] | null> {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            return Promise.resolve(null);
        }

        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.txt,text/plain';
            input.multiple = true;
            input.style.display = 'none';

            if (mode === 'folder') {
                const folderInput = input as HTMLInputElement & { webkitdirectory?: boolean };
                folderInput.webkitdirectory = true;
            }

            let settled = false;
            const finish = (files: File[] | null) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(files);
            };

            const handleFocus = () => {
                window.setTimeout(() => {
                    if (!settled && !input.files?.length) {
                        finish(null);
                    }
                }, 300);
            };

            const cleanup = () => {
                window.removeEventListener('focus', handleFocus, true);
                input.remove();
            };

            input.addEventListener('change', () => {
                const files = Array.from(input.files || []);
                finish(files.length > 0 ? files : null);
            }, { once: true });

            window.addEventListener('focus', handleFocus, true);
            document.body.appendChild(input);
            input.click();
        });
    }
}

