import type {
    GraphModelV2Atom,
    GraphModelV2AtomKind,
    GraphModelV2FactFamily,
    GraphModelV2FactRole,
    GraphModelV2ProjectionEdge,
    GraphModelV2RelationFact,
    GraphModelV2Snapshot,
    GraphModelV2StyleTag,
    GraphModelV2StyleTagKind,
} from './graph-model-v2';

export interface GraphModelV2DebugSummary {
    atomsByKind: Record<string, number>;
    factsByFamily: Record<string, number>;
    hyperedgeFacts: number;
    projectionEdges: number;
    styleTags: number;
}

export interface GraphModelV2ReadModel {
    readonly model: GraphModelV2Snapshot;
    getAtom(id: string): GraphModelV2Atom | undefined;
    getFact(id: string): GraphModelV2RelationFact | undefined;
    getAtomsByKind(kind: GraphModelV2AtomKind): GraphModelV2Atom[];
    getFactsByFamily(family: GraphModelV2FactFamily): GraphModelV2RelationFact[];
    getRolesForFact(factId: string): GraphModelV2FactRole[];
    getStyleTagsForTarget(targetId: string, kind?: GraphModelV2StyleTagKind): GraphModelV2StyleTag[];
    getProjectionEdgesForTarget(targetId: string): GraphModelV2ProjectionEdge[];
    debugSummary(): GraphModelV2DebugSummary;
}

export function createGraphModelV2ReadModel(model: GraphModelV2Snapshot): GraphModelV2ReadModel {
    const atomsById = new Map(model.atoms.map((atom) => [atom.id, atom]));
    const factsById = new Map(model.facts.map((fact) => [fact.id, fact]));
    const atomsByKind = groupBy(model.atoms, (atom) => atom.kind);
    const factsByFamily = groupBy(model.facts, (fact) => fact.family);
    const rolesByFact = groupBy(model.roles, (role) => role.factId);
    const styleTagsByTarget = groupBy(model.styleTags, (tag) => tag.targetId);
    const projectionEdgesByTarget = new Map<string, GraphModelV2ProjectionEdge[]>();
    for (const edge of model.projectionEdges) {
        pushGrouped(projectionEdgesByTarget, edge.sourceId, edge);
        pushGrouped(projectionEdgesByTarget, edge.targetId, edge);
    }

    return {
        model,
        getAtom: (id) => atomsById.get(id),
        getFact: (id) => factsById.get(id),
        getAtomsByKind: (kind) => atomsByKind.get(kind) || [],
        getFactsByFamily: (family) => factsByFamily.get(family) || [],
        getRolesForFact: (factId) => rolesByFact.get(factId) || [],
        getStyleTagsForTarget: (targetId, kind) => {
            const tags = styleTagsByTarget.get(targetId) || [];
            return kind ? tags.filter((tag) => tag.tagKind === kind) : tags;
        },
        getProjectionEdgesForTarget: (targetId) => projectionEdgesByTarget.get(targetId) || [],
        debugSummary: () => ({
            atomsByKind: countBy(model.atoms, (atom) => atom.kind),
            factsByFamily: countBy(model.facts, (fact) => fact.family),
            hyperedgeFacts: model.counters.hyperedgeFacts,
            projectionEdges: model.counters.projectionEdges,
            styleTags: model.counters.styleTags,
        }),
    };
}

function groupBy<T>(values: T[], keyOf: (value: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const value of values) pushGrouped(grouped, keyOf(value), value);
    return grouped;
}

function pushGrouped<T>(grouped: Map<string, T[]>, key: string, value: T): void {
    const bucket = grouped.get(key);
    if (bucket) bucket.push(value);
    else grouped.set(key, [value]);
}

function countBy<T>(values: T[], keyOf: (value: T) => string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) {
        const key = keyOf(value);
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}
