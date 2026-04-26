import type {
    ContextIslandBridge,
    ContextIslandMembership,
    SignalQualityFamily,
    SignalQualityLedgerEntry,
    SignalQualityStatus,
} from '../dexie/db';
import { db } from '../dexie/db';

export interface SignalQualityInput {
    candidateId: string;
    sourceUnitId: string;
    targetUnitId?: string;
    signalFamily: SignalQualityFamily;
    supportScore?: number;
    contradictionScore?: number;
    freshness?: number;
    scopeConfidence?: number;
    islandConfidence?: number;
    pathConfidence?: number;
    rerankScore?: number;
    status?: SignalQualityStatus;
    provenance?: string[];
    generation: number;
    updatedAt?: number;
}

interface SignalQualityWeights {
    support: number;
    contradiction: number;
    freshness: number;
    scope: number;
    island: number;
    path: number;
}

const FAMILY_WEIGHTS: Record<SignalQualityFamily, SignalQualityWeights> = {
    lexical: { support: 1, contradiction: 1.2, freshness: 0.06, scope: 0.18, island: 0.16, path: 0.18 },
    semantic: { support: 0.92, contradiction: 1.25, freshness: 0.05, scope: 0.14, island: 0.2, path: 0.18 },
    graph: { support: 1.04, contradiction: 1.35, freshness: 0.08, scope: 0.2, island: 0.18, path: 0.26 },
    temporal: { support: 1.02, contradiction: 1.45, freshness: 0.16, scope: 0.16, island: 0.12, path: 0.3 },
    causal: { support: 1.08, contradiction: 1.5, freshness: 0.12, scope: 0.16, island: 0.12, path: 0.34 },
    structural: { support: 0.9, contradiction: 1.15, freshness: 0.04, scope: 0.24, island: 0.24, path: 0.18 },
    llm: { support: 0.7, contradiction: 1.7, freshness: 0.04, scope: 0.1, island: 0.08, path: 0.12 },
};

export function buildSignalQualityEntry(input: SignalQualityInput): SignalQualityLedgerEntry {
    const supportScore = clamp(input.supportScore ?? 0, 0, 1);
    const contradictionScore = clamp(input.contradictionScore ?? 0, 0, 1);
    const freshness = clamp(input.freshness ?? 1, 0, 1);
    const scopeConfidence = clamp(input.scopeConfidence ?? 0, 0, 1);
    const islandConfidence = clamp(input.islandConfidence ?? 0, 0, 1);
    const pathConfidence = clamp(input.pathConfidence ?? 0, 0, 1);
    const rerankScore = input.rerankScore ?? scoreSignalQuality({
        signalFamily: input.signalFamily,
        supportScore,
        contradictionScore,
        freshness,
        scopeConfidence,
        islandConfidence,
        pathConfidence,
    });
    const status = input.status ?? inferStatus({
        supportScore,
        contradictionScore,
        scopeConfidence,
        islandConfidence,
        pathConfidence,
        rerankScore,
    });
    const provenance = Array.from(new Set(input.provenance || [])).sort();
    const targetUnitId = input.targetUnitId || '';

    return {
        id: ledgerEntryId(input.candidateId, input.signalFamily, input.sourceUnitId, targetUnitId),
        candidateId: input.candidateId,
        sourceUnitId: input.sourceUnitId,
        targetUnitId,
        signalFamily: input.signalFamily,
        supportScore,
        contradictionScore,
        freshness,
        scopeConfidence,
        islandConfidence,
        pathConfidence,
        rerankScore,
        status,
        provenance,
        generation: input.generation,
        updatedAt: input.updatedAt ?? input.generation,
    };
}

export async function upsertSignalQualityEntries(
    inputs: SignalQualityInput[],
): Promise<SignalQualityLedgerEntry[]> {
    if (!inputs.length) {
        return [];
    }
    const entries = inputs.map(buildSignalQualityEntry);
    await db.signalQualityLedger.bulkPut(entries);
    return entries;
}

