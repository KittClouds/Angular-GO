import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAlertCircle,
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
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';

import { type SearchScope } from '../../services/phoenix-ui-api.service';
import { NotesService } from '../../lib/dexie/notes.service';
import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { EmbeddingEngine } from '../../lib/embeddings/EmbeddingEngine';
import * as ops from '../../lib/operations';
import { type RetrievalLane } from '../../services/retrieval-workbench-state.service';
import { PhoenixMachineControlService } from '../../services/phoenix-machine-control.service';
import { NerService } from '../../services/ner.service';
import { parseContentToPlainText } from '../../lib/analytics';
import type { EntitySuggestionScanRequest } from '../../lib/entity-suggestions/entity-suggestion.types';
import { BlueprintHubService } from '../blueprint-hub/blueprint-hub.service';
import {
  ATLAS_GRAPH_TARGETS,
  ATLAS_PRESETS,
  EMBEDDING_MODELS,
  RETRIEVAL_LANE_OPTIONS,
  TRUNCATE_DIMS,
  buildGraphPreview,
  buildSearchSnippet,
  type AtlasGraphTargetId,
  type AtlasPresetId,
  type ModelId,
  type SearchMode,
  type SearchPanelNote,
  type SearchResultView,
  type TruncateDim,
} from './search-panel.model';
import { SemanticWorkshopComponent } from './semantic-workshop/semantic-workshop.component';

