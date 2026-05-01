import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
    lucideGitBranch,
    lucideLoader2,
    lucideNetwork,
    lucideQuote,
    lucideShieldQuestion,
    lucideSparkles,
} from '@ng-icons/lucide';

import * as ops from '../../../lib/operations';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { NotesService } from '../../../lib/dexie/notes.service';
import { GraphAuditService } from '../../../services/graph-audit.service';
import { PhoenixUiApiService, type SearchScope } from '../../../services/phoenix-ui-api.service';
import { RetrievalWorkbenchStateService } from '../../../services/retrieval-workbench-state.service';
import { buildSearchSnippet } from '../search-panel.model';
import { BlueprintHubService } from '../../blueprint-hub/blueprint-hub.service';

type SemanticToolId = 'similar-selection' | 'related-passages' | 'graph-seeds' | 'support-probe';

interface SemanticTool {
    id: SemanticToolId;
    label: string;
    icon: string;
    hint: string;
}

interface SemanticWorkshopResult {
    id: string;
    title: string;
    excerpt: string;
    score: number;
    kind: string;
    noteId?: string;
    meta: string;
}

interface NoteLite {
    id: string;
    title: string;
    content: string;
}

const TOOLS: SemanticTool[] = [
    {
        id: 'similar-selection',
        label: 'Similar Selection',
        icon: 'lucideQuote',
        hint: 'Nearest passages from highlighted text.',
    },
    {
        id: 'related-passages',
        label: 'Related Passages',
        icon: 'lucideSparkles',
        hint: 'Current block against the active scope.',
    },
    {
        id: 'graph-seeds',
        label: 'Graph Seeds',
        icon: 'lucideGitBranch',
        hint: 'Semantic hits plus graph seed hints.',
    },
    {
        id: 'support-probe',
        label: 'Support Probe',
        icon: 'lucideShieldQuestion',
        hint: 'Nearby evidence to review for support or conflict.',
    },
];

@Component({
    selector: 'app-semantic-workshop',
    standalone: true,
    imports: [CommonModule, NgIcon],
    providers: [provideIcons({
        lucideGitBranch,
        lucideLoader2,
        lucideNetwork,
        lucideQuote,
        lucideShieldQuestion,
        lucideSparkles,
    })],
    templateUrl: './semantic-workshop.component.html',
    styleUrls: ['./semantic-workshop.component.css'],
})
export class SemanticWorkshopComponent {
    private readonly destroyRef = inject(DestroyRef);
    private readonly graphAudit = inject(GraphAuditService);
    private readonly noteStore = inject(NoteEditorStore);
    private readonly notesService = inject(NotesService);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly workbench = inject(RetrievalWorkbenchStateService);
    private readonly hubService = inject(BlueprintHubService);

    readonly tools = TOOLS;
    readonly activeTool = signal<SemanticToolId>('similar-selection');
    readonly isRunning = signal(false);
    readonly notice = signal<string | null>(null);
    readonly sourceText = signal('');
    readonly sourceLabel = signal('Selection');
    readonly results = signal<SemanticWorkshopResult[]>([]);
    readonly noteTitles = signal(new Map<string, string>());

    readonly scopeLabel = computed(() => this.workbench.scope() === 'global' ? 'Global' : 'Folder');
    readonly activeToolDef = computed(() =>
        this.tools.find((tool) => tool.id === this.activeTool()) || this.tools[0]
    );

    constructor() {
        this.notesService.getAllNotes$()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((notes) => {
                this.noteTitles.set(new Map(notes.map((note) => [note.id, note.title || 'Untitled'])));
            });
    }

    async runTool(toolId: SemanticToolId = this.activeTool()): Promise<void> {
        this.activeTool.set(toolId);
        this.isRunning.set(true);
        this.notice.set(null);
        this.results.set([]);

        try {
            const source = this.resolveSource(toolId);
            if (!source.text.trim()) {
                this.notice.set('Select text, type a query, or open a note with prose first.');
                return;
            }

            this.sourceText.set(source.text);
            this.sourceLabel.set(source.label);
            const semanticResults = await this.semanticHits(source.text, toolId === 'graph-seeds' ? 8 : 10);
            const mapped = await this.mapSemanticResults(semanticResults, source.text, toolId);
            this.results.set(toolId === 'graph-seeds'
                ? [...await this.graphSeedHints(source.text), ...mapped].slice(0, 10)
                : mapped);

            if (toolId === 'support-probe') {
                this.notice.set('Probe results are review candidates. The deterministic graph still owns truth.');
            }
        } catch (error) {
            this.notice.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.isRunning.set(false);
        }
    }

    selectTool(toolId: SemanticToolId): void {
        this.activeTool.set(toolId);
    }

    openResult(result: SemanticWorkshopResult): void {
        if (!result.noteId) return;
        this.noteStore.openNote(result.noteId);
    }