export async function deleteSignalQualityEntriesForCandidates(candidateIds: string[]): Promise<void> {
    if (!candidateIds.length) {
        return;
    }
    await db.signalQualityLedger.where('candidateId').anyOf(candidateIds).delete();
}

export function signalEntriesForContextIslandMemberships(
    memberships: ContextIslandMembership[],
): SignalQualityLedgerEntry[] {
    return memberships.map(membership => buildSignalQualityEntry({
        candidateId: membership.id,
        sourceUnitId: membership.noteId,
        targetUnitId: membership.islandId,
        signalFamily: 'structural',
        supportScore: membership.confidence,
        contradictionScore: 0,
        freshness: 1,
        scopeConfidence: membership.narrativeId ? 1 : 0.7,
        islandConfidence: membership.confidence,
        pathConfidence: clamp(membership.evidence.folderPrior / 2, 0, 1),
        status: membership.confidence >= 0.7 ? 'accepted' : 'deferred',
        provenance: [
            'context-island:membership',
            `tokens:${membership.evidence.tokenCount}`,
            `folder-prior:${membership.evidence.folderPrior.toFixed(3)}`,
        ],
        generation: membership.generation,
        updatedAt: membership.updatedAt,
    }));
}

export function signalEntriesForContextIslandBridges(
    bridges: ContextIslandBridge[],
): SignalQualityLedgerEntry[] {
    return bridges.map(bridge => buildSignalQualityEntry({
        candidateId: bridge.id,
        sourceUnitId: bridge.sourceIslandId,
        targetUnitId: bridge.targetIslandId,
        signalFamily: 'structural',
        supportScore: bridge.confidence,
        contradictionScore: 0,
        freshness: 1,
        scopeConfidence: bridge.narrativeId ? 1 : 0.64,
        islandConfidence: bridge.confidence,
        pathConfidence: clamp(bridge.evidence.lexicalScore / Math.max(bridge.evidence.edgeCount, 1), 0, 1),
        status: bridge.confidence >= 0.55 ? 'accepted' : 'deferred',
        provenance: [
            'context-island:bridge',
            `edges:${bridge.evidence.edgeCount}`,
            ...bridge.sharedTerms.map(term => `shared:${term}`),
        ],
        generation: bridge.generation,
        updatedAt: bridge.updatedAt,
    }));
}

function scoreSignalQuality(input: {
    signalFamily: SignalQualityFamily;
    supportScore: number;
    contradictionScore: number;
    freshness: number;
    scopeConfidence: number;
    islandConfidence: number;
    pathConfidence: number;
}): number {
    const weights = FAMILY_WEIGHTS[input.signalFamily];
    return roundScore(
        input.supportScore * weights.support
        - input.contradictionScore * weights.contradiction
        + input.freshness * weights.freshness
        + input.scopeConfidence * weights.scope
        + input.islandConfidence * weights.island
        + input.pathConfidence * weights.path,
    );
}

function inferStatus(input: {
    supportScore: number;
    contradictionScore: number;
    scopeConfidence: number;
    islandConfidence: number;
    pathConfidence: number;
    rerankScore: number;
}): SignalQualityStatus {
    if (input.contradictionScore >= 0.72 && input.contradictionScore > input.supportScore + 0.18) {
        return 'rejected';
    }
    if (input.contradictionScore >= 0.45 && input.supportScore >= 0.45) {
        return 'review';
    }
    if (input.rerankScore >= 0.82 && input.scopeConfidence >= 0.55) {
        return 'accepted';
    }
    if (Math.max(input.islandConfidence, input.pathConfidence) >= 0.5 || input.supportScore >= 0.5) {
        return 'deferred';
    }
    return 'review';
}

function ledgerEntryId(candidateId: string, family: SignalQualityFamily, source: string, target: string): string {
    return `signal:${hashText(`${candidateId}|${family}|${source}|${target}`)}`;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
