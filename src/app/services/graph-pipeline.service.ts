import { Injectable, inject } from '@angular/core';

import { type Note } from '../lib/dexie/db';
import { type ForceGraphData } from './graph-viz.service';
import { type KnowledgeGraphData } from './phoenix-ui-api.service';
import { PhoenixGraphOrchestratorService } from './phoenix-graph-orchestrator.service';

export interface GraphPipelineGraphResult {
    rawGraph: KnowledgeGraphData;
    graphData: ForceGraphData;
}

export interface GraphPipelineRunResult extends GraphPipelineGraphResult {
    runResult: any;
}

@Injectable({ providedIn: 'root' })
export class GraphPipelineService {
    private readonly orchestrator = inject(PhoenixGraphOrchestratorService);

    async runNoteGraphPipeline(note: Note): Promise<GraphPipelineRunResult> {
        const result = await this.orchestrator.indexNote(note, {
            policy: 'force',
            syncGraph: true,
            reason: 'active-note-index',
        });
        const graphResult = result.graph || await this.loadPersistedGraph({ sync: true });
        return {
            runResult: result.runResult,
            rawGraph: graphResult.rawGraph,
            graphData: graphResult.graphData,
        };
    }

    async loadPersistedGraph(options: { sync?: boolean } = {}): Promise<GraphPipelineGraphResult> {
        return this.orchestrator.loadGraphView({ sync: options.sync });
    }
}
