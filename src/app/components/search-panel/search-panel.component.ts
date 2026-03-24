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
import { SelectButtonModule } from 'primeng/selectbutton';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { TooltipModule } from 'primeng/tooltip';

import { PhoenixUiApiService, SearchScope } from '../../services/phoenix-ui-api.service';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { SemanticSearchService } from '../../lib/services/semantic-search.service';
import { EmbeddingEngine } from '../../lib/embeddings/EmbeddingEngine';
import type { Entity } from '../../lib/dexie/db';
import { buildScopedCanonicalEntityMap, collectScopedRegistrationNames } from './search-panel.graptor';

type SearchMode = 'notes' | 'vector' | 'graptor';
type VectorStatus = 'idle' | 'loading' | 'ready' | 'indexing' | 'error';
type GraptorStatus = 'idle' | 'building' | 'ready' | 'searching' | 'error';
type ModelId = 'mongodb-leaf' | 'bge-small-en' | 'gte-modernbert-base';
type TruncateDim = 'full' | '256' | '128' | '64';

interface SearchPanelEntity {
  id: string;
  label: string;
  aliases: string[];
  narrativeId?: string;
}

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

interface GraptorBatchEntry {
  chunkId: string;
  title: string;
  content: string;
  mentions: Array<{ entityId: string; count: number }>;
  embeddingText: string;
}

