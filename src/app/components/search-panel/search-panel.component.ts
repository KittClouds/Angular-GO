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
import { AtlasScanCoordinatorService } from '../../services/atlas-scan-coordinator.service';
import { parseContentToPlainText } from '../../lib/analytics';
import type { EntitySuggestionScanRequest } from '../../lib/entity-suggestions/entity-suggestion.types';
import { BlueprintHubService } from '../blueprint-hub/blueprint-hub.service';
import { NliWorkerService } from '../../lib/services/nli-worker.service';
import {
  EMBEDDING_MODELS,
  RETRIEVAL_LANE_OPTIONS,
  TRUNCATE_DIMS,
  buildSearchSnippet,
  type ModelId,
  type SearchMode,
  type SearchPanelNote,
  type SearchResultView,
  type TruncateDim,
} from './search-panel.model';
import {
  ATLAS_RECIPES,
  buildAtlasCommandStatus,
  estimateDynamicChunks,
  type AtlasRecipeId,
} from './atlas-command-status.model';
import {
  buildAtlasModelLaneViews,
  buildAtlasRecipeLifecycle,
  getAtlasModelRecipePlan,
  laneListLabel,
  type AtlasModelLaneId,
  type AtlasRecipeLifecycleId,
} from './atlas-model-recipe.model';
import { SemanticWorkshopComponent } from './semantic-workshop/semantic-workshop.component';

