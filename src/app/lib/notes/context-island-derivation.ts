import type {
    ContextIsland,
    ContextIslandBridge,
    ContextIslandMembership,
    Folder,
    Note,
    NoteBlockProjection,
} from '../dexie/db';
import {
    addWeightedTokens,
    clamp,
    type ContextIslandFolderInput,
    type FolderInfo,
    getFolderInfo,
    groupByKey,
    hashText,
    pairKey,
    topTermsFromMap,
    UnionFind,
} from './context-island-utils';

type NoteInput = Pick<Note, 'id' | 'worldId' | 'title' | 'folderId' | 'narrativeId' | 'updatedAt'> & {
    markdownContent?: string;
};
type FolderInput = Pick<Folder, 'worldId'> & ContextIslandFolderInput;
type BlockInput = Pick<NoteBlockProjection, 'noteId' | 'text' | 'nodeType' | 'headingLevel' | 'ordinal'>;

interface DerivationOptions {
    worldId?: string;
    maxTextCharsPerNote: number;
    maxTokensPerNote: number;
    maxPostingSize: number;
    maxCommonDocumentRatio: number;
    folderPairLimit: number;
    unionThreshold: number;
    bridgeThreshold: number;
    maxBridgeCount: number;
}

export interface ContextIslandDerivationInput {
    notes: NoteInput[];
    folders: FolderInput[];
    blocks: BlockInput[];
    now?: number;
    options?: Partial<DerivationOptions>;
}

export interface ContextIslandDerivationResult {
    islands: ContextIsland[];
    memberships: ContextIslandMembership[];
    bridges: ContextIslandBridge[];
    worldIds: string[];
}

interface WeightedToken {
    token: string;
    weight: number;
}

interface NoteModel {
    note: NoteInput;
    folder: FolderInfo;
    blockCount: number;
    features: WeightedToken[];
}

interface PairScore {
    left: number;
    right: number;
    lexicalScore: number;
    folderScore: number;
    terms: Map<string, number>;
}

const DEFAULT_OPTIONS: DerivationOptions = {
    maxTextCharsPerNote: 24000,
    maxTokensPerNote: 96,
    maxPostingSize: 96,
    maxCommonDocumentRatio: 0.35,
    folderPairLimit: 128,
    unionThreshold: 2.4,
    bridgeThreshold: 1.15,
    maxBridgeCount: 512,
};

export function deriveGlobalContextIslands(input: ContextIslandDerivationInput): ContextIslandDerivationResult {
    const options = { ...DEFAULT_OPTIONS, ...input.options };
    const now = input.now ?? Date.now();
    const folderById = new Map(input.folders.map(folder => [folder.id, folder]));
    const folderInfoCache = new Map<string, FolderInfo>();
    const blocksByNote = groupByKey(input.blocks, block => block.noteId);
    const modelsByWorld = new Map<string, NoteModel[]>();
    const hasWorldFilter = input.options?.worldId !== undefined;

    for (const note of input.notes) {
        const worldId = note.worldId || '';
        if (hasWorldFilter && worldId !== input.options!.worldId) {
            continue;
        }
        const folder = getFolderInfo(note.folderId || '', folderById, folderInfoCache);
        if (note.narrativeId || folder.narrativeId) {
            continue;
        }
        const model = buildNoteModel(note, folder, blocksByNote.get(note.id) || [], options);
        if (!modelsByWorld.has(worldId)) {
            modelsByWorld.set(worldId, []);
        }
        modelsByWorld.get(worldId)!.push(model);
    }

    const islands: ContextIsland[] = [];
    const memberships: ContextIslandMembership[] = [];
    const bridges: ContextIslandBridge[] = [];

    for (const [worldId, models] of modelsByWorld) {
        const result = deriveWorldIslands(worldId, models, options, now);
        islands.push(...result.islands);
        memberships.push(...result.memberships);
        bridges.push(...result.bridges);
    }

    const worldIds = hasWorldFilter
        ? [input.options!.worldId || '']
        : Array.from(modelsByWorld.keys()).sort();
    return { islands, memberships, bridges, worldIds };
}

