import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAlertCircle,
  lucideChevronDown,
  lucideCpu,
  lucideFileText,
  lucideFolder,
  lucideGlobe,
  lucideLayers,
  lucideLoader2,
  lucideMicrochip,
  lucideSearch,
  lucideSparkles,
  lucideZap,
} from '@ng-icons/lucide';

import { GoKittService, SearchScope } from '../../services/gokitt.service';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { SemanticSearchService } from '../../lib/services/semantic-search.service';

type SearchMode = 'notes' | 'vector' | 'graptor';
type VectorStatus = 'idle' | 'loading' | 'ready' | 'indexing' | 'error';
type GraptorStatus = 'idle' | 'building' | 'ready' | 'searching' | 'error';
type ModelId = 'mdbr-leaf' | 'bge-small' | 'modernbert-base';
type TruncateDim = 'full' | '256' | '128' | '64';

interface SearchPanelNote {
  id: string;
  title: string;
  content: string;
  narrativeId: string;
  folderId: string;
}

interface SearchResultView {
  noteId: string;
  title: string;
  excerpt: string;
  score: number;
  source: SearchMode;
  sourceLabel: string;
  meta?: string;
  lexScore?: number;
  graphScore?: number;
  matchedEntities?: string[];
}

interface GraptorStats {
  entities: number;
  chunks: number;
  edges: number;
}

