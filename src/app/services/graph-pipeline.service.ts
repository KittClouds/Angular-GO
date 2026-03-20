import { Injectable, inject } from '@angular/core';

import { db, type Note } from '../lib/dexie/db';
import { GraphVizService, type ForceGraphData } from './graph-viz.service';
import { GoKittService, type KnowledgeGraphData } from './gokitt.service';
import { KnowledgeService } from './knowledge.service';

export interface GraphPipelineGraphResult {
    rawGraph: KnowledgeGraphData;
    graphData: ForceGraphData;
}

export interface GraphPipelineRunResult extends GraphPipelineGraphResult {
    runResult: any;
}

@Injectable({ providedIn: 'root' })
export class GraphPipelineService {
    private readonly goKitt = inject(GoKittService);
    private readonly knowledge = inject(KnowledgeService);
    private readonly graphViz = inject(GraphVizService);

    async runNoteGraphPipeline(note: Note): Promise<GraphPipelineRunResult> {
        await this.knowledge.ensureReady();

        const scope = await this.resolveScope(note);
        const runResult = await this.goKitt.systemRun({
            ingest: {
                scope,
                documents: [{
                    documentId: note.id,
                    noteId: note.id,
                    title: note.title,
                    text: note.markdownContent || note.content || '',
                    scope,
                }],
            },
            commit: { scope },
        });

        const graphResult = await this.loadPersistedGraph({ sync: true });
        return {
            runResult,
            rawGraph: graphResult.rawGraph,
            graphData: graphResult.graphData,
        };
    }

    async loadPersistedGraph(options: { sync?: boolean } = {}): Promise<GraphPipelineGraphResult> {
        await this.knowledge.ensureReady();

        if (options.sync) {
            const syncResult = await this.knowledge.sync();
            if (!syncResult.success) {
                throw new Error(syncResult.error || 'knowledge graph sync failed');
            }
        }

        const rawGraph = await this.knowledge.getGraph();
        return {
            rawGraph,
            graphData: this.graphViz.fromKnowledgeGraph(rawGraph),
        };
    }

    private async resolveScope(note: Note): Promise<{
        worldId: string;
        narrativeId?: string;
        folderId: string;
        folderPath: string;
    }> {
        const worldId = note.worldId || 'global';
        const narrativeId = note.narrativeId || undefined;
        const folderId = note.folderId || note.narrativeId || note.worldId || 'global';
        const folderPath = await this.resolveFolderPath(note.folderId) || folderId;

        return {
            worldId,
            narrativeId,
            folderId,
            folderPath,
        };
    }

    private async resolveFolderPath(folderId: string): Promise<string | undefined> {
        if (!folderId) {
            return undefined;
        }

        const seen = new Set<string>();
        const segments: string[] = [];
        let currentId = folderId;

        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            const folder = await db.folders.get(currentId);
            if (!folder) {
                break;
            }

            segments.unshift(folder.name || folder.id);
            currentId = folder.parentId || '';
        }

        return segments.length > 0 ? segments.join(' / ') : undefined;
    }
}
