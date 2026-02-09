import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, EnvironmentInjector, ApplicationRef, inject } from '@angular/core';
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

// =============================================================================
// ENTITY HIGHLIGHTER A/B/C TESTING
// =============================================================================
// Option A: Original decoration-based (has flicker on redraw)
// Option B: Experimental overlay-based (reduced ProseMirror mutation)
// Option C: TRUE MARK-BASED (like text color - stored in document JSON, no flicker)
// Toggle by commenting/uncommenting the import and .use() below
// =============================================================================

// OPTION A: Original (decoration-based) - DISABLED
// import { entityHighlighter } from './plugins/entityHighlighter';

// OPTION B: Experimental (hybrid overlay + decorations) - DISABLED
// import { entityHighlighterExperimental } from './plugins/entityHighlighterExperimental';

// OPTION C: True Mark-Based (Highlighter C) - CURRENTLY ACTIVE
// Entity marks are stored in document JSON like text color - applied once, never rebuilt
import { entitySchema } from './plugins/marks/entity';
import { entityHighlighterC } from './plugins/entityHighlighterC';

import { detailsNodes, detailsInteractivePlugin } from './plugins/details';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import { EditorService } from '../../services/editor.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { getHighlighterApi } from '../../api/highlighter-api';
import type { Note } from '../../lib/dexie/db';

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
            // ─────────────────────────────────────────────────────────────
            // ENTITY HIGHLIGHTER - A/B/C Testing
            // ─────────────────────────────────────────────────────────────
            // OPTION A: Original decoration-based - DISABLED
            // .use(entityHighlighter)
            // 
            // OPTION B: Experimental hybrid - DISABLED
            // .use(entityHighlighterExperimental)
            //
            // OPTION C: True Mark-Based - CURRENTLY ACTIVE
            // entitySchema defines the mark type (like textColor schema)
            // entityHighlighterC applies marks on note open (like clicking color picker)
            .use(entitySchema)
            .use(entityHighlighterC)
            // ─────────────────────────────────────────────────────────────
            .use(detailsNodes)
            .use(detailsInteractivePlugin);

        await this.crepe.create();
        this.editorService.registerEditor(this.crepe);

        // ─────────────────────────────────────────────────────────────
        // Subscribe to active note changes from NoteEditorStore
        // ─────────────────────────────────────────────────────────────
        this.noteSubscription = this.noteEditorStore.activeNote$.subscribe(note => {
            if (note) {
                this.loadNoteContent(note);
            } else {
                this.clearEditor();
            }
        });

        // ─────────────────────────────────────────────────────────────
        // On editor content change, save via NoteEditorStore (debounced)
        // ─────────────────────────────────────────────────────────────
        this.crepe.on((listener) => {
            listener.updated((ctx, doc, prevDoc) => {
                // Skip save if we're currently loading content
                if (this.isLoadingContent) return;

                if (prevDoc && !doc.eq(prevDoc)) {
                    const json = doc.toJSON();
                    const markdown = this.crepe?.getMarkdown() ?? '';

                    // Save to Dexie via store (300ms debounced)
                    this.noteEditorStore.saveContent(json, markdown);

                    // Also broadcast for other listeners (e.g., hub panels)
                    this.editorService.updateContent({ json, markdown });

                    // Save editor position on content change
                    this.saveEditorPosition();
                }
            });
        });

        // ─────────────────────────────────────────────────────────────
        // Save position before page unload (refresh/close)
        // ─────────────────────────────────────────────────────────────
        window.addEventListener('beforeunload', () => {
            this.saveEditorPosition();
        });

        console.log('[EditorComponent] Initialized - waiting for note selection');
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

            // Update highlighter API with current note context
            const highlighterApi = getHighlighterApi();
            highlighterApi.setNoteId(note.id, note.narrativeId || '');

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

                // Restore cursor position
                const docSize = editorView.state.doc.content.size;
                const from = Math.min(pendingPosition.cursorFrom, docSize);
                const to = Math.min(pendingPosition.cursorTo, docSize);

                const tr = editorView.state.tr.setSelection(
                    editorView.state.selection.constructor.create(editorView.state.doc, from, to)
                );
                editorView.dispatch(tr);
                editorView.focus();

                console.log(`[EditorComponent] Restored position: scroll=${pendingPosition.scrollTop}, cursor=${from}-${to}`);
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
