import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

export type GraphRebuildEdgeJudgmentRole =
    | 'relationship_type'
    | 'temporal_relation'
    | 'causal_relation'
    | 'story_signal';

export interface GraphRebuildEdgeJudgmentRolePlan {
    role: GraphRebuildEdgeJudgmentRole;
    candidates: number;
    labelSetVersion: string;
    modelRole: string;
}

export interface GraphRebuildEdgeJudgmentPlan {
    schemaVersion: 'phoenix-edge-type-judgment-plan/v1';
    modelId: string;
    candidateCount: number;
    plannedModelCalls: number;
    roles: GraphRebuildEdgeJudgmentRolePlan[];
}

const GLICLASS_INSTRUCT_MODEL_ID = 'knowledgator/gliclass-instruct-base-v1.0';
const LABEL_SET_VERSION = 'edge-type-v1';

export function buildGraphRebuildEdgeJudgmentPlan(snapshot: GraphRebuildSnapshot): GraphRebuildEdgeJudgmentPlan {
    const relationships = snapshot.relationships || [];
    const temporalEdges = snapshot.temporalEdges || [];
    const causalEdges = snapshot.causalEdges || [];
    const relationshipCandidates = relationships.filter((row) => row.status !== 'rejected').length;
    const temporalCandidates = temporalEdges.length;
    const causalCandidates = causalEdges.length;
    const storyCandidates = storySignalCandidateCount(snapshot);
    const roles: GraphRebuildEdgeJudgmentRolePlan[] = [
        rolePlan('relationship_type', relationshipCandidates),
        rolePlan('temporal_relation', temporalCandidates),
        rolePlan('causal_relation', causalCandidates),
        rolePlan('story_signal', storyCandidates),
    ];
    const candidateCount = roles.reduce((sum, role) => sum + role.candidates, 0);
    return {
        schemaVersion: 'phoenix-edge-type-judgment-plan/v1',
        modelId: GLICLASS_INSTRUCT_MODEL_ID,
        candidateCount,
        plannedModelCalls: candidateCount,
        roles,
    };
}

export function edgeJudgmentPlanCounters(plan: GraphRebuildEdgeJudgmentPlan): Record<string, number> {
    const counters: Record<string, number> = {
        candidates: plan.candidateCount,
        plannedModelCalls: plan.plannedModelCalls,
        modelRoles: plan.roles.length,
    };
    for (const role of plan.roles) {
        counters[`${camelRole(role.role)}Candidates`] = role.candidates;
    }
    return counters;
}

function rolePlan(role: GraphRebuildEdgeJudgmentRole, candidates: number): GraphRebuildEdgeJudgmentRolePlan {
    return {
        role,
        candidates,
        labelSetVersion: LABEL_SET_VERSION,
        modelRole: `${GLICLASS_INSTRUCT_MODEL_ID}:${role}`,
    };
}

function storySignalCandidateCount(snapshot: GraphRebuildSnapshot): number {
    const relationshipSignals = (snapshot.relationships || []).filter((row) => {
        const type = row.relationType.toLowerCase();
        return type.includes('authority')
            || type.includes('command')
            || type.includes('approval')
            || type.includes('approves')
            || type.includes('family')
            || type.includes('intimate')
            || type.includes('scene')
            || type.includes('transfer');
    }).length;
    return relationshipSignals + (snapshot.events || []).length + (snapshot.memoryState || []).length;
}

function camelRole(role: GraphRebuildEdgeJudgmentRole): string {
    return role.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}