    showInGraph(event: Event, result: SemanticWorkshopResult): void {
        event.stopPropagation();
        this.workbench.requestGraphFocus({
            query: this.sourceText() || this.workbench.query(),
            scope: this.workbench.scope(),
            noteId: result.noteId,
            title: result.title,
        });
        this.hubService.openPage('graph');
    }

    formatScore(score: number): string {
        return score <= 1 ? `${(score * 100).toFixed(1)}%` : score.toFixed(2);
    }

    private resolveSource(toolId: SemanticToolId): { text: string; label: string } {
        const selected = getSelectionText();
        const query = this.workbench.query().trim();
        if (toolId === 'similar-selection' && selected) return { text: selected, label: 'Selected text' };
        if (toolId === 'related-passages') return this.currentParagraph(selected || query);
        if (selected) return { text: selected, label: 'Selected text' };
        if (query) return { text: query, label: 'Workbench query' };
        return this.currentParagraph('');
    }

    private currentParagraph(anchor: string): { text: string; label: string } {
        const body = this.activeNoteText();
        if (!body.trim()) return { text: '', label: 'Current block' };
        const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
        const normalizedAnchor = anchor.trim().toLocaleLowerCase();
        if (normalizedAnchor) {
            const match = paragraphs.find((paragraph) =>
                paragraph.toLocaleLowerCase().includes(normalizedAnchor.slice(0, 80))
            );
            if (match) return { text: match, label: 'Current block' };
        }
        return { text: paragraphs[0] || body.slice(0, 1200), label: 'Current block' };
    }

    private activeNoteText(): string {
        const note = this.noteStore.currentNote();
        const markdown = typeof note?.markdownContent === 'string' ? note.markdownContent : '';
        if (markdown.trim()) return markdown;
        return typeof note?.content === 'string' ? note.content : '';
    }

    private async semanticHits(query: string, limit: number): Promise<any[]> {
        return this.phoenixUiApi.semanticSearch(query, limit, this.buildScope());
    }

    private async mapSemanticResults(
        rawResults: any[],
        query: string,
        toolId: SemanticToolId,
    ): Promise<SemanticWorkshopResult[]> {
        const base = (Array.isArray(rawResults) ? rawResults : [])
            .map((result) => ({
                noteId: result.DocID || result.docID || result.id || '',
                score: result.Score || result.score || 0,
            }))
            .filter((result) => !!result.noteId)
            .slice(0, 10);
        const notes = await this.loadNoteMap(base.map((result) => result.noteId));
        return base.map((result) => {
            const note = notes.get(result.noteId);
            return {
                id: `${toolId}:${result.noteId}:${result.score}`,
                noteId: result.noteId,
                title: note?.title || this.noteTitles().get(result.noteId) || 'Untitled',
                excerpt: buildSearchSnippet(note?.content || '', query),
                score: result.score,
                kind: this.resultKind(toolId, result.score),
                meta: toolId === 'support-probe' ? 'semantic evidence probe' : 'semantic ANN',
            };
        });
    }

    private async graphSeedHints(query: string): Promise<SemanticWorkshopResult[]> {
        const audit = await this.graphAudit.snapshot(this.buildAuditScope()).catch(() => null);
        const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
        const samples = audit?.sampleNodes || [];
        return samples
            .filter((node) => {
                const haystack = `${node.label} ${node.kind} ${node.id}`.toLocaleLowerCase();
                return !terms.length || terms.some((term) => haystack.includes(term));
            })
            .slice(0, 4)
            .map((node) => ({
                id: `graph-seed:${node.id}`,
                title: node.label || node.id,
                excerpt: `${node.kind} node${node.documentId ? ` from ${node.documentId}` : ''}`,
                score: 1,
                kind: 'graph seed',
                noteId: node.noteId || node.documentId,
                meta: 'committed graph sample',
            }));
    }

    private resultKind(toolId: SemanticToolId, score: number): string {
        if (toolId === 'support-probe') {
            if (score >= 0.7) return 'support candidate';
            if (score >= 0.45) return 'review candidate';
            return 'weak neighbor';
        }
        if (toolId === 'graph-seeds') return 'passage seed';
        if (toolId === 'related-passages') return 'related passage';
        return 'similar passage';
    }

    private async loadNoteMap(ids: string[]): Promise<Map<string, NoteLite>> {
        const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
        if (!uniqueIds.length) return new Map();
        const notes = await ops.getNotesByIds(uniqueIds);
        return new Map(notes.map((note) => [
            note.id,
            {
                id: note.id,
                title: note.title || 'Untitled',
                content: note.markdownContent || note.content || '',
            },
        ]));
    }

    private buildScope(): SearchScope | undefined {
        const scope = this.workbench.scope();
        return scope === 'global' ? undefined : { folderId: scope, folderPath: scope };
    }

    private buildAuditScope(): { folderId?: string } {
        const scope = this.workbench.scope();
        return scope === 'global' ? {} : { folderId: scope };
    }
}

function getSelectionText(): string {
    if (typeof window === 'undefined') return '';
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return '';
    return selection.toString().replace(/\s+/g, ' ').trim();
}