function deriveWorldIslands(
    worldId: string,
    models: NoteModel[],
    options: DerivationOptions,
    now: number,
): Pick<ContextIslandDerivationResult, 'islands' | 'memberships' | 'bridges'> {
    if (!models.length) {
        return { islands: [], memberships: [], bridges: [] };
    }

    const pairs = buildPairScores(models, options);
    const union = new UnionFind(models.length);
    for (const pair of pairs.values()) {
        if (pair.lexicalScore + pair.folderScore >= options.unionThreshold) {
            union.union(pair.left, pair.right);
        }
    }

    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < models.length; i++) {
        const root = union.find(i);
        const cluster = clusterMap.get(root);
        if (cluster) {
            cluster.push(i);
        } else {
            clusterMap.set(root, [i]);
        }
    }

    const islandByRoot = new Map<number, ContextIsland>();
    const islands: ContextIsland[] = [];
    const memberships: ContextIslandMembership[] = [];
    const generation = now;

    for (const [root, indices] of clusterMap) {
        const island = buildIsland(worldId, indices, models, pairs, generation, now);
        islandByRoot.set(root, island);
        islands.push(island);
        for (const index of indices) {
            memberships.push(buildMembership(island, index, indices, models, pairs, options, generation, now));
        }
    }

    return {
        islands,
        memberships,
        bridges: buildBridges(worldId, models, pairs, union, islandByRoot, options, generation, now),
    };
}

function buildPairScores(models: NoteModel[], options: DerivationOptions): Map<string, PairScore> {
    const pairs = new Map<string, PairScore>();
    const postings = new Map<string, Array<{ index: number; weight: number }>>();
    models.forEach((model, index) => {
        for (const feature of model.features) {
            let list = postings.get(feature.token);
            if (!list) {
                list = [];
                postings.set(feature.token, list);
            }
            list.push({ index, weight: feature.weight });
        }
    });

    const commonLimit = Math.max(16, Math.floor(models.length * options.maxCommonDocumentRatio));
    for (const [token, list] of postings) {
        if (list.length < 2 || list.length > options.maxPostingSize || list.length > commonLimit) {
            continue;
        }
        const idfWeight = 1 / Math.sqrt(list.length);
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const score = Math.min(list[i].weight, list[j].weight) * idfWeight;
                addPairScore(pairs, list[i].index, list[j].index, score, 0, token);
            }
        }
    }

    addFolderPriorPairs(pairs, models, model => model.folder.id, 1.2, options.folderPairLimit);
    addFolderPriorPairs(pairs, models, model => model.folder.rootFolderId, 0.55, options.folderPairLimit);
    return pairs;
}

function addFolderPriorPairs(
    pairs: Map<string, PairScore>,
    models: NoteModel[],
    keyFn: (model: NoteModel) => string,
    score: number,
    pairLimit: number,
): void {
    const groups = new Map<string, number[]>();
    models.forEach((model, index) => {
        const key = keyFn(model);
        if (!key) {
            return;
        }
        const group = groups.get(key);
        if (group) {
            group.push(index);
        } else {
            groups.set(key, [index]);
        }
    });

    for (const group of groups.values()) {
        if (group.length < 2 || group.length > pairLimit) {
            continue;
        }
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                addPairScore(pairs, group[i], group[j], 0, score);
            }
        }
    }
}

function addPairScore(
    pairs: Map<string, PairScore>,
    left: number,
    right: number,
    lexicalScore: number,
    folderScore: number,
    token?: string,
): void {
    const key = pairKey(left, right);
    let pair = pairs.get(key);
    if (!pair) {
        pair = { left: Math.min(left, right), right: Math.max(left, right), lexicalScore: 0, folderScore: 0, terms: new Map() };
        pairs.set(key, pair);
    }
    pair.lexicalScore += lexicalScore;
    pair.folderScore += folderScore;
    if (token) {
        pair.terms.set(token, (pair.terms.get(token) || 0) + lexicalScore);
    }
}

