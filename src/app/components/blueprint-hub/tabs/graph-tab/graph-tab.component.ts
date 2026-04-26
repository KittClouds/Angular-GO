import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { smartGraphRegistry } from '../../../../lib/registry';
import type { RegisteredEntity } from '../../../../lib/registry';
import { entityColorStore } from '../../../../lib/store/entityColorStore';
import { GraphDetailComponent } from './graph-detail/graph-detail.component';
import { GraphStyleDrawerComponent } from './graph-style-drawer/graph-style-drawer.component';
import type { AtlasPreviewEdge } from './graph-atlas-preview/graph-atlas-preview.component';
import { GraphEntitySidebarComponent } from './graph-entity-sidebar.component';
import { GraphLensWorkspaceComponent } from './graph-lens-workspace.component';
import { EntityCreatorDialogComponent, EntityCreatorData } from './entity-creator-dialog/entity-creator-dialog.component';
import { ScopeService } from '../../../../lib/services/scope.service';
import { LlmEntityExtractorService } from '../../../../lib/services/llm-entity-extractor.service';
import { LlmBatchService, BATCH_GOOGLE_MODELS, BATCH_OPENROUTER_MODELS } from '../../../../lib/services/llm-batch.service';
import { NoteEditorStore } from '../../../../lib/store/note-editor.store';
import { parseContentToPlainText } from '../../../../lib/analytics';
import { NerService } from '../../../../services/ner.service';
import { FooterStatsService } from '../../../../services/footer-stats.service';
import { PhoenixProjectionService } from '../../../../services/phoenix-projection.service';
import { PhoenixMachineControlService } from '../../../../services/phoenix-machine-control.service';
import { EntitySelectionService } from '../../../../lib/services/entity-selection.service';
import type { EntitySuggestionProviderId, EntitySuggestionScanRequest } from '../../../../lib/entity-suggestions/entity-suggestion.types';

@Component({
    selector: 'app-graph-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        GraphDetailComponent,
        GraphStyleDrawerComponent,
        GraphEntitySidebarComponent,
        GraphLensWorkspaceComponent,
        EntityCreatorDialogComponent,
    ],
    templateUrl: './graph-tab.component.html',
    styleUrl: './graph-tab.component.css'
})
export class GraphTabComponent {
    private scopeService = inject(ScopeService);
    private llmExtractor = inject(LlmEntityExtractorService);
    private nerService = inject(NerService);
    private noteStore = inject(NoteEditorStore);
    private footerStatsService = inject(FooterStatsService);
    private projection = inject(PhoenixProjectionService);
    private machine = inject(PhoenixMachineControlService);
    private entitySelection = inject(EntitySelectionService);
    llmBatch = inject(LlmBatchService); // Public for template

    // Model lists for settings
    googleModels = BATCH_GOOGLE_MODELS;
    openRouterModels = BATCH_OPENROUTER_MODELS;

    // State — entities now derived from ScopeService signal
    entities = computed(() => this.scopeService.scopedEntities());
    selectedEntity = signal<RegisteredEntity | null>(null);
    graphLensMode = this.machine.graphLensMode;
    isCreatorOpen = signal(false);
    editingEntity = signal<EntityCreatorData | undefined>(undefined);
    isStyleDrawerOpen = signal(false);
    atlasSearch = signal('');

    // Scope state — driven by ScopeService
    scopeLabel = this.scopeService.scopeLabel;
    activeScope = this.scopeService.activeScope;

    // LLM Extraction state
    isExtracting = this.llmExtractor.isExtracting;
    extractionProgress = this.llmExtractor.extractionProgress;
    suggestions = this.nerService.suggestions;
    isScanningSuggestions = this.nerService.isAnalyzing;
    activeSuggestionProvider = this.nerService.activeProvider;
    suggestionError = this.nerService.errorMessage;
    lfmStatus = () => this.nerService.getProviderStatus('lfm_local_experiment');
    glinerStatus = () => this.nerService.getProviderStatus('gliner_local');

    // LLM Settings dialog state
    showLlmSettings = signal(false);
    llmSettingsProvider = signal<'google' | 'openrouter'>('openrouter');
    llmSettingsGoogleKey = signal('');
    llmSettingsGoogleModel = signal('gemini-2.0-flash');
    llmSettingsOrKey = signal('');
    llmSettingsOrModel = signal('google/gemini-2.0-flash-001');