@Component({
  selector: 'app-search-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgIcon,
    InputTextModule,
    SelectModule,
    ButtonModule,
    SemanticWorkshopComponent,
  ],
  providers: [provideIcons({
    lucideAlertCircle,
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
  private readonly notesService = inject(NotesService);
  private readonly noteStore = inject(NoteEditorStore);
  private readonly machine = inject(PhoenixMachineControlService);
  private readonly nerService = inject(NerService);
  private readonly hubService = inject(BlueprintHubService);

  readonly query = this.machine.query;
  readonly indexScope = this.machine.scope;
  readonly lanes = this.machine.lanes;
  readonly results = signal<SearchResultView[]>([]);
  readonly notice = this.machine.notice;
  readonly error = this.machine.error;
  readonly isSearching = signal(false);
  readonly searchTime = signal(0);

  readonly vectorStatus = this.machine.vectorStatus;
  readonly graphStatus = this.machine.graphStatus;
  readonly graphAudit = this.machine.graphAudit;
  readonly machineStages = this.machine.stages;
  readonly activeSignals = this.machine.activeSignals;
  readonly activeJob = this.machine.activeJob;
  readonly lastSummary = this.machine.lastSummary;
  readonly nerStatus = this.nerService.providerStatuses;
  readonly isDynamicScanning = this.nerService.isAnalyzing;

  readonly selectedModel = signal<ModelId>('mongodb-leaf');
  readonly truncateDim = signal<TruncateDim>('full');
  readonly selectedPreset = signal<AtlasPresetId>('fastScan');
  readonly selectedGraphTargetId = signal<AtlasGraphTargetId>('evidence');
  readonly folders = signal<Array<{ id: string; name: string }>>([]);
  readonly notes = signal<SearchPanelNote[]>([]);

  readonly laneOptions = RETRIEVAL_LANE_OPTIONS;
  readonly models = EMBEDDING_MODELS;
  readonly truncateDims = TRUNCATE_DIMS;
  readonly graphTargets = ATLAS_GRAPH_TARGETS;
  readonly atlasPresets = ATLAS_PRESETS;

  readonly scopedNotes = computed(() => {
    const scope = this.indexScope();
    const notes = this.notes();
    if (scope === 'global') return notes;
    return notes.filter((note) => note.folderId === scope);
  });

  readonly graphNodes = this.machine.graphNodes;
  readonly graphEdges = this.machine.graphEdges;
  readonly registryEntities = this.machine.registryEntities;
  readonly liveDocuments = this.machine.liveDocuments;
  readonly indexedDocuments = this.machine.indexedDocuments;
  readonly staleDocuments = this.machine.staleDocuments;
  readonly staleDocumentSamples = computed(() => this.graphAudit()?.staleDocumentSamples || []);
  readonly visibleStaleDocumentSamples = computed(() => this.staleDocumentSamples().slice(0, 3));
  readonly graphIssueCount = this.machine.graphIssueCount;
  readonly topNodeKinds = computed(() => this.graphAudit()?.nodeKinds.slice(0, 4) || []);
  readonly topEdgeTypes = computed(() => this.graphAudit()?.edgeTypes.slice(0, 4) || []);
  readonly duplicateEdgeSamples = computed(() => this.graphAudit()?.duplicateEdgeSamples.slice(0, 3) || []);
  readonly orphanEdgeSamples = computed(() => this.graphAudit()?.orphanEdgeSamples.slice(0, 3) || []);
  readonly graphPreview = computed(() => buildGraphPreview(this.graphAudit()));
  readonly hasCommittedGraph = this.machine.hasCommittedGraph;
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
    const labels = this.enabledLaneLabels();
    return labels.length ? labels.join(' + ') : 'Lexical retrieval';
  });
  readonly graphSemanticEnabled = computed(() => this.embeddingsReady() && this.graphNodes() > 0);
  readonly vectorRouteLabel = computed(() =>
    this.embeddingsReady() ? 'Embeddings ready for semantic sidecar' : 'Phoenix line fallback'
  );
  readonly selectedGraphTarget = computed(() =>
    this.graphTargets.find((target) => target.id === this.selectedGraphTargetId()) || this.graphTargets[1]
  );
  readonly selectedPresetDefinition = computed(() =>
    this.atlasPresets.find((preset) => preset.id === this.selectedPreset()) || this.atlasPresets[0]
  );
  readonly pipelineStateLabel = computed(() => {
    if (this.activeJob()) return 'running';
    if (this.error()) return 'error';
    const statuses = Object.values(this.machineStages()).map((stage) => stage.status);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('running')) return 'running';
    if (statuses.includes('queued')) return 'queued';
    if (statuses.includes('dirty')) return 'dirty';
    if (statuses.includes('ready') || this.graphStatus() === 'ready') return 'ready';
    return 'idle';
  });
  readonly machineStageRows = computed(() => [
    this.stageRow('signals', 'Signals'),
    this.stageRow('surface', 'Surface'),
    this.stageRow('evidenceGraph', 'Evidence'),
    this.stageRow('embeddings', 'Embeddings'),
    this.stageRow('overgraph', 'OverGraph'),
  ]);
  readonly commandSubtitle = computed(() => {
    const target = this.selectedGraphTarget();
    return `${target.label} · ${target.cost} · ${target.subsystems} subsystems`;
  });
  readonly dynamicNerLabel = computed(() => {
    const status = this.nerStatus().dynamic_ner;
    if (this.isDynamicScanning()) return 'running';
    if (status.loading) return 'warming';
    if (status.error) return 'error';
    return status.ready ? 'ready' : 'cold';
  });
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
          hasBody: !!note.hasBody,
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
      await this.runUnifiedSearch();
      this.searchTime.set(Math.round(performance.now() - start));
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    } finally {
      this.isSearching.set(false);
    }
  }

  toggleLane(lane: RetrievalLane): void {
    this.machine.toggleLane(lane);
    if (lane === 'graph') {
      void this.machine.refreshAuditSafe();
    }
  }

  onScopeChange(scope: 'global' | string): void {
    this.machine.setScope(scope || 'global');
    void this.machine.refreshAuditSafe();
  }

  async loadVectorModel(): Promise<void> {
    try {
      await this.machine.loadSemanticModel(
        this.selectedModel(),
        this.currentModelLabel(),
        this.activeEmbeddingDimensionLabel()
      );
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    }
  }

  async indexVectorNotes(): Promise<void> {
    if (this.vectorStatus() !== 'ready' && this.vectorStatus() !== 'error') return;
    try {
      const notes = await this.loadScopedNotesWithBodies();
      await this.machine.indexSemanticDocuments(notes.map((note) => ({
        id: note.id,
        narrativeId: note.narrativeId,
        title: note.title,
        content: note.content,
      })));
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    }
  }

  async rebuildGraphIndex(): Promise<void> {
    await this.runGraphIndex('force', 'rebuilt');
  }

  async updateGraphIndex(): Promise<void> {
    await this.runGraphIndex('dirty-only', 'updated');
  }

  selectPreset(id: AtlasPresetId): void {
    const preset = this.atlasPresets.find((entry) => entry.id === id);
    if (!preset) return;
    this.selectedPreset.set(id);
    this.selectedGraphTargetId.set(preset.target);
  }

  selectGraphTarget(id: AtlasGraphTargetId): void {
    this.selectedGraphTargetId.set(id);
  }

  async runAtlasPipeline(): Promise<void> {
    const preset = this.selectedPresetDefinition();
    if (preset.id === 'visualizationOnly') {
      this.openGraphLens();
      this.machine.setNotice('Loaded current graph snapshot for visualization. No backend mutation was run.');
      return;
    }

    try {
      if (preset.id === 'fastScan') {
        await this.runDynamicScan();
        await this.runGraphIndex('dirty-only', 'updated');
        return;
      }

      if (preset.id === 'semanticAtlas') {
        await this.runGraphIndex('dirty-only', 'updated');
        if (this.vectorStatus() === 'idle') {
          await this.loadVectorModel();
        }
        await this.indexVectorNotes();
        return;
      }

      await this.runGraphIndex(preset.policy === 'force' ? 'force' : 'dirty-only', preset.policy === 'force' ? 'rebuilt' : 'updated');
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    }
  }

  async runDynamicScan(): Promise<void> {
    const request = this.buildActiveNoteScanRequest();
    if (!request) {
      this.error.set('Open a note with rendered text before running Dynamic NER.');
      return;
    }
    try {
      await this.nerService.runDynamicScan(request);
      const count = this.nerService.suggestions().length;
      this.notice.set(`Dynamic NER scan complete. ${count} candidate${count === 1 ? '' : 's'} available for review.`);
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    }
  }

  openGraphLens(): void {
    this.machine.requestGraphFocus({
      query: this.query().trim(),
      scope: this.indexScope(),
    });
    this.hubService.openPage('graph');
  }

  openResult(result: SearchResultView): void {
    this.noteStore.openNote(result.noteId);
  }

  showResultInGraph(event: Event, result: SearchResultView): void {
    event.stopPropagation();
    this.machine.requestGraphFocus({
      query: this.query().trim() || result.title,
      scope: this.indexScope(),
      noteId: result.noteId,
      title: result.title,
    });
    this.hubService.openPage('graph');
  }

  formatScore(score: number): string {
    if (score <= 1) return `${(score * 100).toFixed(1)}%`;
    return score.toFixed(2);
  }

  laneLabel(lane: RetrievalLane): string {
    return this.laneOptions.find((option) => option.id === lane)?.label || lane;
  }

  laneIcon(lane: RetrievalLane): string {
    return this.laneOptions.find((option) => option.id === lane)?.icon || 'lucideSparkles';
  }

  stageTone(status: string): string {
    if (status === 'running') return 'stage-running';
    if (status === 'ready') return 'stage-ready';
    if (status === 'dirty' || status === 'queued') return 'stage-dirty';
    if (status === 'error') return 'stage-error';
    return 'stage-idle';
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
      return 'Search across the active retrieval lanes';
    }
    return 'No results found';
  }

  emptyStateMessage(): string {
    if (this.isSearching()) {
      return 'Running the selected retrieval path against the current scope.';
    }
    if (!this.query().trim()) {
      return 'Lexical search is always on. Semantic and graph lanes join when they are loaded and indexed.';
    }
    return 'Try a broader query, change the scope, or switch retrieval modes.';
  }

  private async runUnifiedSearch(): Promise<void> {
    const enabled = this.enabledLanes();
    if (enabled.includes('semantic') && this.vectorStatus() === 'idle') {
      this.notice.set('Semantic lane is selected but the local model is not loaded yet. Lexical retrieval still ran.');
    }
    if (enabled.includes('graph') && !this.hasCommittedGraph()) {
      this.notice.set('Graph lane is selected but this scope has no committed graph yet. Search stayed read-only.');
    }
    if (enabled.includes('graph') && this.hasCommittedGraph()) {
      this.graphStatus.set('searching');
    }
    const rawResults = await this.machine.search(this.query(), 60, this.buildScope());
    this.results.set(await this.mapGoResults(rawResults, this.resultSource(), enabled));
  }

  private stageRow(stage: 'signals' | 'surface' | 'evidenceGraph' | 'embeddings' | 'overgraph', label: string): { label: string; status: string; reason?: string } {
    const snapshot = this.machineStages()[stage];
    return {
      label,
      status: snapshot?.status || 'idle',
      reason: snapshot?.reason,
    };
  }

  private buildActiveNoteScanRequest(): EntitySuggestionScanRequest | null {
    const currentNote = this.noteStore.currentNote();
    if (!currentNote) return null;
    const plainText = parseContentToPlainText(currentNote.content || currentNote.markdownContent || '');
    if (!plainText.trim()) return null;
    return {
      noteId: currentNote.id,
      noteTitle: currentNote.title || 'Untitled Note',
      plainText,
    };
  }

  private async runGraphIndex(policy: 'dirty-only' | 'force', verb: 'updated' | 'rebuilt'): Promise<void> {
    try {
      const processedNotes = await this.machine.runGraphIndex(policy, `search-panel:${verb}`);
      if (this.embeddingsReady()) {
        this.notice.set(
          `Graph ${verb} for ${processedNotes} notes. ${this.currentModelLabel()} remains a sidecar, not an automatic mutator.`
        );
      }
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    }
  }

  private async mapGoResults(rawResults: any[], source: SearchMode, lanes: RetrievalLane[]): Promise<SearchResultView[]> {
    const allowedNoteIds = new Set(this.scopedNotes().map((note) => note.id));
    const baseResults = rawResults
      .map((result) => {
        const noteId = result.DocID || result.docID || result.id || '';
        return {
          noteId,
          score: result.Score || result.score || 0,
          source,
          sourceLabel: this.sourceLabel(source),
          meta: this.sourceMeta(source),
          lanes,
        };
      })
      .filter((result) => allowedNoteIds.has(result.noteId))
      .slice(0, 12);
    const noteMap = await this.loadNoteMapByIds(baseResults.map((result) => result.noteId));
    return baseResults.map((result) => {
      const note = noteMap.get(result.noteId);
      return {
        ...result,
        title: note?.title || 'Untitled',
        excerpt: buildSearchSnippet(note?.content || '', this.query()),
      };
    });
  }

  private async hydrateUiState(): Promise<void> {
    if (EmbeddingEngine.isReady()) {
      this.vectorStatus.set('ready');
    }
    await this.machine.refreshAuditSafe();
  }

  private sourceLabel(source: SearchMode): string {
    if (source === 'graph') return 'Unified graph';
    if (source === 'vector') return 'Unified semantic';
    return 'Unified lexical';
  }

  private sourceMeta(source: SearchMode): string {
    if (source === 'graph') return 'Committed graph + lexical seeds';
    if (source === 'vector') return this.vectorRouteLabel();
    return 'Phoenix line search';
  }

  private resultSource(): SearchMode {
    const enabled = this.enabledLanes();
    if (enabled.includes('graph') && this.hasCommittedGraph()) return 'graph';
    if (enabled.includes('semantic') && this.embeddingsReady()) return 'vector';
    return 'notes';
  }

  private enabledLanes(): RetrievalLane[] {
    return this.machine.activeLanes();
  }

  private enabledLaneLabels(): string[] {
    return this.enabledLanes().map((lane) => this.laneLabel(lane));
  }

  private buildScope(): SearchScope | undefined {
    const scope = this.indexScope();
    if (scope === 'global') return undefined;
    return { folderId: scope, folderPath: scope };
  }

  private toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  currentModelLabel(): string {
    return this.selectedModelDefinition().label;
  }

  private async loadScopedNotesWithBodies(): Promise<SearchPanelNote[]> {
    return this.loadNotesByIds(this.scopedNotes().map((note) => note.id));
  }

  private async loadNoteMapByIds(ids: string[]): Promise<Map<string, SearchPanelNote>> {
    const notes = await this.loadNotesByIds(ids);
    return new Map(notes.map((note) => [note.id, note]));
  }

  private async loadNotesByIds(ids: string[]): Promise<SearchPanelNote[]> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) {
      return [];
    }

    const cachedMap = new Map(this.notes().map((note) => [note.id, note]));
    const idsToLoad = uniqueIds.filter((id) => !cachedMap.get(id)?.hasBody);
    const loaded = idsToLoad.length > 0 ? await ops.getNotesByIds(idsToLoad) : [];
    const loadedMap = new Map(loaded.map((note) => [note.id, note]));

    return uniqueIds.map((id) => {
      const full = loadedMap.get(id);
      const cached = cachedMap.get(id);
      return {
        id,
        title: full?.title || cached?.title || 'Untitled',
        content: full?.markdownContent || full?.content || cached?.content || '',
        narrativeId: full?.narrativeId || cached?.narrativeId || '',
        folderId: full?.folderId || cached?.folderId || '',
        hasBody: !!full || !!cached?.hasBody,
      };
    });
  }
}
