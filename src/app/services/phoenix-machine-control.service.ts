import { Injectable, computed, inject, signal } from '@angular/core';

import { EmbeddingEngine } from '../lib/embeddings/EmbeddingEngine';
import { SemanticSearchService } from '../lib/services/semantic-search.service';
import { PhoenixGraphOrchestratorService, type PhoenixGraphIndexPolicy } from './phoenix-graph-orchestrator.service';
import { PhoenixUiApiService, type SearchScope } from './phoenix-ui-api.service';
import { GraphAuditService } from './graph-audit.service';
import type { GraphAuditSnapshot } from './graph-audit.model';
import {
    RetrievalWorkbenchStateService,
    type RetrievalGraphFocus,
    type RetrievalGraphLensMode,
    type RetrievalLane,
} from './retrieval-workbench-state.service';

export type PhoenixMachineVectorStatus = 'idle' | 'loading' | 'ready' | 'indexing' | 'error';
export type PhoenixMachineGraphStatus = 'idle' | 'building' | 'ready' | 'searching' | 'error';
export type PhoenixMachineModelId = 'mongodb-leaf' | 'bge-small-en' | 'jina-v5-nano-retrieval';

export interface PhoenixMachineSemanticDocument {
    id: string;
    narrativeId: string;
    title: string;
    content: string;
}

export interface PhoenixMachineSummary {
    kind: 'search' | 'graph-update' | 'graph-rebuild' | 'semantic-load' | 'semantic-index' | 'audit' | 'graph-focus';
    label: string;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    details?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class PhoenixMachineControlService {
    private readonly workbench = inject(RetrievalWorkbenchStateService);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);
    private readonly semanticSearch = inject(SemanticSearchService);
    private readonly graphOrchestrator = inject(PhoenixGraphOrchestratorService);
    private readonly graphAuditService = inject(GraphAuditService);

    readonly query = this.workbench.query;
    readonly scope = this.workbench.scope;
    readonly lanes = this.workbench.lanes;
    readonly activeLanes = this.workbench.activeLanes;
    readonly graphFocus = this.workbench.graphFocus;
    readonly graphLensMode = this.workbench.graphLensMode;

    readonly vectorStatus = signal<PhoenixMachineVectorStatus>(EmbeddingEngine.isReady() ? 'ready' : 'idle');
    readonly graphStatus = signal<PhoenixMachineGraphStatus>('idle');
    readonly graphAudit = signal<GraphAuditSnapshot | null>(null);
    readonly notice = signal<string | null>(null);
    readonly error = signal<string | null>(null);
    readonly activeJob = signal<PhoenixMachineSummary['kind'] | null>(null);
    readonly lastSummary = signal<PhoenixMachineSummary | null>(null);

    readonly graphNodes = computed(() => this.graphAudit()?.graphNodes || 0);
    readonly graphEdges = computed(() => this.graphAudit()?.graphEdges || 0);
    readonly registryEntities = computed(() => this.graphAudit()?.registryEntities || 0);
    readonly liveDocuments = computed(() => this.graphAudit()?.liveDocuments || 0);
    readonly indexedDocuments = computed(() => this.graphAudit()?.indexedDocuments || 0);
    readonly staleDocuments = computed(() => this.graphAudit()?.staleDocuments || 0);
    readonly graphIssueCount = computed(() =>
        (this.graphAudit()?.orphanEdges || 0) + (this.graphAudit()?.duplicateEdges || 0)
    );
    readonly hasCommittedGraph = computed(() => this.graphNodes() > 0 || this.graphEdges() > 0);

    setScope(scope: 'global' | string): void {
        this.scope.set(scope || 'global');
    }

    setLane(lane: RetrievalLane, enabled: boolean): void {
        this.workbench.setLane(lane, enabled);
    }

    toggleLane(lane: RetrievalLane): void {
        this.workbench.toggleLane(lane);
    }

    setGraphLensMode(mode: RetrievalGraphLensMode): void {
        this.workbench.setGraphLensMode(mode);
    }

    requestGraphFocus(focus: Omit<RetrievalGraphFocus, 'requestedAt'>): void {
        const startedAt = performance.now();
        this.workbench.requestGraphFocus(focus);
        this.recordSummary('graph-focus', focus.title || focus.query || 'Graph focus', startedAt, {
            scope: focus.scope,
            noteId: focus.noteId,
        });
    }

    async search(query: string, limit: number, scope?: SearchScope): Promise<any[]> {
        const startedAt = this.beginJob('search');
        const shouldMarkGraph = this.activeLanes().includes('graph') && this.hasCommittedGraph();
        if (shouldMarkGraph) this.graphStatus.set('searching');

        try {
            const results = await this.phoenixUiApi.searchScoped(query, limit, scope);
            if (this.graphStatus() === 'searching') this.graphStatus.set('ready');
            this.finishJob('search', `Search returned ${results.length} hits`, startedAt, { resultCount: results.length });
            return results;
        } catch (err) {
            if (this.graphStatus() === 'searching') this.graphStatus.set('error');
            this.failJob(err);
            throw err;
        }
    }