    totalEntities = this.scopeService.scopedEntityCount;
    activeEntity = computed(() => {
        const local = this.selectedEntity();
        if (local) return local;
        const selectedId = this.entitySelection.selectedEntityId();
        return this.entities().find((entity) => entity.id === selectedId) ?? null;
    });
    selectedEntityConnectionCount = computed(() => {
        const entity = this.activeEntity();
        return entity ? this.projection.getEdgesForEntity(entity.id).length : 0;
    });
    atlasEdges = computed<AtlasPreviewEdge[]>(() => {
        const entityIds = new Set(this.entities().map((entity) => entity.id));
        const seen = new Set<string>();
        const edges: AtlasPreviewEdge[] = [];

        for (const entity of this.entities()) {
            for (const edge of this.projection.getEdgesForEntity(entity.id)) {
                if (!entityIds.has(edge.sourceId) || !entityIds.has(edge.targetId)) {
                    continue;
                }
                const id = edge.id || `${edge.sourceId}:${edge.type}:${edge.targetId}`;
                if (seen.has(id)) {
                    continue;
                }
                seen.add(id);
                edges.push({
                    id,
                    sourceId: edge.sourceId,
                    targetId: edge.targetId,
                    type: edge.type,
                    confidence: edge.confidence,
                });
            }
        }

        return edges;
    });
    styleTargetKind = computed(() => this.activeEntity()?.kind ?? 'CHARACTER');
    stewardContextId = computed(() => this.machineScope());

    // No manual registry subscription needed — entities are a computed signal

    selectEntity(entity: RegisteredEntity) {
        this.selectedEntity.set(entity);
        this.entitySelection.select(entity.id);
        this.machine.requestGraphFocus({
            query: entity.label,
            scope: this.machineScope(),
            title: entity.label,
        });
    }

    showAtlas() {
        this.selectedEntity.set(null);
    }

    toggleStyleDrawer() {
        this.isStyleDrawerOpen.update((open) => !open);
    }

    closeStyleDrawer() {
        this.isStyleDrawerOpen.set(false);
    }

    navigateToEntity(entity: RegisteredEntity) {
        this.selectedEntity.set(entity);
        this.entitySelection.select(entity.id);
        this.machine.requestGraphFocus({
            query: entity.label,
            scope: this.machineScope(),
            title: entity.label,
        });
    }

    openCreator() {
        this.editingEntity.set(undefined);
        this.isCreatorOpen.set(true);
    }

    editEntity(entity: RegisteredEntity, event?: Event) {
        event?.stopPropagation();
        this.editingEntity.set({
            id: entity.id,
            label: entity.label,
            kind: entity.kind,
            aliases: entity.aliases || [],
        });
        this.isCreatorOpen.set(true);
    }

    async deleteEntity(entity: RegisteredEntity, event: MouseEvent) {
        event.stopPropagation();
        await this.deleteEntityFromSidebar(entity);
    }

    async deleteEntityFromSidebar(entity: RegisteredEntity) {
        const deleted = await smartGraphRegistry.deleteEntity(entity.id);
        if (!deleted) return;
        // Entities auto-refresh via computed signal
        if (this.selectedEntity()?.id === entity.id) {
            this.selectedEntity.set(null);
        }
        if (this.entitySelection.selectedEntityId() === entity.id) {
            this.entitySelection.clear();
        }
    }

    async onSaveEntity(data: EntityCreatorData) {
        if (data.id) {
            const updated = await smartGraphRegistry.updateEntityDurable(data.id, {
                label: data.label,
                kind: data.kind as any,
                aliases: data.aliases,
            });
            if (updated && this.selectedEntity()?.id === updated.id) {
                this.selectedEntity.set(updated);
            }
            if (updated) {
                this.entitySelection.select(updated.id);
            }
        } else {
            const context = this.manualEntityContext();
            const result = await smartGraphRegistry.registerEntity(
                data.label,
                data.kind as any,
                context.noteId,
                {
                    source: 'user',
                    aliases: data.aliases,
                    attributes: context.narrativeId ? { narrativeId: context.narrativeId } : undefined,
                }
            );
            this.selectedEntity.set(result.entity);
            this.entitySelection.select(result.entity.id);
        }
    }

    async flushRegistry() {
        if (confirm(`Delete all ${this.totalEntities()} entities? This cannot be undone.`)) {
            const cleared = await smartGraphRegistry.clearAll();
            if (cleared === 0) return;
            this.selectedEntity.set(null);
            this.entitySelection.clear();
        }
    }

    async runSuggestionScan(providerId: EntitySuggestionProviderId) {
        const request = this.buildScanRequest();
        if (!request) {
            alert('Open a note with rendered text before scanning.');
            return;
        }
        await this.nerService.runManualScan(providerId, request);
    }