function buildIsland(
    worldId: string,
    indices: number[],
    models: NoteModel[],
    pairs: Map<string, PairScore>,
    generation: number,
    now: number,
): ContextIsland {
    const sortedNoteIds = indices.map(index => models[index].note.id).sort();
    const topTerms = topClusterTerms(indices, models, 6);
    const signatureHash = hashText(sortedNoteIds.join('|'));
    const islandId = `ctx:${worldId || 'global'}:global:${signatureHash}`;
    const folder = dominantFolder(indices, models);
    const score = clusterEvidenceScore(indices, pairs);

    return {
        id: islandId,
        worldId,
        narrativeId: '',
        kind: 'global_derived',
        label: labelIsland(topTerms, folder),
        anchorFolderId: folder.id,
        anchorFolderPath: folder.path,
        noteCount: indices.length,
        blockCount: indices.reduce((total, index) => total + models[index].blockCount, 0),
        topTerms,
        signatureHash,
        generation,
        createdAt: now,
        updatedAt: now,
        evidence: {
            folderScore: score.folderScore,
            lexicalScore: score.lexicalScore,
            bridgeScore: 0,
        },
    };
}

function buildMembership(
    island: ContextIsland,
    index: number,
    cluster: number[],
    models: NoteModel[],
    pairs: Map<string, PairScore>,
    options: DerivationOptions,
    generation: number,
    now: number,
): ContextIslandMembership {
    let maxPairScore = 0;
    let folderPrior = 0;
    for (const other of cluster) {
        if (other === index) {
            continue;
        }
        const pair = pairs.get(pairKey(index, other));
        if (!pair) {
            continue;
        }
        const score = pair.lexicalScore + pair.folderScore;
        maxPairScore = Math.max(maxPairScore, score);
        folderPrior = Math.max(folderPrior, pair.folderScore);
    }
    const confidence = cluster.length === 1
        ? 0.55
        : clamp(0.58 + maxPairScore / (options.unionThreshold * 3), 0.58, 0.98);
    const model = models[index];
    return {
        id: `${island.id}:note:${model.note.id}`,
        islandId: island.id,
        noteId: model.note.id,
        worldId: model.note.worldId || '',
        narrativeId: '',
        folderId: model.note.folderId || '',
        confidence,
        primary: true,
        evidenceScore: maxPairScore,
        generation,
        updatedAt: now,
        evidence: {
            maxPairScore,
            tokenCount: model.features.length,
            folderPrior,
        },
    };
}

