export interface ContextIslandFolderInput {
    id: string;
    name: string;
    parentId: string;
    narrativeId: string;
    isNarrativeRoot: boolean;
}

export interface FolderInfo {
    id: string;
    path: string;
    rootFolderId: string;
    rootFolderName: string;
    narrativeId: string;
}

const STOP_WORDS = new Set([
    'about', 'after', 'again', 'against', 'also', 'and', 'another', 'because', 'been', 'before',
    'being', 'between', 'both', 'but', 'can', 'could', 'did', 'does', 'done', 'each', 'from',
    'had', 'has', 'have', 'her', 'here', 'him', 'his', 'into', 'its', 'just', 'more', 'most',
    'new', 'note', 'notes', 'not', 'now', 'one', 'only', 'our', 'out', 'over', 'same', 'she',
    'should', 'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they',
    'this', 'through', 'too', 'under', 'was', 'were', 'when', 'where', 'which', 'while', 'with',
    'world', 'would', 'you', 'your',
]);

export function addWeightedTokens(
    text: string,
    weight: number,
    weights: Map<string, number>,
    budget: { remaining: number },
): void {
    if (!text || budget.remaining <= 0) {
        return;
    }
    const slice = text.length > budget.remaining ? text.slice(0, budget.remaining) : text;
    budget.remaining -= slice.length;
    forEachToken(slice, token => {
        if (!STOP_WORDS.has(token)) {
            weights.set(token, (weights.get(token) || 0) + weight);
        }
    });
}

export function groupByKey<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const key = keyFn(item);
        const group = groups.get(key);
        if (group) {
            group.push(item);
        } else {
            groups.set(key, [item]);
        }
    }
    return groups;
}

export function getFolderInfo(
    folderId: string,
    folders: Map<string, ContextIslandFolderInput>,
    cache: Map<string, FolderInfo>,
): FolderInfo {
    if (!folderId) {
        return { id: '', path: '', rootFolderId: '', rootFolderName: '', narrativeId: '' };
    }
    const cached = cache.get(folderId);
    if (cached) {
        return cached;
    }
    const chain: ContextIslandFolderInput[] = [];
    const seen = new Set<string>();
    let currentId = folderId;
    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const folder = folders.get(currentId);
        if (!folder) {
            break;
        }
        chain.unshift(folder);
        currentId = folder.parentId || '';
    }
    const root = chain[0];
    const narrative = chain.find(folder => folder.narrativeId || folder.isNarrativeRoot);
    const info = {
        id: folderId,
        path: chain.map(folder => folder.name || folder.id).join(' / '),
        rootFolderId: root?.id || folderId,
        rootFolderName: root?.name || '',
        narrativeId: narrative?.narrativeId || '',
    };
    cache.set(folderId, info);
    return info;
}

export function topTermsFromMap(terms: Map<string, number>, limit: number): string[] {
    return Array.from(terms, ([term, score]) => ({ term, score }))
        .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
        .slice(0, limit)
        .map(row => row.term);
}

export function pairKey(left: number, right: number): string {
    return left < right ? `${left}:${right}` : `${right}:${left}`;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function forEachToken(text: string, visit: (token: string) => void): void {
    let start = -1;
    for (let i = 0; i <= text.length; i++) {
        const code = i < text.length ? text.charCodeAt(i) : 0;
        const isToken = isAsciiTokenChar(code);
        if (isToken && start < 0) {
            start = i;
        } else if (!isToken && start >= 0) {
            const token = normalizeToken(text.slice(start, i));
            if (token.length >= 3) {
                visit(token);
            }
            start = -1;
        }
    }
}

function normalizeToken(token: string): string {
    const normalized = token.toLowerCase();
    if (normalized.length > 5 && normalized.endsWith('s')) {
        return normalized.slice(0, -1);
    }
    return normalized;
}

function isAsciiTokenChar(code: number): boolean {
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export class UnionFind {
    private readonly parent: number[];
    private readonly rank: number[];

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, index) => index);
        this.rank = new Array(size).fill(0);
    }

    find(index: number): number {
        let root = index;
        while (this.parent[root] !== root) {
            root = this.parent[root];
        }
        while (this.parent[index] !== index) {
            const parent = this.parent[index];
            this.parent[index] = root;
            index = parent;
        }
        return root;
    }

    union(left: number, right: number): void {
        let leftRoot = this.find(left);
        let rightRoot = this.find(right);
        if (leftRoot === rightRoot) {
            return;
        }
        if (this.rank[leftRoot] < this.rank[rightRoot]) {
            [leftRoot, rightRoot] = [rightRoot, leftRoot];
        }
        this.parent[rightRoot] = leftRoot;
        if (this.rank[leftRoot] === this.rank[rightRoot]) {
            this.rank[leftRoot] += 1;
        }
    }
}
