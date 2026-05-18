import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAlertCircle,
  lucideCheck,
  lucideChevronDown,
  lucideCpu,
  lucideFileText,
  lucideFolder,
  lucideGlobe,
  lucideLayers,
  lucideLoader2,
  lucideMicrochip,
  lucideMoreVertical,
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
import * as ops from '../../lib/operations';
import { type RetrievalLane } from '../../services/retrieval-workbench-state.service';
import { PhoenixMachineControlService } from '../../services/phoenix-machine-control.service';
import { NerService } from '../../services/ner.service';
import { AtlasScanCoordinatorService } from '../../services/atlas-scan-coordinator.service';
import { BlueprintHubService } from '../blueprint-hub/blueprint-hub.service';
import { NliWorkerService } from '../../lib/services/nli-worker.service';
import { AtlasCapabilityRuntimeService } from '../../services/atlas-capability-runtime.service';
import type {
  AtlasCapabilityRuntimeState,
  AtlasBuildScope,
  AtlasBuildReceipt,
  AtlasExpectedOutput,
  AtlasModelRequirement,
  AtlasRunOptions,
  AtlasServiceRequirement,
} from '../../services/atlas-capability-runtime.model';
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
  buildAtlasCommandStatus,
  estimateDynamicChunks,
  type AtlasRecipeId,
} from './atlas-command-status.model';
import {
  buildAtlasModelLaneViews,
  buildAtlasRecipeLifecycle,
  laneListLabel,
  type AtlasModelLaneId,
  type AtlasRecipeLifecycleId,
} from './atlas-model-recipe.model';
import {
  ATLAS_GRAPH_BUILD_RECIPE_IDS,
  ATLAS_CAPABILITY_LAYERS,
  ATLAS_CAPABILITY_REGISTRY,
  atlasCapabilityById,
  atlasRecipeDefinitionById,
  capabilityListLabel,
  type AtlasCapability,
  type AtlasCapabilityId,
} from './atlas-capability.model';

type BuilderCapabilityCard = {
  capability: AtlasCapability;
  state: AtlasCapabilityRuntimeState;
  layerLabel: string;
  chain: AtlasCapabilityId[];
};

type BuilderCapabilityGroup = {
  id: string;
  label: string;
  count: number;
  selectedCount: number;
  targets: BuilderCapabilityCard[];
};

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
  ],
  providers: [provideIcons({
    lucideAlertCircle,
    lucideCheck,
    lucideChevronDown,
    lucideCpu,
    lucideFileText,
    lucideFolder,
    lucideGlobe,
    lucideLayers,
    lucideLoader2,
    lucideMicrochip,
    lucideMoreVertical,
    lucideSearch,
    lucideSparkles,
    lucideZap,
  })],
  templateUrl: './search-panel.component.html',
  styleUrls: ['./search-panel.component.css', './search-panel.pipeline-map.css'],
})
export class SearchPanelComponent implements OnInit {
  @ViewChild('workbenchScroll') private workbenchScroll?: ElementRef<HTMLElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly notesService = inject(NotesService);
  private readonly noteStore = inject(NoteEditorStore);
  private readonly machine = inject(PhoenixMachineControlService);
  private readonly nerService = inject(NerService);
  private readonly atlasScan = inject(AtlasScanCoordinatorService);
  private readonly hubService = inject(BlueprintHubService);
  private readonly nli = inject(NliWorkerService);
  private readonly atlasRuntime = inject(AtlasCapabilityRuntimeService);

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
  readonly selectedRecipe = signal<AtlasRecipeId>('textGraph');
  readonly selectedCapabilityId = signal<AtlasCapabilityId>('assertedKernel');
  readonly selectedCapabilityIds = signal<AtlasCapabilityId[]>(capabilityIdsForRecipe('textGraph'));
  readonly activeRecipe = signal<AtlasRecipeId | null>(null);
  readonly activeLaneWarm = signal<AtlasModelLaneId | null>(null);
  readonly activeRecipeStep = signal<AtlasRecipeLifecycleId | null>(null);
  readonly completedRecipeSteps = signal<AtlasRecipeLifecycleId[]>([]);
  readonly failedRecipeStep = signal<AtlasRecipeLifecycleId | null>(null);
  readonly folders = signal<Array<{ id: string; name: string }>>([]);
  readonly notes = signal<SearchPanelNote[]>([]);
  readonly buildScopeMode = signal<AtlasBuildScope['mode']>('global');
  readonly selectedBuildFolderId = signal('');
  readonly selectedBuildNoteIds = signal<string[]>([]);
  readonly buildNoteQuery = signal('');
  readonly graphTargetQuery = signal('');
  readonly collapsedCapabilityGroups = signal<string[]>([]);
  readonly buildPolicy = signal<'dirty-only' | 'force'>('dirty-only');