function buildBridges(
    worldId: string,
    models: NoteModel[],
    pairs: Map<string, PairScore>,
    union: UnionFind,
    islandByRoot: Map<number, ContextIsland>,
    options: DerivationOptions,
    generation: number,
    now: number,
): ContextIslandBridge[] {
    const bridgeMap = new Map<string, { source: ContextIsland; target: ContextIsland; score: number; lexical: number; folder: number; edges: number; terms: Map<string, number> }>();
    for (const pair of pairs.values()) {
        const leftRoot = union.find(pair.left);
        const rightRoot = union.find(pair.right);
        if (leftRoot === rightRoot) {
            continue;
        }
        const score = pair.lexicalScore + pair.folderScore;
        if (score < options.bridgeThreshold) {
            continue;
        }
        const leftIsland = islandByRoot.get(leftRoot)!;
        const rightIsland = islandByRoot.get(rightRoot)!;
        const source = leftIsland.id < rightIsland.id ? leftIsland : rightIsland;
        const target = source === leftIsland ? rightIsland : leftIsland;
        const key = `${source.id}|${target.id}`;
        let bridge = bridgeMap.get(key);
        if (!bridge) {
            bridge = { source, target, score: 0, lexical: 0, folder: 0, edges: 0, terms: new Map() };
            bridgeMap.set(key, bridge);
        }
        bridge.score += score;
        bridge.lexical += pair.lexicalScore;
        bridge.folder += pair.folderScore;
        bridge.edges += 1;
        for (const [term, termScore] of pair.terms) {
            bridge.terms.set(term, (bridge.terms.get(term) || 0) + termScore);
        }
    }

    return Array.from(bridgeMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, options.maxBridgeCount)
        .map(bridge => ({
            id: `ctxb:${hashText(`${bridge.source.id}|${bridge.target.id}`)}`,
            worldId,
            narrativeId: '',
            sourceIslandId: bridge.source.id,
            targetIslandId: bridge.target.id,
            confidence: clamp(bridge.score / (options.unionThreshold * 4), 0.2, 0.9),
            evidenceScore: bridge.score,
            sharedTerms: topTermsFromMap(bridge.terms, 5),
            generation,
            updatedAt: now,
            evidence: {
                edgeCount: bridge.edges,
                lexicalScore: bridge.lexical,
                folderScore: bridge.folder,
            },
        }));
}

function buildNoteModel(note: NoteInput, folder: FolderInfo, blocks: BlockInput[], options: DerivationOptions): NoteModel {
    const weights = new Map<string, number>();
    const budget = { remaining: options.maxTextCharsPerNote };
    addWeightedTokens(note.title || '', 4, weights, budget);
    for (const block of blocks.slice().sort((a, b) => a.ordinal - b.ordinal)) {
        addWeightedTokens(block.text, block.nodeType === 'heading' ? 2.8 : 1, weights, budget);
        if (budget.remaining <= 0) {
            break;
        }
    }
    if (!blocks.length && note.markdownContent) {
        addWeightedTokens(note.markdownContent, 1, weights, budget);
    }
    const features = Array.from(weights, ([token, weight]) => ({ token, weight: Math.min(weight, 12) }))
        .sort((a, b) => b.weight - a.weight || a.token.localeCompare(b.token))
        .slice(0, options.maxTokensPerNote)
        .sort((a, b) => a.token.localeCompare(b.token));
    return { note, folder, blockCount: blocks.length, features };
}

function dominantFolder(indices: number[], models: NoteModel[]): FolderInfo {
    const counts = new Map<string, { folder: FolderInfo; count: number }>();
    for (const index of indices) {
        const folder = models[index].folder;
        const key = folder.id || '';
        const row = counts.get(key);
        if (row) {
            row.count += 1;
        } else {
            counts.set(key, { folder, count: 1 });
        }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0]?.folder || {
        id: '',
        path: '',
        rootFolderId: '',
        rootFolderName: '',
        narrativeId: '',
    };
}

function topClusterTerms(indices: number[], models: NoteModel[], limit: number): string[] {
    const terms = new Map<string, number>();
    for (const index of indices) {
        for (const feature of models[index].features) {
            terms.set(feature.token, (terms.get(feature.token) || 0) + feature.weight);
        }
    }
    return topTermsFromMap(terms, limit);
}

function labelIsland(topTerms: string[], folder: FolderInfo): string {
    if (folder.path) {
        return folder.path;
    }
    return topTerms.slice(0, 3).map(term => term[0].toUpperCase() + term.slice(1)).join(' ') || 'Global Island';
}

function clusterEvidenceScore(indices: number[], pairs: Map<string, PairScore>): { lexicalScore: number; folderScore: number } {
    let lexicalScore = 0;
    let folderScore = 0;
    for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
            const pair = pairs.get(pairKey(indices[i], indices[j]));
            if (pair) {
                lexicalScore += pair.lexicalScore;
                folderScore += pair.folderScore;
            }
        }
    }
    return { lexicalScore, folderScore };
}
