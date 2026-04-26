import { Component, OnDestroy, OnInit, ViewChild, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ArrowLeft, LucideAngularModule, Maximize2, RefreshCw, RotateCcw, Settings } from 'lucide-angular';

import { NoteEditorStore } from '../../lib/store/note-editor.store';
import { entityColorStore } from '../../lib/store/entityColorStore';
import { type ForceGraphData, type GraphLink, type GraphNode, type GraphStats } from '../../services/graph-viz.service';
import { GraphPipelineService } from '../../services/graph-pipeline.service';
import { PhoenixGraphOrchestratorService } from '../../services/phoenix-graph-orchestrator.service';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { RetrievalWorkbenchStateService } from '../../services/retrieval-workbench-state.service';
import { GraphGalaxyCanvasComponent } from '../../components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-canvas.component';
import {
    DEFAULT_GALAXY_SETTINGS,
    type GalaxyEdgeColorMode,
    type GalaxyEdgeMode,
    type GalaxyInputEdge,
    type GalaxyLabelMode,
    type GalaxyNodeDragMode,
    type GalaxyRenderableNode,
    type GalaxyRenderSettings,
} from '../../components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-galaxy-engine';
import {
    EMPTY_GRAPH_STATS,
    GRAPH_LENS_OPTIONS,
    GRAPH_SCOPE_OPTIONS,
    applyGraphLens,
    cloneGraphData,
    endpointId,
    filterGraphData,
    graphRecordRows,
    type GraphBuildStatus,
    type GraphWarmStatus,
    type GraphWarmStrategy,
    type GraphWorkbenchLens,
    type GraphWorkbenchScope,
} from './graph-workbench.model';

@Component({
    selector: 'app-graph-page',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, GraphGalaxyCanvasComponent],
    templateUrl: './graph-page.component.html',
    styleUrls: ['./graph-page.component.css'],
})
export class GraphPageComponent implements OnInit, OnDestroy {
    @ViewChild('galaxyCanvas') private galaxyCanvas?: GraphGalaxyCanvasComponent;

    private readonly router = inject(Router);
    private readonly noteStore = inject(NoteEditorStore);
    private readonly graphPipeline = inject(GraphPipelineService);
    private readonly graphOrchestrator = inject(PhoenixGraphOrchestratorService);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly workbench = inject(RetrievalWorkbenchStateService);

    readonly ArrowLeft = ArrowLeft;
    readonly RefreshCw = RefreshCw;
    readonly Settings = Settings;
    readonly Maximize2 = Maximize2;
    readonly RotateCw = RotateCcw;

    readonly scopeOptions = GRAPH_SCOPE_OPTIONS;
    readonly lensOptions = GRAPH_LENS_OPTIONS;
    readonly loading = signal(true);
    readonly showSettings = signal(false);
    readonly stats = signal<GraphStats>({ ...EMPTY_GRAPH_STATS });
    readonly selectedNode = signal<GraphNode | null>(null);
    readonly selectedLink = signal<GraphLink | null>(null);
    readonly selectedGalaxyId = signal<string | null>(null);
    readonly hoveredGalaxyNode = signal<GalaxyRenderableNode | null>(null);
    readonly graphScope = signal<GraphWorkbenchScope>('active-note');
    readonly graphLens = signal<GraphWorkbenchLens>('entities');
    readonly graphSearch = signal('');
    readonly warmStrategy = signal<GraphWarmStrategy>('raw');
    readonly warmStatus = signal<GraphWarmStatus>('cold');
    readonly buildStatus = signal<GraphBuildStatus>('idle');
    readonly warmMessage = signal('Native runtime stays lazy until you warm the scan path.');
    readonly buildMessage = signal('Choose a scope and lens, then build the active atlas.');
    readonly galaxyNodes = signal<GalaxyRenderableNode[]>([]);
    readonly galaxyEdges = signal<GalaxyInputEdge[]>([]);

    settings: GalaxyRenderSettings = {
        ...DEFAULT_GALAXY_SETTINGS,
        labelMode: 'hover',
        edgeMode: 'curved',
        edgeColorMode: 'entityBlend',
        glow: 1.08,
        edgeOpacity: 0.62,
        edgeWidth: 0.46,
        edgeLength: 1.45,
        edgeCurveStrength: 1.85,
        nodeDistance: 1.28,
        particleFlow: true,
        particleSize: 0.9,
        particleSpeed: 1.2,
        particleOpacity: 0.58,
        autoRotate: true,
        labelLimit: 18,
    };