const NLI_MODEL_ID = 'onnx-community/ModernBERT-base-nli-ONNX';

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
  styleUrls: ['./search-panel.component.css', './search-panel.pipeline-map.css'],
})
export class SearchPanelComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly notesService = inject(NotesService);
  private readonly noteStore = inject(NoteEditorStore);
  private readonly machine = inject(PhoenixMachineControlService);
  private readonly nerService = inject(NerService);
  private readonly atlasScan = inject(AtlasScanCoordinatorService);
  private readonly hubService = inject(BlueprintHubService);
  private readonly nli = inject(NliWorkerService);

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
  readonly isDynamicScanning = computed(() => this.nerService.isAnalyzing() || this.atlasScan.running());

  readonly selectedModel = signal<ModelId>('mongodb-leaf');
  readonly truncateDim = signal<TruncateDim>('full');
  readonly selectedRecipe = signal<AtlasRecipeId>('fastTextGraph');
  readonly activeRecipe = signal<AtlasRecipeId | null>(null);
  readonly activeLaneWarm = signal<AtlasModelLaneId | null>(null);
  readonly activeRecipeStep = signal<AtlasRecipeLifecycleId | null>(null);
  readonly completedRecipeSteps = signal<AtlasRecipeLifecycleId[]>([]);
  readonly failedRecipeStep = signal<AtlasRecipeLifecycleId | null>(null);
  readonly folders = signal<Array<{ id: string; name: string }>>([]);
  readonly notes = signal<SearchPanelNote[]>([]);

  readonly laneOptions = RETRIEVAL_LANE_OPTIONS;
  readonly models = EMBEDDING_MODELS;
  readonly truncateDims = TRUNCATE_DIMS;
  readonly atlasRecipes = ATLAS_RECIPES;
  readonly atlasPhase = this.atlasScan.phase;
  readonly atlasMessage = this.atlasScan.message;
  readonly lastAtlasResult = this.atlasScan.lastResult;

  readonly scopedNotes = computed(() => {
    const scope = this.indexScope();
    const notes = this.notes();
    if (scope === 'global') return notes;
    return notes.filter((note) => note.folderId === scope);
  });

  readonly graphNodes = this.machine.graphNodes;
  readonly graphEdges = this.machine.graphEdges;
  readonly registryEntities = this.machine.registryEntities;
  readonly staleDocuments = this.machine.staleDocuments;
  readonly staleDocumentSamples = computed(() => this.graphAudit()?.staleDocumentSamples || []);
  readonly visibleStaleDocumentSamples = computed(() => this.staleDocumentSamples().slice(0, 3));
  readonly graphIssueCount = this.machine.graphIssueCount;
  readonly duplicateEdgeSamples = computed(() => this.graphAudit()?.duplicateEdgeSamples.slice(0, 3) || []);
  readonly orphanEdgeSamples = computed(() => this.graphAudit()?.orphanEdgeSamples.slice(0, 3) || []);
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
  readonly vectorRouteLabel = computed(() =>
    this.embeddingsReady() ? 'Embeddings ready for semantic sidecar' : 'Phoenix line fallback'
  );
  readonly scopeLabel = computed(() => {
    const scope = this.indexScope();
    if (scope === 'global') return 'Global (all notes)';
    return this.folders().find((folder) => folder.id === scope)?.name || scope;
  });
  readonly commandStatus = computed(() => buildAtlasCommandStatus({
    scopeLabel: this.scopeLabel(),
    noteCount: this.scopedNotes().length,
    estimatedChunks: estimateDynamicChunks(this.scopedNotes()),
    audit: this.graphAudit(),
    stages: this.machineStages(),
    activeJob: this.activeJob(),
    lastSummary: this.lastSummary(),
    lastRichScan: this.lastAtlasResult()?.nativeResult || null,
    vectorStatus: this.vectorStatus(),
    graphStatus: this.graphStatus(),
    manifoldMode: this.machine.manifoldMode(),
    manifoldStatus: this.machine.manifoldStatus(),
    manifoldStatuses: this.machine.manifoldStatuses(),
    dynamicNerStatus: this.dynamicNerLabel(),
    enabledLanes: this.enabledLanes(),
    embeddingModelLabel: this.currentModelLabel(),
    embeddingDimensionLabel: this.activeEmbeddingDimensionLabel(),
  }));
  readonly ledgerGroups = computed(() => this.commandStatus().ledgerGroups);
  readonly inventoryMetrics = computed(() => this.commandStatus().metrics);
  readonly pipelineStages = computed(() => this.commandStatus().stages);
  readonly sidecarMetrics = computed(() => this.commandStatus().sidecars);
  readonly chunkingStatus = computed(() => this.commandStatus().chunking);
  readonly lastRunStatus = computed(() => this.commandStatus().lastRun);
  readonly selectedRecipePlan = computed(() => getAtlasModelRecipePlan(this.selectedRecipe()));
  readonly modelLaneViews = computed(() => {
    const statuses = this.nerStatus();
    const coOccurrence = statuses.fst;
    return buildAtlasModelLaneViews({
      dynamicNerStatus: this.dynamicNerLabel(),
      coOccurrenceReady: coOccurrence.ready,
      coOccurrenceLoading: coOccurrence.loading,
      coOccurrenceError: coOccurrence.error,
      vectorStatus: this.vectorStatus(),
      semanticReady: this.embeddingsReady() || this.vectorStatus() === 'ready',
      semanticDetail: `${this.currentModelLabel()} ${this.activeEmbeddingDimensionLabel()}`,
      nliInitialized: this.nli.isInitialized(),
      nliProcessing: this.nli.isProcessing(),
      nliModelId: this.nli.modelId(),
      manifoldStatuses: this.machine.manifoldStatuses(),
    });
  });
  readonly recipeLifecycle = computed(() => buildAtlasRecipeLifecycle(
    this.activeRecipeStep(),
    this.completedRecipeSteps(),
    this.failedRecipeStep(),
  ));
  readonly pipelineStateLabel = computed(() => {
    const activeJob = this.activeJob();
    if (activeJob && activeJob !== 'manifold-load' && activeJob !== 'graph-focus') return 'running';
    if (this.error()) return 'error';
    const statuses = Object.values(this.machineStages()).map((stage) => stage.status);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('running')) return 'running';
    if (statuses.includes('queued')) return 'queued';
    if (statuses.includes('dirty')) return 'dirty';
    if (statuses.includes('ready') || this.graphStatus() === 'ready') return 'ready';
    return 'idle';
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

  async runAtlasRecipe(recipeId: AtlasRecipeId): Promise<void> {
    if (this.activeRecipe()) return;
    this.selectedRecipe.set(recipeId);
    this.activeRecipe.set(recipeId);
    this.resetRecipeProgress();
    this.error.set(null);
    try {
      this.beginRecipeStep('scope');
      this.completeRecipeStep('scope');
      this.beginRecipeStep('warm');
      await this.prepareRecipeModels(recipeId);
      this.completeRecipeStep('warm');
      this.beginRecipeStep('run');
      switch (recipeId) {
        case 'runNer':
          await this.runDynamicScan();
          break;
        case 'fastTextGraph':
          await this.runAtlasSurfaceGraph('dirty-only');
          break;
        case 'fullTextGraph':
          await this.runAtlasSurfaceGraph('force');
          break;
        case 'semanticAtlas':
          await this.runSemanticAtlas();
          break;
        case 'warmFullIndexStack':
          await this.warmFullIndexStack();
          break;
        case 'visualizeCurrentGraph':
          this.openGraphLens();
          this.machine.setNotice('Loaded current graph snapshot for visualization. No backend mutation was run.');
          break;
      }
      this.completeRecipeStep('run');
      this.beginRecipeStep('refresh');
      this.completeRecipeStep('refresh');
    } catch (err) {
      this.failRecipeStep(this.activeRecipeStep() || 'run');
      this.error.set(this.toErrorMessage(err));
    } finally {
      this.activeRecipe.set(null);
      this.activeRecipeStep.set(null);
    }
  }

  async runDynamicScan(): Promise<void> {
    const request = this.buildActiveNoteScanRequest();
    if (!request) {
      throw new Error('Open a note with rendered text before running Dynamic NER.');
    }
    await this.nerService.runDynamicScan(request);
    const count = this.nerService.suggestions().length;
    this.notice.set(`Dynamic NER scan complete. ${count} candidate${count === 1 ? '' : 's'} available for review.`);
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

  countLabel(value: number | null): string {
    return value === null ? 'unavailable' : value.toLocaleString();
  }

  selectRecipe(recipeId: AtlasRecipeId): void {
    if (this.activeRecipe()) return;
    this.selectedRecipe.set(recipeId);
    this.resetRecipeProgress();
  }

  async runSelectedRecipe(): Promise<void> {
    await this.runAtlasRecipe(this.selectedRecipe());
  }

  async warmSelectedRecipeModels(): Promise<void> {
    if (this.activeRecipe()) return;
    const recipeId = this.selectedRecipe();
    this.activeRecipe.set(recipeId);
    this.resetRecipeProgress();
    this.error.set(null);
    try {
      this.beginRecipeStep('scope');
      this.completeRecipeStep('scope');
      this.beginRecipeStep('warm');
      await this.prepareRecipeModels(recipeId);
      this.completeRecipeStep('warm');
      this.notice.set(`${this.selectedRecipePlan().label} lanes are warm. No graph data was mutated.`);
    } catch (err) {
      this.failRecipeStep(this.activeRecipeStep() || 'warm');
      this.error.set(this.toErrorMessage(err));
    } finally {
      this.activeRecipe.set(null);
      this.activeRecipeStep.set(null);
    }
  }

  async warmModelLaneFromCard(laneId: AtlasModelLaneId): Promise<void> {
    if (this.activeRecipe() || this.activeLaneWarm() || laneId === 'manifoldProjection') return;
    this.error.set(null);
    this.activeLaneWarm.set(laneId);
    try {
      await this.warmModelLane(laneId, this.selectedRecipe());
      this.notice.set(`${laneListLabel([laneId])} is warm.`);
    } catch (err) {
      this.error.set(this.toErrorMessage(err));
    } finally {
      this.activeLaneWarm.set(null);
    }
  }

  laneCardActionLabel(laneId: AtlasModelLaneId, status: string): string {
    if (this.activeLaneWarm() === laneId) return 'warming';
    if (laneId === 'manifoldProjection') return 'read-only';
    return status === 'ready' ? 'warm' : 'click to warm';
  }

  isLaneCardDisabled(laneId: AtlasModelLaneId): boolean {
    return laneId === 'manifoldProjection' || !!this.activeRecipe() || !!this.activeLaneWarm();
  }

  laneListLabel(lanes: AtlasModelLaneId[]): string {
    return laneListLabel(lanes);
  }

  isRecipeBusy(recipeId: AtlasRecipeId): boolean {
    return this.activeRecipe() === recipeId || (!!this.activeJob() && this.activeRecipe() === recipeId);
  }

  isRecipeDisabled(recipeId: AtlasRecipeId): boolean {
    if (recipeId === 'visualizeCurrentGraph') return false;
    const activeJob = this.activeJob();
    const blockingJob = activeJob && activeJob !== 'manifold-load' && activeJob !== 'graph-focus';
    return !!this.activeRecipe() || !!blockingJob || this.isDynamicScanning();
  }

  isWarmDisabled(): boolean {
    const activeJob = this.activeJob();
    const blockingJob = activeJob && activeJob !== 'manifold-load' && activeJob !== 'graph-focus';
    return !!this.activeRecipe() || !!blockingJob || !this.selectedRecipePlan().requiredLanes.length;
  }

  warmButtonLabel(): string {
    const required = this.selectedRecipePlan().requiredLanes;
    if (!required.length) return 'No Warm Needed';
    if (this.activeRecipeStep() === 'warm') return 'Warming';
    return this.requiredRecipeLanesReady() ? 'Warmed' : 'Warm Required';
  }

  warmButtonTone(): string {
    const required = this.selectedRecipePlan().requiredLanes;
    if (!required.length) return 'warm-neutral';
    if (this.activeRecipeStep() === 'warm') return 'warm-running';
    return this.requiredRecipeLanesReady() ? 'warm-ready' : 'warm-required';
  }

  laneStatusLabel(lane: RetrievalLane): string {
    switch (lane) {
      case 'lexical':
        return 'Ready';
      case 'semantic':
        if (this.vectorStatus() === 'loading') return 'Loading';
        if (this.vectorStatus() === 'indexing') return 'Indexing';
        if (this.vectorStatus() === 'error') return 'Error';
        if (this.embeddingsReady() || this.vectorStatus() === 'ready') return 'Loaded';
        return 'Unavailable';
      case 'graph':
        return this.hasCommittedGraph() ? 'Ready' : 'Unavailable';
      case 'entities':
        return this.registryEntities() > 0 ? 'Ready' : 'Unavailable';
      case 'evidence':
        return this.graphEdges() > 0 ? 'Ready' : 'Unavailable';
    }
  }

  laneSourceLabel(lane: RetrievalLane): string {
    switch (lane) {
      case 'lexical':
        return 'source: scope notes';
      case 'semantic':
        return 'source: semantic sidecar';
      case 'graph':
        return 'source: committed graph';
      case 'entities':
        return 'source: registry';
      case 'evidence':
        return 'source: claims + support paths';
    }
  }

  emptyStateTitle(): string {
    if (this.isSearching()) return 'Searching workspace';
    if (!this.query().trim()) {
      return 'Search across the active sources';
    }
    return 'No results found';
  }

  emptyStateMessage(): string {
    if (this.isSearching()) {
      return 'Running the selected retrieval path against the current scope.';
    }
    if (!this.query().trim()) {
      return 'Lexical search is always on. Semantic and graph sources join when they are loaded and indexed.';
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

  private async prepareRecipeModels(recipeId: AtlasRecipeId): Promise<void> {
    const plan = getAtlasModelRecipePlan(recipeId);
    for (const lane of plan.requiredLanes) {
      await this.warmModelLane(lane, recipeId);
    }
  }

  private requiredRecipeLanesReady(): boolean {
    const required = this.selectedRecipePlan().requiredLanes;
    if (!required.length) return false;
    const lanes = new Map(this.modelLaneViews().map((lane) => [lane.id, lane.status]));
    return required.every((lane) => lanes.get(lane) === 'ready');
  }

  private async warmModelLane(lane: AtlasModelLaneId, recipeId: AtlasRecipeId): Promise<void> {
    switch (lane) {
      case 'dynamicNer':
        await this.nerService.warmProvider('dynamic_ner');
        return;
      case 'coOccurrence':
        await this.nerService.warmProvider('fst');
        return;
      case 'semanticEmbedding':
        if (this.embeddingsReady() && this.vectorStatus() === 'ready') return;
        await this.machine.loadSemanticModel(
          this.selectedModel(),
          this.currentModelLabel(),
          this.activeEmbeddingDimensionLabel()
        );
        return;
      case 'nli':
        if (this.nli.isInitialized()) return;
        await this.nli.initialize(NLI_MODEL_ID);
        return;
      case 'manifoldProjection':
        return;
    }
  }

  private resetRecipeProgress(): void {
    this.activeRecipeStep.set(null);
    this.completedRecipeSteps.set([]);
    this.failedRecipeStep.set(null);
  }

  private beginRecipeStep(step: AtlasRecipeLifecycleId): void {
    this.activeRecipeStep.set(step);
    this.failedRecipeStep.set(null);
  }

  private completeRecipeStep(step: AtlasRecipeLifecycleId): void {
    this.completedRecipeSteps.update((steps) => Array.from(new Set([...steps, step])));
    if (this.activeRecipeStep() === step) {
      this.activeRecipeStep.set(null);
    }
  }

  private failRecipeStep(step: AtlasRecipeLifecycleId): void {
    this.failedRecipeStep.set(step);
    this.activeRecipeStep.set(null);
  }

  private async runAtlasSurfaceGraph(policy: 'dirty-only' | 'force'): Promise<void> {
    await this.atlasScan.runRichEmbeddingScan({
      source: 'search-panel',
      requireActiveNote: false,
      policy,
      includeSemanticAtlas: false,
    });
  }

  private async runSemanticAtlas(): Promise<void> {
    await this.atlasScan.runRichEmbeddingScan({
      source: 'search-panel',
      requireActiveNote: false,
      modelId: this.selectedModel(),
      modelLabel: this.currentModelLabel(),
      dimensionLabel: this.activeEmbeddingDimensionLabel(),
      policy: 'dirty-only',
      includeSemanticAtlas: true,
    });
  }

  private async warmFullIndexStack(): Promise<void> {
    this.notice.set(`${this.currentModelLabel()}, BI small Dynamic NER, and NLI are warm. No graph data was mutated.`);
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