    async acceptSuggestion(id: string) {
        await this.nerService.acceptSuggestion(id);
    }

    async rejectSuggestion(id: string) {
        await this.nerService.rejectSuggestion(id);
    }

    getColor(kind: string): string {
        // Use entityColorStore for color parity across the app
        return entityColorStore.getEntityColor(kind);
    }

    // =========================================================================
    // LLM Settings
    // =========================================================================

    openLlmSettings() {
        // Load current config into form
        const cfg = this.llmBatch.getConfig();
        this.llmSettingsProvider.set(cfg.provider);
        this.llmSettingsGoogleKey.set(cfg.googleApiKey);
        this.llmSettingsGoogleModel.set(cfg.googleModel);
        this.llmSettingsOrKey.set(cfg.openRouterApiKey);
        this.llmSettingsOrModel.set(cfg.openRouterModel);
        this.showLlmSettings.set(true);
    }

    saveLlmSettings() {
        this.llmBatch.updateConfig({
            provider: this.llmSettingsProvider(),
            googleApiKey: this.llmSettingsGoogleKey(),
            googleModel: this.llmSettingsGoogleModel(),
            openRouterApiKey: this.llmSettingsOrKey(),
            openRouterModel: this.llmSettingsOrModel()
        });
        this.showLlmSettings.set(false);
    }

    private buildScanRequest(): EntitySuggestionScanRequest | null {
        const currentNote = this.noteStore.currentNote();
        if (!currentNote) return null;

        const plainText =
            this.footerStatsService.plainText() ||
            parseContentToPlainText(currentNote.content || currentNote.markdownContent || '');

        if (!plainText.trim()) return null;

        return {
            noteId: currentNote.id,
            noteTitle: currentNote.title || 'Untitled Note',
            plainText,
        };
    }

    private machineScope(): 'global' | string {
        const scope = this.activeScope();
        if (scope.type === 'global' || scope.scopeFolderId === 'vault:global') return 'global';
        return scope.scopeFolderId || scope.id || 'global';
    }

    private manualEntityContext(): { noteId: string; narrativeId?: string } {
        const currentNote = this.noteStore.currentNote();
        const scope = this.activeScope();
        return {
            noteId: currentNote?.id || scope.selectedNoteId || (scope.type === 'note' ? scope.id : 'manual'),
            narrativeId: currentNote?.narrativeId || scope.narrativeId || (scope.type === 'narrative' ? scope.id : undefined),
        };
    }

    // =========================================================================
    // LLM Entity Extraction
    // =========================================================================

    /**
     * Extract entities from all notes in current narrative using LLM
     */
    async extractAllFromNarrative() {
        const scope = this.activeScope();

        // Must be in a narrative or folder scope
        if (scope.id === 'vault:global') {
            alert('Please select a narrative or folder scope first.');
            return;
        }

        // Check if LLM is configured
        if (!this.llmExtractor.isConfigured()) {
            const configure = confirm(
                'LLM not configured for entity extraction.\n\n' +
                'This feature uses its OWN API settings (separate from AI Chat).\n\n' +
                'Click OK to configure now.'
            );
            if (configure) {
                this.openLlmSettings();
            }
            return;
        }

        const narrativeId = scope.narrativeId || scope.id;
        const info = this.llmExtractor.getProviderInfo();

        // Confirm action with provider info
        if (!confirm(
            `Extract entities from all notes in "${this.scopeLabel()}"?\n\n` +
            `Using: ${info.provider} / ${info.model}\n\n` +
            `(Click the gear icon to change LLM settings)`
        )) {
            return;
        }

        try {
            const result = await this.llmExtractor.extractFromNarrative(narrativeId);

            if (result.entities.length === 0) {
                alert(`No new entities found in ${result.notesProcessed} notes.`);
                return;
            }

            const proceed = confirm(
                `Found ${result.entities.length} entities in ${result.notesProcessed} notes.\n\n` +
                `Click OK to add them to the registry.\n` +
                `(Already registered entities will be skipped.)`
            );

            if (!proceed) return;

            const commitResult = await this.llmExtractor.commitToRegistry(result.entities);

            alert(
                `✅ Extraction complete!\n\n` +
                `• ${commitResult.created} new entities added\n` +
                `• ${commitResult.skipped} already registered (skipped)`
            );

            // Entities auto-refresh via computed signal

        } catch (err) {
            console.error('[GraphTab] Extraction failed:', err);
            alert(`Extraction failed: ${err}`);
        }
    }
}