@Component({
  selector: 'app-search-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, NgIcon],
  providers: [provideIcons({
    lucideAlertCircle,
    lucideChevronDown,
    lucideCpu,
    lucideFileText,
    lucideFolder,
    lucideGlobe,
    lucideLayers,
    lucideLoader2,
    lucideMicrochip,
    lucideSearch,
    lucideSparkles,
    lucideZap,
  })],
  templateUrl: './search-panel.component.html',
  styleUrls: ['./search-panel.component.css'],
})
export class SearchPanelComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly goKitt = inject(GoKittService);
  private readonly notesService = inject(NotesService);
  private readonly noteStore = inject(NoteEditorStore);
  private readonly semanticSearch = inject(SemanticSearchService);

  readonly activeMode = signal<SearchMode>('notes');
  readonly query = signal('');
  readonly indexScope = signal<'global' | string>('global');
  readonly results = signal<SearchResultView[]>([]);
  readonly notice = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly isSearching = signal(false);
  readonly searchTime = signal(0);

  readonly vectorStatus = signal<VectorStatus>('idle');
  readonly graptorStatus = signal<GraptorStatus>('idle');
  readonly graptorStats = signal<GraptorStats>({ entities: 0, chunks: 0, edges: 0 });

  readonly selectedModel = signal<ModelId>('mdbr-leaf');
  readonly truncateDim = signal<TruncateDim>('full');
  readonly folders = signal<Array<{ id: string; name: string }>>([]);
  readonly notes = signal<SearchPanelNote[]>([]);

  readonly modes: Array<{ id: SearchMode; label: string; icon: string }> = [
    { id: 'notes', label: 'Notes', icon: 'lucideSparkles' },
    { id: 'vector', label: 'Vector', icon: 'lucideZap' },
    { id: 'graptor', label: 'Graptor', icon: 'lucideLayers' },
  ];

  readonly models: Array<{ id: ModelId; label: string; dims: number; desc: string }> = [
    { id: 'mdbr-leaf', label: 'MDBR Leaf', dims: 256, desc: 'Fastest local TypeScript path.' },
    { id: 'bge-small', label: 'BGE-small', dims: 384, desc: 'Balanced Rust/WASM embeddings.' },
    { id: 'modernbert-base', label: 'ModernBERT', dims: 768, desc: 'Largest local embedding model.' },
  ];

  readonly truncateDims: TruncateDim[] = ['full', '256', '128', '64'];

  readonly scopedNotes = computed(() => {
    const scope = this.indexScope();
    const notes = this.notes();
    if (scope === 'global') return notes;
    return notes.filter((note) => note.folderId === scope);
  });

  readonly modeLabel = computed(() => this.modes.find((mode) => mode.id === this.activeMode())?.label || 'Notes');
  readonly modeIcon = computed(() => this.modes.find((mode) => mode.id === this.activeMode())?.icon || 'lucideSearch');

  ngOnInit(): void {
    this.notesService.getAllNotes$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((notes) => {
        this.notes.set(notes.map((note) => ({
          id: note.id,
          title: note.title || 'Untitled',
          content: note.markdownContent || note.content || '',
          narrativeId: note.narrativeId || '',
          folderId: note.folderId || '',
        })));
      });

    this.notesService.getAllFolders$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((folders) => {
        this.folders.set(folders.map((folder) => ({ id: folder.id, name: folder.name })));
      });
  }

  async handleSearch(): Promise<void> {
    const query = this.query().trim();
    if (!query) {
      this.results.set([]);
      this.notice.set(null);
      this.error.set(null);
      return;
    }

    this.isSearching.set(true);
    this.notice.set(null);
    this.error.set(null);
    const start = performance.now();

    try {
      switch (this.activeMode()) {
        case 'notes':
          await this.runNotesSearch();
          break;
        case 'vector':
          await this.runVectorSearch();
          break;
        case 'graptor':
          await this.runGraptorSearch();
          break;
      }
      this.searchTime.set(Math.round(performance.now() - start));
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    } finally {
      this.isSearching.set(false);
    }
  }

  async loadVectorModel(): Promise<void> {
    this.vectorStatus.set('loading');
    this.error.set(null);
    try {
      await this.semanticSearch.initializeWorker();
      this.vectorStatus.set('ready');
      this.notice.set('Embedding model loaded. Retrieval still falls back to the live Go note search path until vector retrieval is rebuilt.');
    } catch (err) {
      this.vectorStatus.set('error');
      this.error.set(this.toErrorMessage(err));
    }
  }
  async indexVectorNotes(): Promise<void> {
    if (this.vectorStatus() !== 'ready' && this.vectorStatus() !== 'error') return;

    this.vectorStatus.set('indexing');
    this.error.set(null);

    try {
      const notes = this.scopedNotes();
      await this.semanticSearch.indexNotes(notes.map((note) => ({
        id: note.id,
        narrativeId: note.narrativeId,
        title: note.title,
        content: note.content,
      })));
      this.vectorStatus.set('ready');
      this.notice.set(`Queued ${notes.length} notes for embedding. Search remains on the live Go note backend for now.`);
    } catch (err) {
      this.vectorStatus.set('error');
      this.error.set(this.toErrorMessage(err));
    }
  }

  async rebuildGraptorIndex(): Promise<void> {
    this.graptorStatus.set('building');
    this.error.set(null);

    try {
      const init = await this.goKitt.gldrInit();
      if (!init.success) {
        throw new Error(init.error || 'Failed to initialize GLDR');
      }

      const notes = this.scopedNotes();
      for (const note of notes) {
        const indexRes = await this.goKitt.gldrIndexChunk(note.id, {
          title: note.title,
          content: note.content,
        }, []);
        if (!indexRes.success) {
          throw new Error(indexRes.error || `Failed to index note ${note.title}`);
        }
      }

      await this.refreshGraptorStats();
      this.graptorStatus.set('ready');
      this.notice.set(`Built Graptor index for ${notes.length} notes in the current scope.`);
    } catch (err) {
      this.graptorStatus.set('error');
      this.error.set(this.toErrorMessage(err));
    }
  }

  openResult(result: SearchResultView): void {
    this.noteStore.openNote(result.noteId);
  }

  formatScore(score: number): string {
    if (score <= 1) return `${(score * 100).toFixed(1)}%`;
    return score.toFixed(2);
  }

  vectorStatusLabel(): string {
    switch (this.vectorStatus()) {
      case 'loading':
        return 'Loading';
      case 'ready':
        return 'Ready';
      case 'indexing':
        return 'Indexing';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }

  emptyStateTitle(): string {
    if (this.isSearching()) return 'Searching workspace';
    if (!this.query().trim()) {
      if (this.activeMode() === 'notes') return 'Search notes by title and content';
      if (this.activeMode() === 'vector') return 'Load embeddings when you need vector tooling';
      return 'Build the Graptor index to search through GLDR';
    }
    return 'No results found';
  }

  emptyStateMessage(): string {
    if (this.isSearching()) {
      return 'Running the selected retrieval path against the current scope.';
    }
    if (!this.query().trim()) {
      if (this.activeMode() === 'notes') {
        return 'Notes mode is the reliable baseline and uses the same Go/qgram search that already works in analytics.';
      }
      if (this.activeMode() === 'vector') {
        return 'Vector mode keeps embedding model loading and indexing visible while the old Cozo retrieval layer stays retired.';
      }
      return 'Graptor mode exposes GLDR chunk retrieval so the left sidebar can use the same graph-native workspace as evals.';
    }
    return 'Try a broader query, change the scope, or switch retrieval modes.';
  }

  private async runNotesSearch(): Promise<void> {
    const rawResults = await this.goKitt.search(this.query(), 60);
    this.results.set(this.mapGoResults(rawResults, 'notes'));
  }

  private async runVectorSearch(): Promise<void> {
    if (this.vectorStatus() === 'idle') {
      this.notice.set('Load the embedding model to manage vector indexing. Query results still come from the live note search path.');
    }
    const rawResults = await this.goKitt.search(this.query(), 60);
    this.results.set(this.mapGoResults(rawResults, 'vector'));
  }

  private async runGraptorSearch(): Promise<void> {
    if (this.graptorStatus() !== 'ready' || this.graptorStats().chunks === 0) {
      await this.rebuildGraptorIndex();
      if (this.graptorStatus() !== 'ready') return;
    }

    this.graptorStatus.set('searching');
    const raw = await this.goKitt.gldrSearch(this.query(), { topChunks: 12 });
    const parsed = JSON.parse(raw) as Array<{
      chunkId: string;
      chunkScore: number;
      lexScore: number;
      graphScore: number;
      matchedEntities?: Array<{ entityId: string }>;
    }>;

    const noteMap = new Map(this.notes().map((note) => [note.id, note]));
    this.results.set(parsed.map((result) => {
      const note = noteMap.get(result.chunkId);
      return {
        noteId: result.chunkId,
        title: note?.title || 'Untitled',
        excerpt: this.buildSnippet(note?.content || '', this.query()),
        score: result.chunkScore,
        source: 'graptor',
        sourceLabel: 'Graptor',
        meta: 'Chunk ranking',
        lexScore: result.lexScore,
        graphScore: result.graphScore,
        matchedEntities: (result.matchedEntities || []).map((item) => item.entityId),
      } as SearchResultView;
    }));
    this.graptorStatus.set('ready');
  }

  private mapGoResults(rawResults: any[], source: 'notes' | 'vector'): SearchResultView[] {
    const noteMap = new Map(this.notes().map((note) => [note.id, note]));
    const allowedNoteIds = new Set(this.scopedNotes().map((note) => note.id));
    return rawResults
      .map((result) => {
        const noteId = result.DocID || result.docID || result.id || '';
        const note = noteMap.get(noteId);
        return {
          noteId,
          title: note?.title || 'Untitled',
          excerpt: this.buildSnippet(note?.content || '', this.query()),
          score: result.Score || result.score || 0,
          source,
          sourceLabel: source === 'notes' ? 'Notes' : 'Vector fallback',
          meta: source === 'notes' ? 'Title + body' : 'Embedding workspace active',
        };
      })
      .filter((result) => allowedNoteIds.has(result.noteId))
      .slice(0, 12);
  }
  private async refreshGraptorStats(): Promise<void> {
    const raw = await this.goKitt.gldrStats();
    this.graptorStats.set(JSON.parse(raw) as GraptorStats);
  }

  private buildScope(): SearchScope | undefined {
    const scope = this.indexScope();
    if (scope === 'global') return undefined;
    return { folderPath: scope };
  }

  private buildSnippet(content: string, query: string): string {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    if (!trimmed) return 'No note preview available.';

    const normalizedQuery = query.trim().toLowerCase();
    const matchIndex = normalizedQuery ? trimmed.toLowerCase().indexOf(normalizedQuery) : -1;
    if (matchIndex === -1) {
      return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
    }

    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(trimmed.length, matchIndex + normalizedQuery.length + 120);
    const snippet = trimmed.slice(start, end);
    return `${start > 0 ? '... ' : ''}${snippet}${end < trimmed.length ? ' ...' : ''}`;
  }

  private toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

