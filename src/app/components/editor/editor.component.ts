import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, EnvironmentInjector, ApplicationRef, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, FileText, Plus } from 'lucide-angular';
import { Subscription } from 'rxjs';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import { configureAngularToolbar, angularToolbarPlugin } from './plugins/toolbar';
import { configureAngularBlockHandle, angularBlockHandlePlugin } from './plugins/block-handle';
import { gfm } from '@milkdown/kit/preset/gfm';
import {
    textColorAttr, textColorSchema, setTextColorCommand,
    fontFamilyMark, setFontFamilyCommand,
    fontSizeMark, setFontSizeCommand,
    underlineAttr, underlineSchema, setUnderlineCommand,
    entityImplicitSchema,
} from './plugins/marks';
import { textAlignPlugin, setTextAlignCommand, indentPlugin, indentCommand, outdentCommand } from './plugins/nodes';

// Unified Pretty Text System (formerly Highlighter C)
import { entitySchema } from './plugins/marks/entity';
import { prettyTextPlugin } from './plugins/prettyTextPlugin';
import { keywordFocusPlugin } from './plugins/keywordFocusPlugin';

import { detailsNodes, detailsInteractivePlugin } from './plugins/details';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { commandsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { EditorPositionPersistMode, EditorService, EditorSnapshotReason } from '../../services/editor.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { getPrettyTextApi } from '../../api/pretty-text-api';
import type { Note } from '../../lib/dexie/db';
import { configurePlainTextClipboard } from './plugins/plain-text-clipboard';
import { configureEditorCursor, editorCursorPlugin, editorVirtualCursorPlugin } from './plugins/virtual-cursor';
import { sanitizeEntityMarksInDocJson } from './entity-mark-sanitizer';
import { smartGraphRegistry } from '../../lib/registry';
import { extractProjectedText } from '../../lib/Scanner/prosemirror-bridge';

@Component({
    selector: 'app-editor',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    templateUrl: './editor.component.html',
    styleUrls: ['./editor.component.css']
})
export class EditorComponent implements AfterViewInit, OnDestroy {
    private static readonly POSITION_PERSIST_DEBOUNCE_MS = 250;

    @ViewChild('editorContainer') editorContainer!: ElementRef<HTMLDivElement>;
    private crepe?: Crepe;
    private noteSubscription?: Subscription;
    private saveRequestSubscription?: Subscription;
    private currentNoteId: string | null = null;
    private editorRevision = 0;
    private isLoadingContent = false; // Prevent save during load
    private pendingPositionSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private editorInteractionTarget: HTMLElement | null = null;
    private readonly beforeUnloadHandler = () => {
        this.saveCurrentContent('before-unload');
    };
    private readonly editorScrollHandler = () => {
        this.scheduleEditorPositionSave();
    };
    private readonly editorMouseupHandler = () => {
        this.scheduleEditorPositionSave();
    };
    private readonly editorKeyupHandler = () => {
        this.scheduleEditorPositionSave();
    };

    noteEditorStore = inject(NoteEditorStore);

    // Icons for template
    readonly FileText = FileText;
    readonly Plus = Plus;

    constructor(
        private injector: EnvironmentInjector,
        private appRef: ApplicationRef,
        private editorService: EditorService
    ) { }

    async ngAfterViewInit() {
        if (!this.editorContainer) return;

        // Initialize Crepe WITHOUT hardcoded default value
        this.crepe = new Crepe({
            root: this.editorContainer.nativeElement,
            defaultValue: '', // Empty - will be loaded from Dexie
            features: {
                [Crepe.Feature.Cursor]: false,
                [Crepe.Feature.Toolbar]: false,
                [Crepe.Feature.BlockEdit]: false,
            }
        });

        // Configure editor plugins
        this.crepe.editor
            .use(gfm)
            .use(history)
            .config(configureEditorCursor())
            .use(editorCursorPlugin)
            .use(editorVirtualCursorPlugin)
            .config(configurePlainTextClipboard())
            .config(configureAngularToolbar(this.injector, this.appRef, () => this.currentNoteId ?? undefined))
            .use(angularToolbarPlugin)
            .config(configureAngularBlockHandle(this.injector, this.appRef))
            .use(angularBlockHandlePlugin)
            .use(textColorAttr)
            .use(textColorSchema)
            .use(setTextColorCommand)
            .use(underlineAttr)
            .use(underlineSchema)
            .use(setUnderlineCommand)
            .use(fontFamilyMark)
            .use(setFontFamilyCommand)
            .use(fontSizeMark)
            .use(setFontSizeCommand)
            .config(textAlignPlugin)
            .use(setTextAlignCommand)
            .config(indentPlugin)
            .use(indentCommand)
            .use(outdentCommand)
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // PRETTY TEXT PLUGIN (Unified Highlighting System)
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            .use(entitySchema)
            .use(entityImplicitSchema)
            .use(prettyTextPlugin)
            .use(keywordFocusPlugin)
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            .use(detailsNodes)
            .use(detailsInteractivePlugin);

        await this.crepe.create();
        this.editorService.registerEditor(this.crepe);
        this.attachEditorPositionListeners();

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Subscribe to active note changes from NoteEditorStore
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.noteSubscription = this.noteEditorStore.activeNote$.subscribe(note => {
            // If we're switching away from a valid note to another note (or null), save the old one first
            if (this.currentNoteId && (!note || note.id !== this.currentNoteId)) {
                console.log(`[EditorComponent] Switching from ${this.currentNoteId} -> ${note?.id ?? 'null'}. Saving previous.`);
                this.saveCurrentContent('note-switch');
            }

            if (note) {
                this.loadNoteContent(note);
            } else {
                this.clearEditor();
            }
        });

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // On editor content change:
        // 1. Broadcast to other components (EditorService)
        // 2. Save position
        // 3. DO NOT AUTOSAVE to DB (Manual save only)
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.crepe.on((listener) => {
            listener.updated((ctx, doc, prevDoc) => {
                // Skip processing if we're currently loading content
                if (this.isLoadingContent) return;

                if (prevDoc && !doc.eq(prevDoc)) {
                    const plainTextStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    const { text: plainText } = extractProjectedText(doc as any);
                    const plainTextMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - plainTextStart;

                    this.editorRevision++;
                    this.editorService.updateLiveContent({
                        noteId: this.currentNoteId,
                        revision: this.editorRevision,
                        plainText,
                        textLength: plainText.length,
                        timings: { plainTextMs },
                    });

                    this.scheduleEditorPositionSave();
                }
            });
        });

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Save position before page unload (refresh/close)
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        window.addEventListener('beforeunload', this.beforeUnloadHandler);

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Listen for Manual Save Requests (Header Button)
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.saveRequestSubscription = this.editorService.saveRequest$.subscribe(() => {
            this.saveCurrentContent('manual-save');
        });

        console.log('[EditorComponent] Initialized - waiting for note selection');
    }

    /**
     * Manual Save Trigger (Ctrl+S / Cmd+S)
     */
    @HostListener('window:keydown.control.s', ['$event'])
    @HostListener('window:keydown.meta.s', ['$event']) // Mac Cmd+S
    onCtrlS(event: Event) {
        event.preventDefault();
        this.saveCurrentContent('manual-save');
    }

    /**
     * Captures current editor state and forces a save to NoteEditorStore
     */
    private saveCurrentContent(reason: Exclude<EditorSnapshotReason, 'api'>): void {
        if (!this.crepe || !this.currentNoteId || this.isLoadingContent) return;

        console.log(`[EditorComponent] saving content for ${this.currentNoteId}`);

        try {
            const snapshot = this.editorService.captureSnapshot(reason);
            if (!snapshot) {
                return;
            }

            // Force immediate save (skipping debounce)
            // MUST pass currentNoteId because the store's activeNoteId might have already changed (if switching notes)
            void this.noteEditorStore.saveContentNow(snapshot.json, snapshot.markdown, this.currentNoteId);
            if (reason !== 'note-switch') {
                this.persistEditorPosition(reason);
            }
        } catch (e) {
            console.error('[EditorComponent] Failed to extract content for save:', e);
        }
    }

    /**
     * Load a note's content into the editor
     */
    private loadNoteContent(note: Note): void {
        if (!this.crepe) return;
        if (this.currentNoteId === note.id) {
            const prettyTextApi = getPrettyTextApi();
            prettyTextApi.setNoteId(note.id, note.narrativeId || '');
            const editorView = this.getEditorView();
            if (editorView) {
                prettyTextApi.primeImplicitDecorations(editorView.state.doc);
            }
            return;
        }

        console.log(`[EditorComponent] Loading note: ${note.title} (${note.id})`);
        this.currentNoteId = note.id;
        this.editorRevision = 0;
        this.isLoadingContent = true;
        this.attachEditorPositionListeners();

        try {
            // Parse the stored JSON content
            let content: any;
            try {
                content = JSON.parse(note.content || '{}');
            } catch {
                // Fallback: treat as markdown
                content = null;
            }

            if (this.shouldReparseMarkdownFallback(content, note.markdownContent || '')) {
                content = this.parseMarkdownContent(note.markdownContent);
            }

            // If parsed content is not a valid doc (e.g. empty object from new note), create default
            if (!content || !content.type || !content.content) {
                // If we have markdown, parse it into real ProseMirror blocks.
                if (note.markdownContent) {
                    content = this.parseMarkdownContent(note.markdownContent);
                } else {
                    // Default empty doc
                    content = {
                        type: 'doc',
                        content: [{ type: 'paragraph' }]
                    };
                }
            }

            const sanitized = sanitizeEntityMarksInDocJson(content, {
                hasEntityId: (id) => !!smartGraphRegistry.getEntityById(id),
                hasEntityLabel: (label) => !!smartGraphRegistry.findEntityByLabel(label),
            });
            content = sanitized.content;

            // Update pretty text context before dispatching content so edit-time
            // refresh scheduling uses the correct note id/cache key.
            const prettyTextApi = getPrettyTextApi();
            prettyTextApi.setNoteId(note.id, note.narrativeId || '');

            // Set editor content
            // Milkdown/Crepe uses ProseMirror, so we need to set the document
            const editorView = this.getEditorView();
            if (editorView) {
                const { state } = editorView;
                try {
                    const newDoc = state.schema.nodeFromJSON(content);
                    const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
                    editorView.dispatch(tr);

                    // Restore scroll and cursor position after content loads
                    this.restoreEditorPosition(editorView);
                } catch (err) {
                    console.error('[EditorComponent] Failed to inflate document JSON:', err);
                    // Fallback to clearing
                    this.clearEditor();
                }
            }

            if (sanitized.changed) {
                void this.noteEditorStore.saveContentNow(content, note.markdownContent || '', note.id);
            }

            if (editorView) {
                prettyTextApi.primeImplicitDecorations(editorView.state.doc);
            }

        } catch (e) {
            console.error('[EditorComponent] Failed to load note content:', e);
        } finally {
            // Allow saves again after a brief delay
            setTimeout(() => {
                this.isLoadingContent = false;
            }, 100);
        }
    }

    /**
     * Restore editor scroll and cursor position from storage
     */
    private restoreEditorPosition(editorView: any): void {
        setTimeout(() => {
            const pendingPosition = this.noteEditorStore.getPendingPosition();
            if (!pendingPosition) return;

            try {
                // Restore scroll position
                const scrollContainer = this.editorContainer?.nativeElement?.querySelector('.ProseMirror') as HTMLElement;
                if (scrollContainer) {
                    scrollContainer.scrollTop = pendingPosition.scrollTop;
                }

                // Restore cursor position only if doc has inline content space.
                const doc = editorView.state.doc;
                const docSize = doc.content.size;

                if (docSize < 2) {
                    return;
                }

                const minPos = 1;
                const maxPos = Math.max(minPos, docSize - 1);
                const anchor = Math.max(minPos, Math.min(pendingPosition.anchor, maxPos));
                const head = Math.max(minPos, Math.min(pendingPosition.head, maxPos));

                const tr = editorView.state.tr.setSelection(
                    TextSelection.create(doc, anchor, head)
                );
                editorView.dispatch(tr);
                editorView.focus();

                console.log(`[EditorComponent] Restored position: scroll=${pendingPosition.scrollTop}, cursor=${anchor}-${head}`);
            } catch (e) {
                console.warn('[EditorComponent] Failed to restore position:', e);
            }
        }, 50);
    }

    /**
     * Save current editor position (scroll and cursor)
     */
    private scheduleEditorPositionSave(): void {
        if (this.pendingPositionSaveTimer) {
            clearTimeout(this.pendingPositionSaveTimer);
        }

        this.pendingPositionSaveTimer = setTimeout(() => {
            this.pendingPositionSaveTimer = null;
            this.persistEditorPosition('debounced');
        }, EditorComponent.POSITION_PERSIST_DEBOUNCE_MS);
    }

    private persistEditorPosition(mode: EditorPositionPersistMode): void {
        if (!this.crepe || !this.currentNoteId) return;

        try {
            const editorView = this.getEditorView();
            if (!editorView) {
                return;
            }
            const scrollContainer = this.editorContainer?.nativeElement?.querySelector('.ProseMirror') as HTMLElement;

            const scrollTop = scrollContainer?.scrollTop ?? 0;
            const { from, to } = editorView.state.selection;

            this.noteEditorStore.saveEditorPosition(scrollTop, from, to, this.currentNoteId ?? undefined);
            this.editorService.recordPositionPersist(this.currentNoteId, mode);
        } catch (e) {
            // Silently fail - position saving is best-effort
        }
    }

    private attachEditorPositionListeners(): void {
        const target = this.getScrollContainer();
        if (!target || this.editorInteractionTarget === target) {
            return;
        }

        this.detachEditorPositionListeners();
        target.addEventListener('scroll', this.editorScrollHandler, { passive: true });
        target.addEventListener('mouseup', this.editorMouseupHandler);
        target.addEventListener('keyup', this.editorKeyupHandler);
        this.editorInteractionTarget = target;
    }

    private detachEditorPositionListeners(): void {
        if (!this.editorInteractionTarget) {
            return;
        }

        this.editorInteractionTarget.removeEventListener('scroll', this.editorScrollHandler);
        this.editorInteractionTarget.removeEventListener('mouseup', this.editorMouseupHandler);
        this.editorInteractionTarget.removeEventListener('keyup', this.editorKeyupHandler);
        this.editorInteractionTarget = null;
    }

    /**
     * Clear the editor (no note selected)
     */
    private clearEditor(): void {
        if (!this.crepe) return;

        console.log('[EditorComponent] Clearing editor');
        this.currentNoteId = null;
        this.editorRevision = 0;
        this.isLoadingContent = true;
        getPrettyTextApi().setNoteId('');

        try {
            const editorView = this.getEditorView();
            if (editorView) {
                const { state } = editorView;
                const emptyDoc = state.schema.node('doc', null, [
                    state.schema.node('paragraph')
                ]);
                const tr = state.tr.replaceWith(0, state.doc.content.size, emptyDoc.content);
                editorView.dispatch(tr);
            }
        } catch (e) {
            console.error('[EditorComponent] Failed to clear editor:', e);
        } finally {
            setTimeout(() => {
                this.isLoadingContent = false;
            }, 100);
        }
    }

    ngOnDestroy() {
        this.noteSubscription?.unsubscribe();
        this.saveRequestSubscription?.unsubscribe();
        if (this.pendingPositionSaveTimer) {
            clearTimeout(this.pendingPositionSaveTimer);
            this.pendingPositionSaveTimer = null;
        }
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        this.detachEditorPositionListeners();
        this.editorService.unregisterEditor(this.crepe);
        this.crepe?.destroy();
    }

    private getEditorView(): any | null {
        if (!this.crepe) {
            return null;
        }

        try {
            return this.crepe.editor.ctx.get(editorViewCtx);
        } catch {
            return null;
        }
    }

    private parseMarkdownContent(markdown: string): any {
        try {
            const parser = this.crepe?.editor.ctx.get(parserCtx);
            const doc = parser?.(markdown);
            const json = doc?.toJSON?.();
            if (json?.type === 'doc') {
                return json;
            }
        } catch (error) {
            console.warn('[EditorComponent] Failed to parse markdown content:', error);
        }

        return {
            type: 'doc',
            content: [{ type: 'paragraph' }]
        };
    }

    private shouldReparseMarkdownFallback(content: any, markdown: string): boolean {
        if (!markdown.includes('\n') || content?.type !== 'doc') {
            return false;
        }

        const blocks = Array.isArray(content.content) ? content.content : [];
        const onlyBlock = blocks.length === 1 ? blocks[0] : null;
        if (onlyBlock?.type !== 'paragraph') {
            return false;
        }

        const inline = Array.isArray(onlyBlock.content) ? onlyBlock.content : [];
        return inline.length === 1 && inline[0]?.type === 'text' && inline[0]?.text === markdown;
    }

    private getScrollContainer(): HTMLElement | null {
        return this.editorContainer?.nativeElement?.querySelector('.ProseMirror') as HTMLElement | null;
    }

    undo() {
        try {
            this.crepe?.editor.ctx.get(commandsCtx).call(undoCommand.key);
        } catch (e) {
            console.error('Undo failed', e);
        }
    }

    redo() {
        try {
            this.crepe?.editor.ctx.get(commandsCtx).call(redoCommand.key);
        } catch (e) {
            console.error('Redo failed', e);
        }
    }

    async createNote(): Promise<void> {
        await this.noteEditorStore.createAndOpenNote('', '');
    }
}