    private sourceGraphData: ForceGraphData = { nodes: [], links: [], stats: { ...EMPTY_GRAPH_STATS } };
    private graphData: ForceGraphData = { nodes: [], links: [], stats: { ...EMPTY_GRAPH_STATS } };
    private warmPromise: Promise<void> | null = null;
    private destroyed = false;
    private readonly graphFocusEffect = effect(() => {
        const focus = this.workbench.graphFocus();
        if (!focus) return;
        this.graphSearch.set(focus.query || focus.title || '');
        this.graphScope.set(focus.scope === 'global' ? 'whole-vault' : 'current-folder');
        this.buildMessage.set(focus.title ? `Workbench focus loaded: ${focus.title}.` : 'Workbench query loaded into graph lens.');
        this.applyLensAndRender(false);
    });

    ngOnInit(): void {
        void this.bootstrapGraph();
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.sourceGraphData = { nodes: [], links: [], stats: { ...EMPTY_GRAPH_STATS } };
        this.graphData = { nodes: [], links: [], stats: { ...EMPTY_GRAPH_STATS } };
        this.galaxyNodes.set([]);
        this.galaxyEdges.set([]);
        this.selectedNode.set(null);
        this.selectedLink.set(null);
        this.selectedGalaxyId.set(null);
    }

    navigateToEditor(): void { this.router.navigate(['/']); }
    toggleSettings(): void { this.showSettings.update((value) => !value); }

    setGraphScope(value: GraphWorkbenchScope): void {
        this.graphScope.set(value);
        this.buildMessage.set(this.scopeDescription());
    }

    setGraphLens(value: GraphWorkbenchLens): void {
        this.graphLens.set(value);
        this.applyLensAndRender(true);
    }

    setWarmStrategy(value: GraphWarmStrategy): void { this.warmStrategy.set(value); }
    setGraphSearch(value: string): void { this.graphSearch.set(value); this.applyLensAndRender(false); }

    async warmGraphModels(): Promise<void> {
        try {
            await this.ensureWarmModels();
        } catch {
            // Status/message signals already hold the UI-facing failure.
        }
    }

    async buildGraph(): Promise<void> {
        this.loading.set(true);
        this.buildStatus.set('building');
        this.buildMessage.set('Building the selected atlas lens...');
        try {
            if (this.warmStrategy() === 'warm-first' && this.warmStatus() !== 'warm') {
                await this.ensureWarmModels();
            }

            const result = await this.runSelectedScopeIndex();
            if (result.graph?.graphData) {
                this.sourceGraphData = cloneGraphData(result.graph.graphData);
                this.applyLensAndRender(true);
            } else {
                await this.loadGraphData(true);
            }
            this.buildStatus.set('ready');
            this.buildMessage.set(`${result.processedNotes} notes processed, ${result.skippedNotes} skipped.`);
        } catch (error) {
            console.error('[GraphPage] Build failed:', error);
            this.buildStatus.set('failed');
            this.buildMessage.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.loading.set(false);
            this.deferFit();
        }
    }

    async refreshGraph(): Promise<void> {
        this.loading.set(true);
        try {
            await this.loadGraphData(true);
        } catch (error) {
            console.error('[GraphPage] Refresh failed:', error);
            this.buildStatus.set('failed');
            this.buildMessage.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.loading.set(false);
            this.deferFit();
        }
    }

    fitToCanvas(): void { this.galaxyCanvas?.fitToGraph(); }
    resetCamera(): void { this.galaxyCanvas?.resetCamera(); }

    cycleLabelMode(): void {
        const modes: GalaxyLabelMode[] = ['hover', 'selected', 'important', 'always', 'off'];
        this.patchSettings({ labelMode: modes[(modes.indexOf(this.settings.labelMode) + 1) % modes.length] });
    }

    cycleEdgeMode(): void {
        const modes: GalaxyEdgeMode[] = ['curved', 'straight', 'hidden'];
        this.patchSettings({ edgeMode: modes[(modes.indexOf(this.settings.edgeMode) + 1) % modes.length] });
    }

    cycleEdgeColorMode(): void {
        const modes: GalaxyEdgeColorMode[] = ['entityBlend', 'cyan', 'confidence', 'muted'];
        this.patchSettings({ edgeColorMode: modes[(modes.indexOf(this.settings.edgeColorMode) + 1) % modes.length] });
    }

    toggleParticles(): void { this.patchSettings({ particleFlow: !this.settings.particleFlow }); }
    toggleAutoRotate(): void { this.patchSettings({ autoRotate: !this.settings.autoRotate }); }

    cycleNodeDragMode(): void {
        const modes: GalaxyNodeDragMode[] = ['stretch', 'force', 'camera'];
        this.patchSettings({ nodeDragMode: modes[(modes.indexOf(this.settings.nodeDragMode) + 1) % modes.length] });
    }

