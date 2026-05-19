import type { AtlasManifoldMode } from '../../../../../services/manifold-atlas.types';

export interface ProjectionRefreshSummary {
    readonly kind?: string;
    readonly details?: Record<string, unknown>;
}

export function projectionSummaryRequestsRefresh(
    summary: ProjectionRefreshSummary | null,
    manifold: AtlasManifoldMode,
): boolean {
    if (!summary) return false;
    if (summary.kind === 'atlas-rich-scan') {
        return scanSummaryHasSemanticAtlas(summary);
    }
    if (summary.kind !== 'manifold-load') return false;
    const details = summary.details ?? {};
    if (details['owner'] === 'graph-atlas-preview') return false;
    return String(details['manifold'] || '') === manifold;
}

function scanSummaryHasSemanticAtlas(summary: ProjectionRefreshSummary): boolean {
    const semanticIncluded = summary.details?.['includeSemanticAtlas'];
    if (semanticIncluded === false) return false;
    if (semanticIncluded === true) return true;
    const counts = summary.details?.['embeddingCounts'];
    if (!counts || typeof counts !== 'object') return false;
    return Object.values(counts as Record<string, unknown>).some((value) => Number(value) > 0);
}
