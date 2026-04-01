export interface PhoenixDiscoveryCandidate {
    key: string;
    token: string;
    kind: string;
    score: number;
    count: number;
    status: number;
}

type DiscoveryMention = {
    source?: unknown;
    surface?: unknown;
    range?: { start?: number; end?: number };
    entityRef?: unknown;
    entity_ref?: unknown;
    kind?: unknown;
    confidence?: unknown;
};

type DiscoverySurfaceStats = {
    count: number;
    firstIndex: number;
};

type GroupedCandidateState = PhoenixDiscoveryCandidate & {
    firstIndex: number;
    surfaces: Map<string, DiscoverySurfaceStats>;
};

export function groupDiscoveryMentions(text: string, mentions: DiscoveryMention[]): PhoenixDiscoveryCandidate[] {
    const grouped = new Map<string, GroupedCandidateState>();

    mentions.forEach((mention, index) => {
        if (String(mention?.source || '').toLowerCase() !== 'discovery') {
            return;
        }

        const token = String(mention?.surface || sliceRange(text, mention?.range) || '').trim();
        const key = discoveryMentionKey(mention, text);
        if (!key || !token) {
            return;
        }

        const score = Number(mention?.confidence || 0);
        const kind = String(mention?.kind || 'UNKNOWN');
        const state = grouped.get(key) || {
            key,
            token,
            kind,
            score,
            count: 0,
            status: 0,
            firstIndex: index,
            surfaces: new Map<string, DiscoverySurfaceStats>(),
        };

        state.count += 1;
        state.score = Math.max(state.score, score);
        if (state.kind === 'UNKNOWN' && kind !== 'UNKNOWN') {
            state.kind = kind;
        }

        const surfaceStats = state.surfaces.get(token) || { count: 0, firstIndex: index };
        surfaceStats.count += 1;
        state.surfaces.set(token, surfaceStats);
        state.token = pickPreferredSurface(state.surfaces);
        grouped.set(key, state);
    });

    return Array.from(grouped.values())
        .map(({ surfaces: _surfaces, firstIndex: _firstIndex, ...candidate }) => candidate)
        .sort((left, right) =>
            right.count - left.count ||
            right.score - left.score ||
            left.token.localeCompare(right.token)
        );
}

export function normalizeDiscoveryCandidateKey(value: string): string {
    return String(value || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ');
}

export function coalesceDiscoveryCandidates<T extends PhoenixDiscoveryCandidate>(candidates: T[]): T[] {
    const grouped = new Map<string, T>();

    for (const candidate of candidates) {
        const key = normalizeDiscoveryCandidateKey(candidate.key || candidate.token);
        if (!key) {
            continue;
        }

        const current = grouped.get(key);
        if (!current) {
            grouped.set(key, { ...candidate, key });
            continue;
        }

        grouped.set(key, {
            ...current,
            key,
            token: pickPreferredToken(current.token, candidate.token),
            kind: pickPreferredKind(current.kind, candidate.kind),
            score: Math.max(Number(current.score || 0), Number(candidate.score || 0)),
            count: Number(current.count || 0) + Number(candidate.count || 0),
            status: Math.max(Number(current.status || 0), Number(candidate.status || 0)),
        });
    }

    return Array.from(grouped.values()).sort((left, right) =>
        right.count - left.count ||
        right.score - left.score ||
        left.token.localeCompare(right.token)
    );
}

function discoveryMentionKey(mention: DiscoveryMention, text: string): string {
    const entityRef = mention?.entityRef || mention?.entity_ref;
    const refKey = entityRefKey(entityRef);
    if (refKey) {
        return normalizeDiscoveryCandidateKey(refKey);
    }
    return normalizeDiscoveryCandidateKey(String(mention?.surface || sliceRange(text, mention?.range) || ''));
}

function entityRefKey(entityRef: unknown): string | null {
    if (typeof entityRef === 'string') {
        return entityRef;
    }
    if (entityRef && typeof entityRef === 'object') {
        const keyed = entityRef as Record<string, unknown>;
        if (typeof keyed['Known'] === 'string') return keyed['Known'];
        if (typeof keyed['known'] === 'string') return keyed['known'];
        if (typeof keyed['Speculative'] === 'string') return keyed['Speculative'];
        if (typeof keyed['speculative'] === 'string') return keyed['speculative'];
    }
    return null;
}

function pickPreferredSurface(surfaces: Map<string, DiscoverySurfaceStats>): string {
    let bestSurface = '';
    let bestStats: DiscoverySurfaceStats | null = null;

    for (const [surface, stats] of surfaces.entries()) {
        if (!bestStats) {
            bestSurface = surface;
            bestStats = stats;
            continue;
        }

        if (
            stats.count > bestStats.count ||
            (stats.count === bestStats.count && surface.length > bestSurface.length) ||
            (stats.count === bestStats.count &&
                surface.length === bestSurface.length &&
                stats.firstIndex < bestStats.firstIndex)
        ) {
            bestSurface = surface;
            bestStats = stats;
        }
    }

    return bestSurface;
}

function pickPreferredToken(current: string, incoming: string): string {
    const currentToken = String(current || '').trim();
    const incomingToken = String(incoming || '').trim();
    if (!currentToken) return incomingToken;
    if (!incomingToken) return currentToken;
    if (incomingToken.length > currentToken.length) {
        return incomingToken;
    }
    return currentToken;
}

function pickPreferredKind(current: string, incoming: string): string {
    const currentKind = String(current || 'UNKNOWN');
    const incomingKind = String(incoming || 'UNKNOWN');
    if (currentKind === 'UNKNOWN' && incomingKind !== 'UNKNOWN') {
        return incomingKind;
    }
    return currentKind;
}

function sliceRange(text: string, range: { start?: number; end?: number } | undefined): string {
    if (!range) {
        return '';
    }
    const start = Number(range.start);
    const end = Number(range.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return '';
    }
    return text.slice(start, end);
}