    toggleSelectedPulse(): void { this.patchSettings({ selectedPulse: !this.settings.selectedPulse }); }
    setGlow(value: string): void { this.patchSettings({ glow: Number(value) }); }
    setNodeDistance(value: string): void { this.patchSettings({ nodeDistance: Number(value) }); }
    setEdgeLength(value: string): void { this.patchSettings({ edgeLength: Number(value) }); }
    setEdgeWidth(value: string): void { this.patchSettings({ edgeWidth: Number(value) }); }
    setEdgeOpacity(value: string): void { this.patchSettings({ edgeOpacity: Number(value) }); }
    setCurveStrength(value: string): void { this.patchSettings({ edgeCurveStrength: Number(value) }); }
    setParticleSize(value: string): void { this.patchSettings({ particleSize: Number(value) }); }
    setParticleSpeed(value: string): void { this.patchSettings({ particleSpeed: Number(value) }); }
    setParticleOpacity(value: string): void { this.patchSettings({ particleOpacity: Number(value) }); }

    kindStats(): { name: string; count: number }[] { return sortedCounts(this.stats().kindCounts); }
    typeStats(): { name: string; count: number }[] { return sortedCounts(this.stats().typeCounts); }

    selectedNodeRows(): Array<{ key: string; value: string }> {
        const node = this.selectedNode();
        return node ? graphRecordRows(node as unknown as Record<string, unknown>) : [];
    }

    selectedLinkRows(): Array<{ key: string; value: string }> {
        const link = this.selectedLink();
        return link ? graphRecordRows(link as unknown as Record<string, unknown>) : [];
    }

    connectedLinks(): GraphLink[] {
        const node = this.selectedNode();
        if (!node) return [];
        return this.graphData.links
            .filter((link) => endpointId(link.source) === node.id || endpointId(link.target) === node.id)
            .slice(0, 12);
    }

    linkTitle(link: GraphLink): string {
        return `${this.nodeLabel(endpointId(link.source))} -> ${this.nodeLabel(endpointId(link.target))}`;
    }

    scopeDescription(): string { return this.scopeOptions.find((option) => option.id === this.graphScope())?.description || ''; }
    lensDescription(): string { return this.lensOptions.find((option) => option.id === this.graphLens())?.description || ''; }
    activeScopeLabel(): string { return this.scopeOptions.find((option) => option.id === this.graphScope())?.label || 'Scope'; }
    activeLensLabel(): string { return this.lensOptions.find((option) => option.id === this.graphLens())?.label || 'Lens'; }

    clearSelection(): void {
        this.selectedNode.set(null);
        this.selectedLink.set(null);
        this.selectedGalaxyId.set(null);
    }

    selectLink(link: GraphLink): void {
        this.selectedLink.set(link);
        this.selectedNode.set(null);
        this.selectedGalaxyId.set(null);
    }

    onGalaxyNodeSelected(node: GalaxyRenderableNode): void {
        this.selectedGalaxyId.set(node.id);
        this.selectedNode.set(this.graphData.nodes.find((candidate) => candidate.id === node.id) || null);
        this.selectedLink.set(null);
    }

    onGalaxyNodeHovered(node: GalaxyRenderableNode | null): void {
        this.hoveredGalaxyNode.set(node);
    }

    trackByName(_index: number, row: { name: string }): string {
        return row.name;
    }

    trackByKey(_index: number, row: { key: string }): string {
        return row.key;
    }

    trackByLink(index: number, link: GraphLink): string {
        return `${endpointId(link.source)}:${endpointId(link.target)}:${link.type || ''}:${index}`;
    }

    private async bootstrapGraph(): Promise<void> {
        try {
            await this.loadGraphData(true);
            this.buildStatus.set(this.stats().totalNodes ? 'ready' : 'idle');
        } catch (error) {
            console.error('[GraphPage] Failed to initialize graph:', error);
            this.buildStatus.set('failed');
            this.buildMessage.set(error instanceof Error ? error.message : String(error));
        } finally {
            this.loading.set(false);
            this.deferFit();
        }
    }

    private async ensureWarmModels(): Promise<void> {
        if (this.warmStatus() === 'warm') return;
        if (this.warmPromise) return this.warmPromise;

        const startedAt = performance.now();
        this.warmStatus.set('warming');
        this.warmMessage.set('Loading Phoenix runtime and warming the scan path...');
        this.warmPromise = (async () => {
            try {
                await this.phoenixUiApi.loadRuntime();
                await this.phoenixUiApi.hydrateWithEntities();
                await this.phoenixUiApi.scanDiscovery('Aella carried the lantern to Kai near the harbor.');
                if (this.destroyed) return;
                const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
                this.warmStatus.set('warm');
                this.warmMessage.set(`Warm path ready in ${elapsedMs} ms.`);
            } catch (error) {
                if (!this.destroyed) {
                    this.warmStatus.set('failed');
                    this.warmMessage.set(error instanceof Error ? error.message : String(error));
                }
                throw error;
            } finally {
                this.warmPromise = null;
            }
        })();
        return this.warmPromise;
    }

