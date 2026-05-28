import type { GraphIndexPolicy, GraphRebuildSnapshot } from './graph-rebuild-snapshot';

export type GraphRebuildDeltaPostProcessLane =
    | 'local_entity_fact_refresh'
    | 'entity_relink'
    | 'target_replan'
    | 'projection_only';

export interface GraphRebuildDeltaPostProcessLanePlan {
    lane: GraphRebuildDeltaPostProcessLane;
    dirty: boolean;
    units: number;
    reason: string;
}

export interface GraphRebuildDeltaPostProcessPlan {
    schemaVersion: 'phoenix-delta-postprocess-plan/v1';
    policy: GraphIndexPolicy;
    route: 'full_replan' | 'projection_only';
    cachedSnapshot: boolean;
    fingerprintMatched: boolean;
    dirtyLaneCount: number;
    lanes: GraphRebuildDeltaPostProcessLanePlan[];
}

interface DeltaDoc {
    id: string;
    version?: number;
    updatedAt?: number;
    plainText: string;
}

interface DeltaEntity {
    id: string;
    label: string;
    kind: string;
    aliases?: string[];
}

export function buildGraphRebuildDeltaPostProcessPlan(input: {
    policy: GraphIndexPolicy;
    docs: DeltaDoc[];
    entities: DeltaEntity[];
    cachedSnapshot?: GraphRebuildSnapshot | null;
    fingerprintMatched: boolean;
}): GraphRebuildDeltaPostProcessPlan {
    const cachedSnapshot = input.cachedSnapshot || null;
    const changedNotes = input.fingerprintMatched ? 0 : changedNoteCount(input.docs, cachedSnapshot);
    const changedEntities = input.fingerprintMatched ? 0 : changedEntityCount(input.entities, cachedSnapshot);
    const targetReplan = input.policy === 'force' || !input.fingerprintMatched || changedNotes > 0 || changedEntities > 0;
    const projectionOnly = Boolean(cachedSnapshot?.embeddingGraphPostProcess)
        && input.fingerprintMatched
        && input.policy !== 'force'
        && changedNotes === 0
        && changedEntities === 0;
    const lanes: GraphRebuildDeltaPostProcessLanePlan[] = [
        {
            lane: 'local_entity_fact_refresh',
            dirty: changedNotes > 0,
            units: changedNotes,
            reason: changedNotes > 0 ? 'changed note text/version needs local entity and fact refresh' : 'note spine unchanged',
        },
        {
            lane: 'entity_relink',
            dirty: changedEntities > 0,
            units: changedEntities,
            reason: changedEntities > 0 ? 'accepted entity surface changed; affected anchors need relink' : 'accepted entity surfaces unchanged',
        },
        {
            lane: 'target_replan',
            dirty: targetReplan,
            units: targetReplan ? 1 : 0,
            reason: targetReplan ? 'signal target plan must be rebuilt before embedding admission' : 'target plan can be reused',
        },
        {
            lane: 'projection_only',
            dirty: projectionOnly,
            units: projectionOnly ? 1 : 0,
            reason: projectionOnly ? 'snapshot is current; only projection policy can run' : 'projection-only route is not sufficient',
        },
    ];
    return {
        schemaVersion: 'phoenix-delta-postprocess-plan/v1',
        policy: input.policy,
        route: projectionOnly ? 'projection_only' : 'full_replan',
        cachedSnapshot: Boolean(cachedSnapshot),
        fingerprintMatched: input.fingerprintMatched,
        dirtyLaneCount: lanes.filter((lane) => lane.dirty).length,
        lanes,
    };
}

export function deltaPostProcessPlanCounters(plan: GraphRebuildDeltaPostProcessPlan): Record<string, number> {
    const counters: Record<string, number> = {
        cachedSnapshot: plan.cachedSnapshot ? 1 : 0,
        fingerprintMatched: plan.fingerprintMatched ? 1 : 0,
        fullReplanRoute: plan.route === 'full_replan' ? 1 : 0,
        projectionOnlyRoute: plan.route === 'projection_only' ? 1 : 0,
        dirtyLanes: plan.dirtyLaneCount,
    };
    for (const lane of plan.lanes) {
        const prefix = camelLane(lane.lane);
        counters[`${prefix}Dirty`] = lane.dirty ? 1 : 0;
        counters[`${prefix}Units`] = lane.units;
    }
    return counters;
}

function changedNoteCount(docs: DeltaDoc[], snapshot: GraphRebuildSnapshot | null): number {
    if (!snapshot) return docs.length;
    const snapshotNoteIds = new Set(snapshot.noteIds || []);
    const chunkHashesByNote = new Map<string, Set<string>>();
    for (const chunk of snapshot.chunks || []) {
        if (!chunk.textHash) continue;
        const bucket = chunkHashesByNote.get(chunk.noteId) || new Set<string>();
        bucket.add(chunk.textHash);
        chunkHashesByNote.set(chunk.noteId, bucket);
    }
    let changed = 0;
    for (const doc of docs) {
        if (!snapshotNoteIds.has(doc.id)) {
            changed += 1;
            continue;
        }
        const hashes = chunkHashesByNote.get(doc.id);
        if (!hashes?.size) continue;
        if (!hashes.has(simpleHash(doc.plainText))) changed += 1;
    }
    return changed;
}

function changedEntityCount(entities: DeltaEntity[], snapshot: GraphRebuildSnapshot | null): number {
    if (!snapshot) return entities.length;
    const nodes = new Map((snapshot.nodes || []).map((node) => [node.entityId, node]));
    return entities.filter((entity) => {
        const node = nodes.get(entity.id);
        if (!node) return true;
        return node.label !== entity.label
            || node.kind !== entity.kind
            || aliasKey(node.aliases) !== aliasKey(entity.aliases || []);
    }).length;
}

function aliasKey(values: string[]): string {
    return [...values].map((value) => value.toLowerCase()).sort().join('\0');
}

function camelLane(lane: GraphRebuildDeltaPostProcessLane): string {
    return lane.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function simpleHash(value: string): string {
    let out = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return (out >>> 0).toString(16).padStart(8, '0');
}