    async loadSemanticModel(modelId: PhoenixMachineModelId, label: string, dimensionLabel: string): Promise<void> {
        const startedAt = this.beginJob('semantic-load');
        this.vectorStatus.set('loading');
        this.error.set(null);

        try {
            await this.semanticSearch.initializeWorker();
            await EmbeddingEngine.initialize(modelId);
            this.vectorStatus.set('ready');
            this.notice.set(`${label} loaded at ${dimensionLabel}. Semantic work stays explicit.`);
            this.finishJob('semantic-load', `${label} loaded`, startedAt, { modelId, dimensionLabel });
        } catch (err) {
            this.vectorStatus.set('error');
            this.failJob(err);
            throw err;
        }
    }

    async indexSemanticDocuments(documents: PhoenixMachineSemanticDocument[]): Promise<void> {
        const startedAt = this.beginJob('semantic-index');
        this.vectorStatus.set('indexing');
        this.error.set(null);

        try {
            await this.semanticSearch.indexNotes(documents);
            this.vectorStatus.set('ready');
            this.notice.set(`Queued ${documents.length} notes for embedding. Graph commits remain explicit.`);
            this.finishJob('semantic-index', `Queued ${documents.length} semantic documents`, startedAt, {
                documentCount: documents.length,
            });
        } catch (err) {
            this.vectorStatus.set('error');
            this.failJob(err);
            throw err;
        }
    }

    async runGraphIndex(policy: PhoenixGraphIndexPolicy, reason: string): Promise<number> {
        const kind = policy === 'force' ? 'graph-rebuild' : 'graph-update';
        const startedAt = this.beginJob(kind);
        this.graphStatus.set('building');
        this.error.set(null);
        this.notice.set(null);

        try {
            const scope = this.scope();
            const result = scope === 'global'
                ? await this.graphOrchestrator.indexGlobal({ policy, syncGraph: true, reason })
                : await this.graphOrchestrator.indexFolder(scope, { policy, syncGraph: true, reason });
            this.phoenixUiApi.invalidateKnowledgeGraphCache();
            await this.refreshAuditSafe();
            this.graphStatus.set('ready');
            this.notice.set(`Graph ${policy === 'force' ? 'rebuilt' : 'updated'} for ${result.processedNotes} notes.`);
            this.finishJob(kind, this.notice() || 'Graph index complete', startedAt, {
                processedNotes: result.processedNotes,
                skippedNotes: result.skippedNotes,
                scope,
            });
            return result.processedNotes;
        } catch (err) {
            this.graphStatus.set('error');
            this.failJob(err);
            throw err;
        }
    }

    async refreshAuditSafe(): Promise<void> {
        const startedAt = this.beginJob('audit');
        try {
            const snapshot = await this.graphAuditService.snapshot(this.auditScope());
            this.graphAudit.set(snapshot);
            if (this.graphStatus() === 'idle' && (snapshot.graphNodes > 0 || snapshot.graphEdges > 0)) {
                this.graphStatus.set('ready');
            }
            this.finishJob('audit', 'Graph audit refreshed', startedAt, {
                nodes: snapshot.graphNodes,
                edges: snapshot.graphEdges,
                issues: snapshot.orphanEdges + snapshot.duplicateEdges,
            });
        } catch (err) {
            this.graphAudit.set(null);
            this.failJob(err, false);
        }
    }

    setNotice(message: string | null): void {
        this.notice.set(message);
    }

    clearFeedback(): void {
        this.notice.set(null);
        this.error.set(null);
    }

    private auditScope(): { folderId?: string } {
        const scope = this.scope();
        return scope === 'global' ? {} : { folderId: scope };
    }

    private beginJob(kind: PhoenixMachineSummary['kind']): number {
        this.activeJob.set(kind);
        return performance.now();
    }

    private finishJob(
        kind: PhoenixMachineSummary['kind'],
        label: string,
        startedAt: number,
        details?: Record<string, unknown>
    ): void {
        this.recordSummary(kind, label, startedAt, details);
        this.activeJob.set(null);
    }

    private recordSummary(
        kind: PhoenixMachineSummary['kind'],
        label: string,
        startedAt: number,
        details?: Record<string, unknown>
    ): void {
        const completedAt = performance.now();
        this.lastSummary.set({
            kind,
            label,
            startedAt,
            completedAt,
            durationMs: Math.round(completedAt - startedAt),
            details,
        });
    }

    private failJob(err: unknown, expose = true): void {
        if (expose) this.error.set(err instanceof Error ? err.message : String(err));
        this.activeJob.set(null);
    }
}