    private async loadGraphData(sync = false): Promise<void> {
        const result = await this.graphPipeline.loadPersistedGraph({ sync });
        this.sourceGraphData = cloneGraphData(result.graphData);
        this.applyLensAndRender(false);
    }

    private applyLensAndRender(fit = false): void {
        const lensGraph = applyGraphLens(this.sourceGraphData, this.graphLens());
        this.graphData = filterGraphData(lensGraph, this.graphSearch());
        this.stats.set(this.graphData.stats || { ...EMPTY_GRAPH_STATS });
        this.pruneSelection();
        this.syncGalaxyScene();
        if (fit) this.deferFit();
    }

    private syncGalaxyScene(): void {
        const renderNodes = selectRenderableNodes(this.graphData.nodes);
        const nodeIds = new Set(renderNodes.map((node) => node.id));
        const maxLinks = Math.min(960, Math.max(180, renderNodes.length * 5));
        const renderEdges: GalaxyInputEdge[] = [];
        for (let index = 0; index < this.graphData.links.length && renderEdges.length < maxLinks; index += 1) {
            const edge = this.toGalaxyEdge(this.graphData.links[index], index);
            if (nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)) {
                renderEdges.push(edge);
            }
        }
        this.galaxyNodes.set(renderNodes.map((node) => this.toGalaxyNode(node)));
        this.galaxyEdges.set(renderEdges);
    }

    private async runSelectedScopeIndex() {
        const options = { policy: 'force' as const, syncGraph: true, reason: `graph-page:${this.graphLens()}` };
        const note = this.noteStore.currentNote();
        if (this.graphScope() === 'whole-vault') return this.graphOrchestrator.indexGlobal(options);
        if (!note) throw new Error('Open a note before building a note, folder, or narrative graph.');
        if (this.graphScope() === 'current-folder') {
            return note.folderId
                ? this.graphOrchestrator.indexFolder(note.folderId, options)
                : this.graphOrchestrator.indexNote(note, options);
        }
        if (this.graphScope() === 'narrative-folder') {
            return note.narrativeId
                ? this.graphOrchestrator.indexNarrative(note.narrativeId, options)
                : this.graphOrchestrator.indexNote(note, options);
        }
        return this.graphOrchestrator.indexNote(note, options);
    }

    private toGalaxyNode(node: GraphNode): GalaxyRenderableNode {
        const kind = String(node.kind || 'UNKNOWN').toUpperCase();
        return {
            id: node.id,
            label: node.name || node.id,
            kind,
            totalMentions: Math.max(1, Number(node.val || 1)),
            colorHsl: entityColorStore.getRawHsl(kind as any),
            metadata: { ...node },
        };
    }

    private toGalaxyEdge(link: GraphLink, index: number): GalaxyInputEdge {
        const sourceId = endpointId(link.source);
        const targetId = endpointId(link.target);
        const type = String(link.type || 'RELATED_TO').toUpperCase();
        const confidence = Number((link as any).confidence ?? link.value ?? 1);
        return {
            id: `${sourceId}:${targetId}:${type}:${index}`,
            sourceId,
            targetId,
            type,
            confidence: Number.isFinite(confidence) ? Math.max(0.2, Math.min(3, confidence)) : 1,
        };
    }

    private patchSettings(patch: Partial<GalaxyRenderSettings>): void {
        this.settings = { ...this.settings, ...patch };
    }

    private pruneSelection(): void {
        const ids = new Set(this.graphData.nodes.map((node) => node.id));
        const node = this.selectedNode();
        if (node && !ids.has(node.id)) this.selectedNode.set(null);
        const link = this.selectedLink();
        if (link && (!ids.has(endpointId(link.source)) || !ids.has(endpointId(link.target)))) {
            this.selectedLink.set(null);
        }
        if (this.selectedGalaxyId() && !ids.has(this.selectedGalaxyId() || '')) {
            this.selectedGalaxyId.set(null);
        }
    }

    private nodeLabel(id: string): string {
        return this.graphData.nodes.find((node) => node.id === id)?.name || id;
    }

    private deferFit(): void {
        setTimeout(() => this.fitToCanvas(), 160);
    }
}

function selectRenderableNodes(nodes: GraphNode[]): GraphNode[] {
    const maxNodes =
        nodes.length > 1400 ? 180 :
        nodes.length > 800 ? 220 :
        nodes.length > 420 ? 260 : 320;
    return nodes.map((node, index) => ({ node, index }))
        .sort((left, right) => renderNodePriority(right.node) - renderNodePriority(left.node) || left.index - right.index)
        .map((entry) => entry.node)
        .slice(0, maxNodes);
}

function renderNodePriority(node: GraphNode): number {
    return Math.max(1, Number(node.val || 1));
}

function sortedCounts(counts: Record<string, number>): { name: string; count: number }[] {
    return Object.entries(counts || {})
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
