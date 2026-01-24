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
import { entityHighlighter } from './plugins/entityHighlighter';
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
            .config(configureAngularToolbar(this.injector, this.appRef))
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
            .use(entityHighlighter);

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
                }
            });
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
                content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: note.markdownContent || '' }] }] };
            }

            // Set editor content
            // Milkdown/Crepe uses ProseMirror, so we need to set the document
            const editorView = this.crepe.editor.ctx.get(editorViewCtx);
            if (editorView && content.content) {
                const { state } = editorView;
                const newDoc = state.schema.nodeFromJSON(content);
                const tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);
                editorView.dispatch(tr);
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
