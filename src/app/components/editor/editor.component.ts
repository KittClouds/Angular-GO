import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, EnvironmentInjector, ApplicationRef, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, FileText, Plus } from 'lucide-angular';
import { Subscription, skip, filter } from 'rxjs';
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
    underlineAttr, underlineSchema, setUnderlineCommand
} from './plugins/marks';
import { textAlignPlugin, setTextAlignCommand, indentPlugin, indentCommand, outdentCommand } from './plugins/nodes';

// Unified Pretty Text System (formerly Highlighter C)
import { entitySchema } from './plugins/marks/entity';
import { prettyTextPlugin } from './plugins/prettyTextPlugin';
import { keywordFocusPlugin } from './plugins/keywordFocusPlugin';

import { detailsNodes, detailsInteractivePlugin } from './plugins/details';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { EditorService } from '../../services/editor.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { getPrettyTextApi } from '../../api/pretty-text-api';
import type { Note } from '../../lib/dexie/db';
import { configurePlainTextClipboard } from './plugins/plain-text-clipboard';

@Component({
    selector: 'app-editor',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    templateUrl: './editor.component.html',
    styleUrls: ['./editor.component.css']
})
export class EditorComponent implements AfterViewInit, OnDestroy {
    @ViewChild('editorContainer') editorContainer!: ElementRef<HTMLDivElement>;
    private crepe?: Crepe;
    private noteSubscription?: Subscription;
    private currentNoteId: string | null = null;
    private isLoadingContent = false; // Prevent save during load

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
                [Crepe.Feature.Toolbar]: false,
                [Crepe.Feature.BlockEdit]: false,
            }
        });

        // Configure editor plugins
        this.crepe.editor
            .use(gfm)
            .use(history)
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
            .use(prettyTextPlugin)
            .use(keywordFocusPlugin)
            // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            .use(detailsNodes)
            .use(detailsInteractivePlugin);

        await this.crepe.create();
        this.editorService.registerEditor(this.crepe);

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Subscribe to active note changes from NoteEditorStore
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.noteSubscription = this.noteEditorStore.activeNote$.subscribe(note => {
            // If we're switching away from a valid note to another note (or null), save the old one first
            if (this.currentNoteId && (!note || note.id !== this.currentNoteId)) {
                console.log(`[EditorComponent] Switching from ${this.currentNoteId} -> ${note?.id ?? 'null'}. Saving previous.`);
                this.saveCurrentContent();
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
                    const json = doc.toJSON();
                    const markdown = this.crepe?.getMarkdown() ?? '';

                    // REMOVED: Automatic DB Save
                    // this.noteEditorStore.saveContent(json, markdown);

                    // Still broadcast for other listeners (e.g., hub panels, preview)
                    this.editorService.updateContent({ json, markdown });

                    // Save editor position on content change
                    this.saveEditorPosition();
                }
            });
        });

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Save position before page unload (refresh/close)
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        window.addEventListener('beforeunload', () => {
            this.saveCurrentContent();
            this.saveEditorPosition();
        });

        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Listen for Manual Save Requests (Header Button)
        // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.editorService.saveRequest$.subscribe(() => {
            this.saveCurrentContent();
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
        this.saveCurrentContent();
    }

    /**
     * Captures current editor state and forces a save to NoteEditorStore
     */
    private saveCurrentContent(): void {
        if (!this.crepe || !this.currentNoteId || this.isLoadingContent) return;

        console.log(`[EditorComponent] saving content for ${this.currentNoteId}`);

        try {
            const editorView = this.crepe.editor.ctx.get(editorViewCtx);
            const json = editorView.state.doc.toJSON();
            const markdown = this.crepe.getMarkdown();

            // Force immediate save (skipping debounce)
            // MUST pass currentNoteId because the store's activeNoteId might have already changed (if switching notes)
            this.noteEditorStore.saveContentNow(json, markdown, this.currentNoteId);
        } catch (e) {
            console.error('[EditorComponent] Failed to extract content for save:', e);
        }
    }

    /**
     * Load a note's content into the editor
     */
    private loadNoteContent(note: Note): void {
        if (!this.crepe) return;
        if (this.currentNoteId === note.id) return; // Already loaded

        console.log(`[EditorComponent] Loading note: ${note.title} (${note.id})`);
        this.currentNoteId = note.id;
        this.isLoadingContent = true;

        try {
            // Parse the stored JSON content
            let content: any;
            try {
                content = JSON.parse(note.content || '{}');
            } catch {
                // Fallback: treat as markdown
                content = null;
            }

            // If parsed content is not a valid doc (e.g. empty object from new note), create default
            if (!content || !content.type || !content.content) {
                // If we have markdown, try to use it (simple text node)
                if (note.markdownContent) {
                    content = {
                        type: 'doc',
                        content: [{
                            type: 'paragraph',
                            content: [{ type: 'text', text: note.markdownContent }]
                        }]
                    };
                } else {
                    // Default empty doc
                    content = {
                        type: 'doc',
                        content: [{ type: 'paragraph' }]
                    };
                }
            }

            // Set editor content
            // Milkdown/Crepe uses ProseMirror, so we need to set the document
            const editorView = this.crepe.editor.ctx.get(editorViewCtx);
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

            // Update pretty text API with current note context
            const prettyTextApi = getPrettyTextApi();
            prettyTextApi.setNoteId(note.id, note.narrativeId || '');

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
                const anchor = Math.max(minPos, Math.min(pendingPosition.cursorFrom, maxPos));
                const head = Math.max(minPos, Math.min(pendingPosition.cursorTo, maxPos));

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
    private saveEditorPosition(): void {
        if (!this.crepe || !this.currentNoteId) return;

        try {
            const editorView = this.crepe.editor.ctx.get(editorViewCtx);
            const scrollContainer = this.editorContainer?.nativeElement?.querySelector('.ProseMirror') as HTMLElement;

            const scrollTop = scrollContainer?.scrollTop ?? 0;
            const { from, to } = editorView.state.selection;

            this.noteEditorStore.saveEditorPosition(scrollTop, from, to);
        } catch (e) {
            // Silently fail - position saving is best-effort
        }
    }

    /**
     * Clear the editor (no note selected)
     */
    private clearEditor(): void {
        if (!this.crepe) return;

        console.log('[EditorComponent] Clearing editor');
        this.currentNoteId = null;
        this.isLoadingContent = true;

        try {
            const editorView = this.crepe.editor.ctx.get(editorViewCtx);
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
        this.crepe?.destroy();
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