@Component({
  selector: 'app-search-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgIcon,
    SelectButtonModule,
    InputTextModule,
    SelectModule,
    ButtonModule,
    MultiSelectModule,
    TooltipModule
  ],
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
  private readonly graptorBatchSize = 16;
  private readonly phoenixUiApi = inject(PhoenixUiApiService);
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

  readonly selectedModel = signal<ModelId>('mongodb-leaf');
  readonly truncateDim = signal<TruncateDim>('full');
  readonly folders = signal<Array<{ id: string; name: string }>>([]);
  readonly notes = signal<SearchPanelNote[]>([]);
  readonly entities = signal<SearchPanelEntity[]>([]);

  readonly modes: Array<{ id: SearchMode; label: string; icon: string }> = [
    { id: 'notes', label: 'Notes', icon: 'lucideSparkles' },
    { id: 'vector', label: 'Vector', icon: 'lucideZap' },
    { id: 'graptor', label: 'Graptor', icon: 'lucideLayers' },
  ];

  readonly modeOptions = [
    { label: 'Notes', value: 'notes' as SearchMode },
    { label: 'Vector', value: 'vector' as SearchMode },
    { label: 'Graptor', value: 'graptor' as SearchMode }
  ];

  readonly models: Array<{ id: ModelId; label: string; dims: number; desc: string }> = [
    { id: 'mongodb-leaf', label: 'MDBR Leaf', dims: 256, desc: 'Fastest local TypeScript path.' },
    { id: 'bge-small-en', label: 'BGE-small', dims: 384, desc: 'Balanced local embedding path.' },
    { id: 'gte-modernbert-base', label: 'ModernBERT', dims: 768, desc: 'Largest local embedding model.' },
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
  readonly selectedModelDefinition = computed(() =>
    this.models.find((model) => model.id === this.selectedModel()) || this.models[0]
  );
  readonly embeddingsReady = computed(() => EmbeddingEngine.isReady());
  readonly activeEmbeddingDimensionLabel = computed(() => {
    const modelDims = this.selectedModelDefinition().dims;
    const truncateDim = this.truncateDim();
    return truncateDim === 'full' ? `${modelDims}d` : `${Math.min(Number(truncateDim), modelDims)}d`;
  });
  readonly headerSubtitle = computed(() => {
    if (this.activeMode() === 'notes') return 'Live Phoenix lex';
    if (this.activeMode() === 'vector') {
      return this.embeddingsReady()
        ? `${this.currentModelLabel()} ready for Graptor semantic sidecar`
        : 'Local embeddings + Phoenix note fallback';
    }
    return this.graptorSemanticEnabled()
      ? 'GLDR + qgram + graph + semantic expansion'
      : 'GLDR + qgram + graph';
  });
  readonly searchActionLabel = computed(() => {
    if (this.activeMode() === 'notes') return 'Search';
    if (this.activeMode() === 'vector') return 'Vector';
    return 'Graptor';
  });
  readonly graptorSemanticEnabled = computed(() => this.embeddingsReady() && this.graptorStats().chunks > 0);
  readonly vectorRouteLabel = computed(() =>
    this.embeddingsReady() ? 'Embeddings ready for GLDR sidecar' : 'Go note fallback'
  );
  readonly graptorBuildLabel = computed(() =>
    this.embeddingsReady() ? 'Build Graptor + semantic index' : 'Build Graptor index'
  );

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

    this.notesService.getAllEntities$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entities: Entity[]) => {
        this.entities.set(entities.map((entity) => ({
          id: entity.id,
          label: entity.label || '',
          aliases: entity.aliases || [],
          narrativeId: entity.narrativeId || '',
        })));
      });

    this.notesService.getAllFolders$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((folders) => {
        this.folders.set(folders.map((folder) => ({ id: folder.id, name: folder.name })));
      });

    void this.hydrateUiState();
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

  onModeChange(event: { value?: SearchMode }): void {
    if (event.value) {
      this.activeMode.set(event.value);
      if (event.value === 'graptor') {
        void this.refreshGraptorStatsSafe();
      }
    }
  }

  async loadVectorModel(): Promise<void> {
    this.vectorStatus.set('loading');
    this.error.set(null);
    try {
      await this.semanticSearch.initializeWorker();
      await EmbeddingEngine.initialize(this.selectedModel());
      this.vectorStatus.set('ready');
      this.notice.set(
        `${this.currentModelLabel()} loaded at ${this.activeEmbeddingDimensionLabel()}. Vector mode still uses the live note fallback, and Graptor can now send semantic candidates into GLDR over SAB.`
      );
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
      this.notice.set(
        `Queued ${notes.length} notes for embedding. Graptor will use ${this.currentModelLabel()} at ${this.activeEmbeddingDimensionLabel()} when you build its index.`
      );
    } catch (err) {
      this.vectorStatus.set('error');
      this.error.set(this.toErrorMessage(err));
    }
  }

  async rebuildGraptorIndex(): Promise<void> {
    this.graptorStatus.set('building');
    this.error.set(null);
    try {
      const init = await this.phoenixUiApi.gldrInit();
      if (!init.success) {
        throw new Error(init.error || 'Failed to initialize GLDR');
      }

      const notes = this.scopedNotes();
      const pendingEmbeddingBatch: GraptorBatchEntry[] = [];
      const canEmbed = EmbeddingEngine.isReady();

      for (const note of notes) {
        const scanText = this.buildGraptorScanText(note);
        const scanResult = scanText ? await this.phoenixUiApi.scan(scanText) : null;
        const mentions = this.extractGraptorMentions(scanResult);
        const embeddingText = (scanText || note.content || note.title).trim();

        await this.registerGraptorEntities(scanResult, mentions);
        await this.ingestGraptorEdges(scanResult);

        if (canEmbed && embeddingText) {
          pendingEmbeddingBatch.push({
            chunkId: note.id,
            title: note.title,
            content: note.content,
            mentions,
            embeddingText,
          });
          if (pendingEmbeddingBatch.length >= this.graptorBatchSize) {
            await this.flushGraptorEmbeddingBatch(pendingEmbeddingBatch.splice(0, pendingEmbeddingBatch.length));
          }
          continue;
        }

        const indexRes = await this.phoenixUiApi.gldrIndexChunk(note.id, {
          title: note.title,
          content: note.content,
        }, mentions);
        if (!indexRes.success) {
          throw new Error(indexRes.error || `Failed to index note ${note.title}`);
        }
      }

      if (pendingEmbeddingBatch.length) {
        await this.flushGraptorEmbeddingBatch(pendingEmbeddingBatch.splice(0, pendingEmbeddingBatch.length));
      }

      await this.refreshGraptorStats();
      this.graptorStatus.set('ready');
      this.notice.set(
        this.embeddingsReady()
          ? `Built Graptor index for ${notes.length} notes with semantic expansion enabled via ${this.currentModelLabel()} at ${this.activeEmbeddingDimensionLabel()}.`
          : `Built Graptor index for ${notes.length} notes with canonical entity mentions in the current scope.`
      );
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
    if (this.embeddingsReady() && this.vectorStatus() === 'idle') {
      return this.activeEmbeddingDimensionLabel();
    }

    switch (this.vectorStatus()) {
      case 'loading':
        return 'Loading';
      case 'ready':
        return this.activeEmbeddingDimensionLabel();
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
    const rawResults = await this.phoenixUiApi.searchScoped(this.query(), 60, this.buildScope());
    this.results.set(this.mapGoResults(rawResults, 'notes'));
  }

  private async runVectorSearch(): Promise<void> {
    if (this.vectorStatus() === 'idle') {
      this.notice.set('Load the embedding model to manage vector indexing. Query results still come from the live Go note path until a dedicated vector retrieval UI replaces the retired Cozo stack.');
    }
    const rawResults = await this.phoenixUiApi.searchScoped(this.query(), 60, this.buildScope());
    this.results.set(this.mapGoResults(rawResults, 'vector'));
  }

  private async runGraptorSearch(): Promise<void> {
    if (this.graptorStatus() !== 'ready' || this.graptorStats().chunks === 0) {
      await this.rebuildGraptorIndex();
      if (this.graptorStatus() !== 'ready') return;
    }

    this.graptorStatus.set('searching');
    const queryEmbedding = await this.embedForGraptor(this.query());
    const config = queryEmbedding
      ? { topChunks: 12, semanticTopK: 24, semanticAlpha: 0.22, semanticGamma: 0.35 }
      : { topChunks: 12 };
    const raw = queryEmbedding
      ? await this.phoenixUiApi.gldrSearchWithEmbedding(this.query(), queryEmbedding, config)
      : await this.phoenixUiApi.gldrSearch(this.query(), config);
    const parsed = this.parseGraptorResults(raw) as Array<{
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
        meta: queryEmbedding ? `Semantic ${this.activeEmbeddingDimensionLabel()} + graph` : 'Graph + lexical',
        lexScore: result.lexScore,
        graphScore: result.graphScore,
        matchedEntities: (result.matchedEntities || []).map((item) => item.entityId),
      } as SearchResultView;
    }));
    this.graptorStatus.set('ready');
  }

  private async flushGraptorEmbeddingBatch(items: GraptorBatchEntry[]): Promise<void> {
    if (!items.length) return;

    try {
      const embeddings = await EmbeddingEngine.embed(items.map((item) => item.embeddingText));
      const indexRes = await this.phoenixUiApi.gldrIndexChunksWithEmbeddings(items.map((item, index) => ({
        chunkId: item.chunkId,
        fields: {
          title: item.title,
          content: item.content,
        },
        mentions: item.mentions,
        embedding: this.prepareEmbedding(embeddings[index] || []),
      })));
      if (!indexRes.success) {
        throw new Error(indexRes.error || 'Failed to batch index Graptor notes');
      }
    } catch (_err) {
      for (const item of items) {
        const indexRes = await this.phoenixUiApi.gldrIndexChunk(item.chunkId, {
          title: item.title,
          content: item.content,
        }, item.mentions);
        if (!indexRes.success) {
          throw new Error(indexRes.error || `Failed to index note ${item.title}`);
        }
      }
    }
  }

  private async embedForGraptor(text: string): Promise<Float32Array | null> {
    const source = text.trim();
    if (!source || !EmbeddingEngine.isReady()) return null;
    const [embedding] = await EmbeddingEngine.embed([source]);
    if (!embedding?.length) return null;
    return this.prepareEmbedding(embedding);
  }

  private parseGraptorResults(raw: string): unknown[] {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new Error(String((parsed as { error?: string }).error || 'GLDR search failed'));
    }
    return [];
  }

  private buildGraptorScanText(note: SearchPanelNote): string {
    const content = note.content.trim();
    const title = note.title.trim();
    if (!content) return title;
    if (!title || content.startsWith(title)) return content;
    return `${title}\n\n${content}`;
  }

  private extractGraptorMentions(scanResult: any): Array<{ entityId: string; count: number }> {
    const items = Array.isArray(scanResult?.mentions) ? scanResult.mentions : [];
    return items
      .map((item: any) => ({
        entityId: typeof item?.entityId === 'string' ? item.entityId : '',
        count: Number(item?.count || 0),
      }))
      .filter((item: { entityId: string; count: number }) => item.entityId && item.count > 0);
  }

  private async registerGraptorEntities(
    scanResult: any,
    mentions: Array<{ entityId: string; count: number }>
  ): Promise<void> {
    if (!mentions.length) return;

    const graphNodes = scanResult?.graph?.nodes || scanResult?.graph?.Nodes || {};
    const entityStore = buildScopedCanonicalEntityMap(this.entities(), this.scopedNotes());

    for (const mention of mentions) {
      const canonical = entityStore.get(mention.entityId);
      const node = graphNodes[mention.entityId];
      const names = collectScopedRegistrationNames(mention.entityId, canonical, node);

      for (const name of names) {
        await this.phoenixUiApi.gldrRegisterEntity(name, mention.entityId);
      }
    }
  }

  private async ingestGraptorEdges(scanResult: any): Promise<void> {
    const edges = scanResult?.graph?.edges || scanResult?.graph?.Edges || [];
    for (const edge of edges) {
      const sourceId = edge?.source || edge?.Source;
      const targetId = edge?.target || edge?.Target;
      if (!sourceId || !targetId) continue;

      await this.phoenixUiApi.gldrAddGraphEdge(sourceId, {
        targetId,
        relType: edge?.type || edge?.Type || edge?.relation || 'related_to',
        confidence: Number(edge?.confidence || edge?.Confidence || edge?.weight || 1),
        source: 'scanner',
      });
    }
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
          meta: source === 'notes' ? 'Title + body' : this.vectorRouteLabel(),
        };
      })
      .filter((result) => allowedNoteIds.has(result.noteId))
      .slice(0, 12);
  }

  private async refreshGraptorStats(): Promise<void> {
    const raw = await this.phoenixUiApi.gldrStats();
    this.graptorStats.set(JSON.parse(raw) as GraptorStats);
  }

  private async refreshGraptorStatsSafe(): Promise<void> {
    try {
      await this.refreshGraptorStats();
    } catch {
      this.graptorStats.set({ entities: 0, chunks: 0, edges: 0 });
    }
  }

  private async hydrateUiState(): Promise<void> {
    if (EmbeddingEngine.isReady()) {
      this.vectorStatus.set('ready');
    }
    await this.refreshGraptorStatsSafe();
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

  currentModelLabel(): string {
    return this.selectedModelDefinition().label;
  }

  private prepareEmbedding(source: ArrayLike<number>): Float32Array {
    const targetDim = this.truncateDim() === 'full' ? 0 : Number(this.truncateDim());
    const sourceLength = typeof source.length === 'number' ? source.length : 0;
    const finalLength = targetDim > 0 ? Math.min(targetDim, sourceLength) : sourceLength;
    const embedding = new Float32Array(finalLength);
    let norm = 0;

    for (let i = 0; i < finalLength; i++) {
      const value = Number(source[i] || 0);
      embedding[i] = value;
      norm += value * value;
    }

    if (norm > 0) {
      const invNorm = 1 / Math.sqrt(norm);
      for (let i = 0; i < finalLength; i++) {
        embedding[i] *= invNorm;
      }
    }

    return embedding;
  }
}