  readonly laneOptions = RETRIEVAL_LANE_OPTIONS;
  readonly models = EMBEDDING_MODELS;
  readonly truncateDims = TRUNCATE_DIMS;
  readonly buildScopeModes: AtlasBuildScope['mode'][] = ['global', 'folder', 'note', 'multiNote'];
  readonly graphBuildRecipes = ATLAS_GRAPH_BUILD_RECIPE_IDS.map((id) => {
    const recipe = atlasRecipeDefinitionById(id);
    return {
      id: recipe.id,
      label: recipe.label,
      subtitle: recipe.subtitle,
      output: recipe.outputLabel,
      icon: recipe.icon,
    };
  });
  readonly backendGraphTargets = computed<BuilderCapabilityCard[]>(() => {
    const options = this.atlasRunOptions();
    return BUILDER_CAPABILITY_IDS.map((id) => {
      const capability = atlasCapabilityById(id);
      return {
        capability,
        state: this.atlasRuntime.capabilityState(id, options),
        layerLabel: layerLabelForCapability(id),
        chain: expandCapabilityChain(id),
      };
    });
  });
  readonly filteredBackendGraphTargets = computed(() => {
    const query = this.graphTargetQuery().trim().toLowerCase();
    const targets = this.backendGraphTargets();
    if (!query) return targets;
    return targets.filter((target) => {
      const haystack = [
        target.capability.label,
        target.capability.graphTargetLabel || '',
        target.layerLabel,
        target.capability.family,
        target.capability.backendRoute,
        target.state.runPolicy,
        target.state.operationKind,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  });
  readonly backendGraphTargetGroups = computed<BuilderCapabilityGroup[]>(() => {
    const targets = this.filteredBackendGraphTargets();
    const selected = new Set(this.selectedCapabilityIds());
    return ATLAS_CAPABILITY_LAYERS
      .map((layer) => {
        const layerTargets = targets.filter((target) => layer.capabilityIds.includes(target.capability.id));
        return {
          id: layer.id,
          label: layer.label,
          count: layerTargets.length,
          selectedCount: layerTargets.filter((target) => selected.has(target.capability.id)).length,
          targets: layerTargets,
        };
      })
      .filter((group) => group.count > 0);
  });
  readonly atlasPhase = this.atlasScan.phase;
  readonly atlasMessage = this.atlasScan.message;
  readonly lastAtlasResult = this.atlasScan.lastResult;

  readonly selectedBuildScope = computed<AtlasBuildScope>(() => {
    const mode = this.buildScopeMode();
    if (mode === 'global') return { mode: 'global' };
    if (mode === 'folder') {
      const folderId = this.selectedBuildFolderId()
        || (this.indexScope() !== 'global' ? this.indexScope() : '')
        || this.folders()[0]?.id
        || '';
      return folderId ? { mode: 'folder', folderId } : { mode: 'global' };
    }
    if (mode === 'note') {
      const noteId = this.noteStore.currentNote()?.id || this.selectedBuildNoteIds()[0] || this.notes()[0]?.id || '';
      return noteId ? { mode: 'note', noteId } : { mode: 'global' };
    }
    return { mode: 'multiNote', noteIds: this.selectedBuildNoteIds() };
  });
  readonly buildNoteIds = computed(() => noteIdsFromBuildScope(this.selectedBuildScope()));
  readonly scopedNotes = computed(() => {
    const scope = this.selectedBuildScope();
    const notes = this.notes();
    if (scope.mode === 'global') return notes;
    if (scope.mode === 'folder') return notes.filter((note) => note.folderId === scope.folderId);
    const ids = new Set(noteIdsFromBuildScope(scope));
    return notes.filter((note) => ids.has(note.id));
  });
  readonly buildScopeLabel = computed(() => {
    const scope = this.selectedBuildScope();
    if (scope.mode === 'global') return 'Global';
    if (scope.mode === 'folder') return this.folders().find((folder) => folder.id === scope.folderId)?.name || 'Folder';
    if (scope.mode === 'note') return this.notes().find((note) => note.id === scope.noteId)?.title || 'Active Note';
    return `${scope.noteIds.length} notes`;
  });
  readonly filteredBuildNotes = computed(() => {
    const query = this.buildNoteQuery().trim().toLowerCase();
    const notes = this.notes();
    if (!query) return notes.slice(0, 24);
    return notes.filter((note) => note.title.toLowerCase().includes(query)).slice(0, 24);
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
  readonly embeddingsReady = computed(() => this.vectorStatus() === 'ready');
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
    this.embeddingsReady() ? 'Native Rust semantic runner ready' : 'Native Rust semantic runner idle'
  );
  readonly scopeLabel = computed(() => {
    const scope = this.selectedBuildScope();
    if (scope.mode === 'global') return 'Global (all notes)';
    if (scope.mode === 'folder') return this.folders().find((folder) => folder.id === scope.folderId)?.name || scope.folderId;
    if (scope.mode === 'note') return this.notes().find((note) => note.id === scope.noteId)?.title || 'Active note';
    return `${scope.noteIds.length} selected notes`;
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
  readonly capabilityLayers = computed(() => this.commandStatus().capabilityLayers);
  readonly sleepingCapabilities = computed(() => this.commandStatus().sleepingCapabilities);
  readonly sidecarMetrics = computed(() => this.commandStatus().sidecars);
  readonly chunkingStatus = computed(() => this.commandStatus().chunking);
  readonly lastRunStatus = computed(() => {
    const receipt = this.atlasRuntime.lastBuildReceipt();
    if (receipt) {
      return {
        label: receipt.label,
        detail: buildReceiptDetail(receipt),
        durationMs: receipt.durationMs,
      };
    }
    return this.commandStatus().lastRun;
  });
  readonly selectedRecipePlan = computed(() => this.atlasRuntime.recipeState(this.selectedRecipe(), this.atlasRunOptions()));
  readonly selectedCapability = computed(() => atlasCapabilityById(this.selectedCapabilityId()));
  readonly selectedCapabilityState = computed(() =>
    this.atlasRuntime.capabilityState(this.selectedCapabilityId(), this.atlasRunOptions())
  );
  readonly selectedCapabilityChain = computed(() =>
    this.selectedCapabilityIds().map((id) => ({
      capability: atlasCapabilityById(id),
      state: this.atlasRuntime.capabilityState(id, this.atlasRunOptions()),
    }))
  );
  readonly selectedPipelineRail = computed(() => this.buildSelectedPipelineRail());
  readonly runtimeCapabilities = computed(() =>
    ATLAS_CAPABILITY_REGISTRY.map((capability) => this.atlasRuntime.capabilityState(capability.id, this.atlasRunOptions()))
  );
  readonly blockedRuntimeCapabilities = computed(() =>
    this.runtimeCapabilities().filter((capability) => !capability.runnable || capability.blockedReason)
  );
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

  setBuildScopeMode(mode: AtlasBuildScope['mode']): void {
    this.buildScopeMode.set(mode);
    if (mode === 'global') {
      this.machine.setScope('global');
      void this.machine.refreshAuditSafe();
      return;
    }
    if (mode === 'folder') {
      const folderId = this.selectedBuildFolderId() || this.folders()[0]?.id || '';
      if (folderId) {
        this.selectedBuildFolderId.set(folderId);
        this.machine.setScope(folderId);
        void this.machine.refreshAuditSafe();
      }
      return;
    }
    if (mode === 'note') {
      const noteId = this.noteStore.currentNote()?.id || this.notes()[0]?.id || '';
      if (noteId) this.selectedBuildNoteIds.set([noteId]);
      return;
    }
    if (!this.selectedBuildNoteIds().length) {
      const noteId = this.noteStore.currentNote()?.id || this.notes()[0]?.id || '';
      if (noteId) this.selectedBuildNoteIds.set([noteId]);
    }
  }

  onBuildFolderChange(folderId: string): void {
    this.selectedBuildFolderId.set(folderId);
    this.buildScopeMode.set('folder');
    this.machine.setScope(folderId || 'global');
    void this.machine.refreshAuditSafe();
  }

  toggleBuildNote(noteId: string): void {
    if (!noteId) return;
    if (this.buildScopeMode() === 'note') {
      this.selectedBuildNoteIds.set([noteId]);
      return;
    }
    this.buildScopeMode.set('multiNote');
    this.selectedBuildNoteIds.update((ids) =>
      ids.includes(noteId) ? ids.filter((id) => id !== noteId) : [...ids, noteId],
    );
  }

  isBuildNoteSelected(noteId: string): boolean {
    return this.buildNoteIds().includes(noteId);
  }

  setBuildPolicy(policy: 'dirty-only' | 'force'): void {
    this.buildPolicy.set(policy);
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
    this.applyRecipeSelection(recipeId);
    this.activeRecipe.set(recipeId);
    this.error.set(null);
    try {
      const options = this.atlasRunOptions();
      const plan = this.atlasRuntime.recipePlan(recipeId, options);
      this.beginRecipeStep('scope');
      this.completeRecipeStep('scope');
      this.beginRecipeStep('warm');
      await this.atlasRuntime.warmRequiredModels(plan, options);
      this.completeRecipeStep('warm');
      this.beginRecipeStep('run');
      await this.atlasRuntime.runRecipe(recipeId, { ...options, skipModelWarm: true });
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

  openGraphLens(): void {
    const scope = this.selectedBuildScope();
    const noteIds = noteIdsFromBuildScope(scope);
    this.machine.requestGraphFocus({
      query: this.query().trim(),
      scope: scope.mode === 'folder' ? scope.folderId : 'global',
      noteId: noteIds[0],
      title: noteIds.length > 1 ? `${noteIds.length} selected notes` : this.buildScopeLabel(),
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

  modelRequirementLabel(models: AtlasModelRequirement[]): string {
    return this.atlasRuntime.modelRequirementLabel(models);
  }

  serviceRequirementLabel(services: AtlasServiceRequirement[]): string {
    return this.atlasRuntime.serviceRequirementLabel(services);
  }

  expectedOutputLabel(outputs: AtlasExpectedOutput[]): string {
    return this.atlasRuntime.expectedOutputLabel(outputs);
  }

  capabilityRuntimeLabel(state: AtlasCapabilityRuntimeState): string {
    return ATLAS_CAPABILITY_REGISTRY.find((capability) => capability.id === state.capabilityId)?.label || state.capabilityId;
  }

  trackCapabilityGroup(_index: number, group: BuilderCapabilityGroup): string {
    return group.id;
  }

  trackCapabilityTarget(_index: number, target: BuilderCapabilityCard): AtlasCapabilityId {
    return target.capability.id;
  }

  selectCapability(capabilityId: AtlasCapabilityId): void {
    if (this.activeRecipe()) return;
    this.preserveWorkbenchScroll(() => {
      const recipeId = recipeForCapability(capabilityId);
      this.selectedCapabilityId.set(capabilityId);
      this.selectedRecipe.set(recipeId);
      this.selectedCapabilityIds.set(capabilityIdsForRecipe(recipeId, capabilityId));
      this.resetRecipeProgress();
    });
  }

  isCapabilitySelected(capabilityId: AtlasCapabilityId): boolean {
    return this.selectedCapabilityIds().includes(capabilityId);
  }

  toggleCapabilityGroup(groupId: string): void {
    this.preserveWorkbenchScroll(() => {
      this.collapsedCapabilityGroups.update((ids) =>
        ids.includes(groupId) ? ids.filter((id) => id !== groupId) : [...ids, groupId],
      );
    });
  }

  isCapabilityGroupCollapsed(groupId: string): boolean {
    return this.collapsedCapabilityGroups().includes(groupId);
  }

  selectRecipe(recipeId: AtlasRecipeId): void {
    if (this.activeRecipe()) return;
    this.preserveWorkbenchScroll(() => {
      this.applyRecipeSelection(recipeId);
    });
  }

  private applyRecipeSelection(recipeId: AtlasRecipeId): void {
    this.selectedRecipe.set(recipeId);
    this.selectedCapabilityId.set(capabilityForRecipe(recipeId));
    this.selectedCapabilityIds.set(capabilityIdsForRecipe(recipeId));
    this.resetRecipeProgress();
  }

  private preserveWorkbenchScroll(update: () => void): void {
    const scrollContainer = this.workbenchScroll?.nativeElement;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    update();
    if (!scrollContainer) return;

    const restore = () => {
      scrollContainer.scrollTop = scrollTop;
    };
    queueMicrotask(restore);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(restore);
    }
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
      this.notice.set(`${this.selectedRecipePlan().label} required runtime models are warm. No graph data was mutated.`);
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
      await this.atlasRuntime.warmModelLane(laneId, this.atlasRunOptions());
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

  capabilityListLabel(capabilities: AtlasCapabilityId[]): string {
    return capabilityListLabel(capabilities);
  }

  buildScopeModeLabel(mode: AtlasBuildScope['mode']): string {
    switch (mode) {
      case 'global':
        return 'Global';
      case 'folder':
        return 'Folder';
      case 'note':
        return 'Active Note';
      case 'multiNote':
        return 'Multi-note';
    }
  }

  isRecipeBusy(recipeId: AtlasRecipeId): boolean {
    return this.activeRecipe() === recipeId || (!!this.activeJob() && this.activeRecipe() === recipeId);
  }

  capabilityStatusClass(state: AtlasCapabilityRuntimeState): string {
    return `capability-${state.status}`;
  }

  capabilityIconName(capability: AtlasCapability): string {
    switch (capability.family) {
      case 'surface':
        return 'lucideFileText';
      case 'entity':
        return 'lucideCpu';
      case 'graph':
      case 'manifold':
      case 'visualization':
        return 'lucideLayers';
      case 'semantic':
        return 'lucideMicrochip';
      case 'reasoning':
        return 'lucideSparkles';
      case 'retrieval':
        return 'lucideSearch';
    }
  }

  compactPolicyLabel(policy: string): string {
    switch (policy) {
      case 'dirty-only':
        return 'Dirty';
      case 'read-only':
        return 'RO';
      case 'warm-only':
        return 'Warm';
      case 'native-only':
        return 'Native';
      default:
        return policy;
    }
  }

  compactOperationLabel(kind: string): string {
    return kind
      .replace('richTextGraphScan', 'Rich')
      .replace('semanticAtlasScan', 'Semantic')
      .replace('dynamicNerScan', 'Dynamic')
      .replace('nativeStoreProbe', 'Native')
      .replace('nliAdjudication', 'NLI')
      .replace('manifoldSnapshot', 'Manifold')
      .replace('graphVisualization', 'Graph View')
      .replace('retrievalWalk', 'Retrieve')
      .replace('modelWarm', 'Model');
  }

  isRecipeDisabled(recipeId: AtlasRecipeId): boolean {
    const activeJob = this.activeJob();
    const blockingJob = activeJob && activeJob !== 'manifold-load' && activeJob !== 'graph-focus';
    return !!this.activeRecipe() || !!blockingJob || this.isDynamicScanning() || !this.hasRunnableBuildScope();
  }

  isWarmDisabled(): boolean {
    const activeJob = this.activeJob();
    const blockingJob = activeJob && activeJob !== 'manifold-load' && activeJob !== 'graph-focus';
    return !!this.activeRecipe() || !!blockingJob || !this.selectedRecipePlan().requiredModels.length;
  }

  selectedCapabilityModelSummary(): string {
    const models = this.selectedRecipePlan().requiredModels;
    const chain = this.selectedCapabilityChain().map((item) => item.capability.id);
    const labels = models.map((model) => model.dims ? `${model.label} ${model.dims}` : model.label);
    if (chain.includes('dynamicNer')) {
      labels.unshift('Native GLiNER BI-small auto-load');
    }
    if (!labels.length) return 'none';
    return Array.from(new Set(labels)).join(' / ');
  }

  warmButtonLabel(): string {
    const required = this.selectedRecipePlan().requiredModels;
    if (!required.length) return 'No Warm Needed';
    if (this.activeRecipeStep() === 'warm') return 'Warming';
    if (this.requiredRecipeModelsReady()) return 'Warmed';
    const ids = required.map((model) => model.id);
    if (ids.includes('semanticEmbedding') && ids.includes('nli')) return 'Warm Embedding + NLI';
    if (ids.includes('semanticEmbedding')) return 'Warm Embedding';
    if (ids.includes('dynamicNer')) return 'Warm Dynamic NER';
    return 'Warm Required';
  }

  warmButtonTone(): string {
    const required = this.selectedRecipePlan().requiredModels;
    if (!required.length) return 'warm-neutral';
    if (this.activeRecipeStep() === 'warm') return 'warm-running';
    return this.requiredRecipeModelsReady() ? 'warm-ready' : 'warm-required';
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

  private async prepareRecipeModels(recipeId: AtlasRecipeId): Promise<void> {
    const options = this.atlasRunOptions();
    await this.atlasRuntime.warmRequiredModels(
      this.atlasRuntime.recipePlan(recipeId, options),
      options,
    );
  }

  private requiredRecipeModelsReady(): boolean {
    const required = this.selectedRecipePlan().requiredModels;
    if (!required.length) return false;
    return required.every((model) => model.readiness === 'ready');
  }

  private hasRunnableBuildScope(): boolean {
    const scope = this.selectedBuildScope();
    if (scope.mode === 'note') return !!scope.noteId;
    if (scope.mode === 'multiNote') return scope.noteIds.length > 0;
    if (scope.mode === 'folder') return !!scope.folderId;
    return true;
  }

  private buildSelectedPipelineRail(): Array<{ id: string; label: string; status: string }> {
    const rail: Array<{ id: string; label: string; status: string }> = [
      { id: 'scope', label: this.buildScopeLabel(), status: this.hasRunnableBuildScope() ? 'ready' : 'idle' },
    ];
    for (const item of this.selectedCapabilityChain()) {
      rail.push({
        id: item.capability.id,
        label: item.capability.label,
        status: item.state.status,
      });
    }
    return rail;
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

  private atlasRunOptions(): AtlasRunOptions {
    return {
      selectedModel: this.selectedModel(),
      selectedModelLabel: this.currentModelLabel(),
      dimensionLabel: this.activeEmbeddingDimensionLabel(),
      scope: this.indexScope(),
      buildScope: this.selectedBuildScope(),
      buildPolicy: this.buildPolicy(),
      noteIds: this.buildDocumentIdsForRun(),
      query: this.query().trim(),
    };
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

  private buildDocumentIdsForRun(): string[] {
    const scope = this.selectedBuildScope();
    if (scope.mode === 'global') return [];
    if (scope.mode === 'folder') return this.scopedNotes().map((note) => note.id);
    return noteIdsFromBuildScope(scope);
  }

  private async hydrateUiState(): Promise<void> {
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

function noteIdsFromBuildScope(scope: AtlasBuildScope): string[] {
  if (scope.mode === 'note') return scope.noteId ? [scope.noteId] : [];
  if (scope.mode === 'multiNote') return scope.noteIds.filter(Boolean);
  return [];
}

const BUILDER_CAPABILITY_IDS: AtlasCapabilityId[] = [
  'dynamicSurface',
  'dynamicChunking',
  'dynamicNer',
  'mentionGraph',
  'evidenceGraph',
  'surfaceGraph',
  'assertedKernel',
  'relationGraph',
  'temporalGraph',
  'eventIdentity',
  'memoryState',
  'causalGraph',
  'semanticEmbedding',
  'semanticAtlas',
  'semanticCandidate',
  'nliAdjudication',
  'hybridManifold',
  'hopfProjection',
  'lorentzForest',
  'retrievalWalk',
  'galaxyVisualization',
];

function expandCapabilityChain(id: AtlasCapabilityId, seen = new Set<AtlasCapabilityId>()): AtlasCapabilityId[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const capability = atlasCapabilityById(id);
  const chain = capability.dependencies.flatMap((dependency) => expandCapabilityChain(dependency, seen));
  return [...chain, id].filter((capabilityId, index, values) => values.indexOf(capabilityId) === index);
}

function capabilityIdsForRecipe(recipeId: AtlasRecipeId, focusCapabilityId?: AtlasCapabilityId): AtlasCapabilityId[] {
  const recipe = atlasRecipeDefinitionById(recipeId);
  const skipped = new Set(recipe.skippedCapabilities);
  const requiredChain = recipe.requiredCapabilities.flatMap((id) => expandCapabilityChain(id));
  const focusChain = focusCapabilityId ? expandCapabilityChain(focusCapabilityId) : [];
  const selected = new Set(requiredChain.filter((id) => !skipped.has(id)));
  for (const id of focusChain) {
    if (!skipped.has(id)) selected.add(id);
  }
  return BUILDER_CAPABILITY_IDS.filter((id) => selected.has(id));
}

function layerLabelForCapability(id: AtlasCapabilityId): string {
  return ATLAS_CAPABILITY_LAYERS.find((layer) => layer.capabilityIds.includes(id))?.label || atlasCapabilityById(id).family;
}

function recipeForCapability(id: AtlasCapabilityId): AtlasRecipeId {
  if (id === 'relationGraph' || id === 'temporalGraph' || id === 'eventIdentity' || id === 'memoryState' || id === 'causalGraph') {
    return 'reasoningGraph';
  }
  if (id === 'nliAdjudication') return 'adjudicatedSemanticGraph';
  if (id === 'semanticEmbedding' || id === 'semanticAtlas' || id === 'semanticCandidate') return 'semanticGraph';
  if (id === 'hybridManifold' || id === 'hopfProjection' || id === 'lorentzForest') return 'semanticGraph';
  return 'textGraph';
}

function capabilityForRecipe(id: AtlasRecipeId): AtlasCapabilityId {
  switch (id) {
    case 'semanticGraph':
      return 'semanticAtlas';
    case 'adjudicatedSemanticGraph':
      return 'nliAdjudication';
    case 'reasoningGraph':
      return 'relationGraph';
    case 'runNer':
      return 'dynamicNer';
    case 'textGraph':
      return 'assertedKernel';
  }
}

function buildReceiptDetail(receipt: AtlasBuildReceipt): string {
  const ranStages = receipt.stageReceipts.filter((stage) => stage.ran);
  const countText = `${ranStages.length} stage${ranStages.length === 1 ? '' : 's'} ran`;
  const proof = ranStages
    .map((stage) => stage.summary)
    .filter(Boolean)
    .slice(0, 2)
    .join(' / ');
  return proof ? `${receipt.policy}; ${countText}; ${proof}` : `${receipt.policy}; ${countText}`;
}
