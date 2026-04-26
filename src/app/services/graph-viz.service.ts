import { Injectable } from '@angular/core';

import type { EntityKind } from '../lib/Scanner/types';
import { entityColorStore } from '../lib/store/entityColorStore';
import type { KnowledgeGraphData } from './phoenix-ui-api.service';

export interface GraphNode {
    id: string;
    name: string;
    val?: number;
    color?: string;
    kind?: string;
    group?: number;
    narrativeId?: string;
}

export interface GraphLink {
    source: string;
    target: string;
    type?: string;
    color?: string;
    curvature?: number;
    value?: number;
}

export interface ForceGraphData {
    nodes: GraphNode[];
    links: GraphLink[];
    stats?: GraphStats;
}

export interface GraphStats {
    totalNodes: number;
    totalLinks: number;
    kindCounts: Record<string, number>;
    typeCounts: Record<string, number>;
}

const KIND_TO_GROUP: Record<string, number> = {
    CHARACTER: 1,
    NPC: 1,
    CREATURE: 1,
    LOCATION: 2,
    FACTION: 3,
    ORGANIZATION: 3,
    NETWORK: 3,
    ITEM: 4,
    EVENT: 5,
    SCENE: 5,
    BEAT: 5,
    CONCEPT: 6,
    NARRATIVE: 7,
    ARC: 7,
    ACT: 7,
    CHAPTER: 7,
    TIMELINE: 8,
    CUSTOM: 9,
    UNKNOWN: 0,
};

function hslToHex(hslString: string): string {
    const parts = hslString.split(' ');
    if (parts.length < 3) {
        return '#64748b';
    }

    const h = Number.parseFloat(parts[0]) / 360;
    const s = Number.parseFloat(parts[1].replace('%', '')) / 100;
    const l = Number.parseFloat(parts[2].replace('%', '')) / 100;

    if (s === 0) {
        const gray = toHex(l * 255);
        return `#${gray}${gray}${gray}`;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hueToRgb(p, q, h + 1 / 3);
    const g = hueToRgb(p, q, h);
    const b = hueToRgb(p, q, h - 1 / 3);
    return `#${toHex(r * 255)}${toHex(g * 255)}${toHex(b * 255)}`;
}

function hueToRgb(p: number, q: number, t: number): number {
    let hue = t;
    if (hue < 0) hue += 1;
    if (hue > 1) hue -= 1;
    if (hue < 1 / 6) return p + (q - p) * 6 * hue;
    if (hue < 1 / 2) return q;
    if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
    return p;
}

function toHex(value: number): string {
    const hex = Math.round(value).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
}

@Injectable({ providedIn: 'root' })
export class GraphVizService {
    private readonly colorCache = new Map<string, string>();

    getNodeColor(kind: string): string {
        const normalizedKind = kind?.toUpperCase() || 'UNKNOWN';
        const cached = this.colorCache.get(normalizedKind);
        if (cached) {
            return cached;
        }

        const hsl = entityColorStore.getRawHsl(normalizedKind as EntityKind);
        const hex = hslToHex(hsl);
        this.colorCache.set(normalizedKind, hex);
        return hex;
    }

    getEdgeColor(_type?: string): string {
        return '#94a3b8';
    }

    refreshColors(): void {
        this.colorCache.clear();
    }

    fromKnowledgeGraph(graphData: KnowledgeGraphData): ForceGraphData {
        const nodes: GraphNode[] = [];
        const links: GraphLink[] = [];
        const kindCounts: Record<string, number> = {};
        const typeCounts: Record<string, number> = {};
        const nodeIds = new Set<string>();

        for (const [id, node] of Object.entries(graphData.nodes || {})) {
            const label = String((node as any).Label || node.label || id);
            const kind = String((node as any).Kind || node.kind || 'UNKNOWN').toUpperCase();
            kindCounts[kind] = (kindCounts[kind] || 0) + 1;
            nodeIds.add(id);

            nodes.push({
                id,
                name: label,
                kind,
                val: 3,
                color: this.getNodeColor(kind),
                group: KIND_TO_GROUP[kind] ?? 0,
            });
        }

        for (const edge of graphData.edges || []) {
            const sourceId = String((edge as any).Source || edge.source || '');
            const targetId = String((edge as any).Target || edge.target || '');
            const edgeType = String((edge as any).Type || (edge as any).type || edge.relation || 'RELATED_TO').toUpperCase();
            const confidence = Number((edge as any).Confidence ?? (edge as any).confidence ?? edge.weight ?? 1);
            typeCounts[edgeType] = (typeCounts[edgeType] || 0) + 1;

            if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
                console.warn(`[GraphVizService] Skipping edge: ${sourceId} -> ${targetId} (node not found)`);
                continue;
            }

            links.push({
                source: sourceId,
                target: targetId,
                type: edgeType,
                color: this.getEdgeColor(edgeType),
                value: confidence,
            });
        }

        return {
            nodes,
            links,
            stats: {
                totalNodes: nodes.length,
                totalLinks: links.length,
                kindCounts,
                typeCounts,
            },
        };
    }
}
