import { entityColorStore } from '../../../../../lib/store/entityColorStore';

export type GalaxyLabelMode = 'hover' | 'selected' | 'important' | 'always' | 'off';
export type GalaxyEdgeMode = 'curved' | 'straight' | 'hidden';
export type GalaxyEdgeColorMode = 'cyan' | 'entityBlend' | 'confidence' | 'muted';
export type GalaxyBackgroundMode = 'nebula' | 'grid' | 'quiet' | 'void';
export type GalaxyNodeDragMode = 'stretch' | 'force' | 'camera';
export type GalaxyNodeShapeMode = 'halo' | 'sphere';

export interface GalaxyRenderSettings {
    labelMode: GalaxyLabelMode;
    edgeMode: GalaxyEdgeMode;
    edgeColorMode: GalaxyEdgeColorMode;
    glow: number;
    edgeOpacity: number;
    edgeWidth: number;
    edgeLength: number;
    edgeCurveStrength: number;
    nodeDistance: number;
    particleFlow: boolean;
    particleSize: number;
    particleSpeed: number;
    particleOpacity: number;
    autoRotate: boolean;
    backgroundMode: GalaxyBackgroundMode;
    nodeDragMode: GalaxyNodeDragMode;
    nodeShape: GalaxyNodeShapeMode;
    clickFocus: boolean;
    labelLimit: number;
    selectedPulse: boolean;
}

export interface GalaxyInputEdge {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    confidence: number;
}

export interface GalaxyQueryFocus {
    queryNodeId: string;
    primaryNodeIds: string[];
    secondaryNodeIds: string[];
    edgeIds: string[];
}

export interface GalaxyRenderableNode {
    id: string;
    label: string;
    kind: string;
    aliases?: string[];
    totalMentions?: number;
    atlasX?: number;
    atlasY?: number;
    atlasZ?: number;
    colorHsl?: string;
    metadata?: Record<string, unknown> & {
        sourceEntityId?: string;
        galaxyId?: string;
        galaxyRole?: 'primary' | 'context';
        galaxyOffset?: { x: number; y: number; z: number };
        galaxyOpacity?: number;
    };
}

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export interface GalaxyNode extends Rgb {
    entity: GalaxyRenderableNode;
    x: number;
    y: number;
    z: number;
    baseX: number;
    baseY: number;
    baseZ: number;
    radius: number;
    sx: number;
    sy: number;
    depth: number;
    galaxyOpacity: number;
}

export interface GalaxyEdge {
    id: string;
    source: number;
    target: number;
    type: string;
    confidence: number;
    alpha: number;
    curve: number;
    flowOffset: number;
}

export interface GalaxyScene {
    nodes: GalaxyNode[];
    links: GalaxyEdge[];
}

export const DEFAULT_GALAXY_SETTINGS: GalaxyRenderSettings = {
    labelMode: 'hover',
    edgeMode: 'curved',
    edgeColorMode: 'cyan',
    glow: 1,
    edgeOpacity: 0.58,
    edgeWidth: 0.62,
    edgeLength: 1,
    edgeCurveStrength: 1.4,
    nodeDistance: 1,
    particleFlow: false,
    particleSize: 1,
    particleSpeed: 1,
    particleOpacity: 0.72,
    autoRotate: false,
    backgroundMode: 'nebula',
    nodeDragMode: 'stretch',
    nodeShape: 'halo',
    clickFocus: true,
    labelLimit: 14,
    selectedPulse: true,
};

export function mergeGalaxySettings(settings?: Partial<GalaxyRenderSettings> | null): GalaxyRenderSettings {
    return { ...DEFAULT_GALAXY_SETTINGS, ...settings };
}

export function buildGalaxyScene(
    entitiesInput: GalaxyRenderableNode[],
    edges: GalaxyInputEdge[],
    settings: GalaxyRenderSettings,
): GalaxyScene {
    const entities = prioritizeEntities(entitiesInput);
    const idToIndex = new Map<string, number>();
    const nodes = entities.map((entity, index) => {
        idToIndex.set(entity.id, index);
        const total = Math.max(1, entities.length);
        const seeded = hasAtlasSeed(entity);
        const y = 1 - (index / Math.max(1, total - 1)) * 2;
        const radial = Math.sqrt(Math.max(0, 1 - y * y));
        const angle = index * 2.399963229728653 + stableUnit(entity.id) * 0.48;
        const kindBias = stableUnit(String(entity.kind)) - 0.5;
        const x = seeded ? clamp(entity.atlasX!, -2.25, 2.25) : Math.cos(angle) * radial * 1.05 + kindBias * 0.18;
        const yy = seeded ? clamp(entity.atlasY!, -1.85, 1.85) : y * 0.74 + (stableUnit(`${entity.id}:y`) - 0.5) * 0.12;
        const z = seeded ? clamp(entity.atlasZ!, -2.25, 2.25) : Math.sin(angle) * radial * 0.95 + kindBias * 0.26;
        return {
            entity,
            x,
            y: yy,
            z,
            baseX: x,
            baseY: yy,
            baseZ: z,
            radius: Math.min(5.8, 2.1 + Math.sqrt(Math.max(1, entity.totalMentions || 1)) * 0.32),
            ...hslToRgb(entity.colorHsl || entityColorStore.getRawHsl(entity.kind as any)),
            sx: 0,
            sy: 0,
            depth: 0,
            galaxyOpacity: Number(entity.metadata?.galaxyOpacity ?? 1),
        };
    });

    const links = buildLinks(edges, idToIndex);
    relaxNodes(nodes, links, settings);
    applyGalaxyMetadata(nodes);
    return { nodes, links };
}

function hasAtlasSeed(entity: GalaxyRenderableNode): boolean {
    return Number.isFinite(entity.atlasX) && Number.isFinite(entity.atlasY) && Number.isFinite(entity.atlasZ);
}

export function stableUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function buildLinks(edges: GalaxyInputEdge[], idToIndex: Map<string, number>): GalaxyEdge[] {
    const seen = new Set<string>();
    const links: GalaxyEdge[] = [];
    const maxLinks = Math.min(900, Math.max(180, idToIndex.size * 5));
    for (const edge of edges) {
        const source = idToIndex.get(edge.sourceId);
        const target = idToIndex.get(edge.targetId);
        if (source === undefined || target === undefined || source === target) {
            continue;
        }
        const key = source < target ? `${source}:${target}` : `${target}:${source}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        links.push({
            id: edge.id,
            source,
            target,
            type: edge.type,
            confidence: edge.confidence,
            alpha: Math.min(0.34, 0.052 + Math.max(0, edge.confidence) * 0.045),
            curve: (stableUnit(`${edge.id}:curve`) - 0.5) * 1.35,
            flowOffset: stableUnit(`${edge.id}:flow`),
        });
        if (links.length >= maxLinks) {
            break;
        }
    }
    return links;
}

function relaxNodes(nodes: GalaxyNode[], links: GalaxyEdge[], settings: GalaxyRenderSettings): void {
    const count = nodes.length;
    if (count < 3) {
        return;
    }
    const vx = new Float32Array(count);
    const vy = new Float32Array(count);
    const vz = new Float32Array(count);
    const targetLength = 0.34 + settings.edgeLength * 0.84;
    const repel = 0.012 * settings.nodeDistance;
    const spring = 0.026;
    const ticks = count > 220 ? 24 : count > 160 ? 32 : count > 96 ? 44 : 64;

    for (let tick = 0; tick < ticks; tick++) {
        for (const link of links) {
            const a = nodes[link.source];
            const b = nodes[link.target];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dz = b.z - a.z;
            const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
            const force = (dist - targetLength) * spring;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            const fz = (dz / dist) * force;
            vx[link.source] += fx;
            vy[link.source] += fy;
            vz[link.source] += fz;
            vx[link.target] -= fx;
            vy[link.target] -= fy;
            vz[link.target] -= fz;
        }

        for (let left = 0; left < count; left++) {
            for (let right = left + 1; right < count; right++) {
                const a = nodes[left];
                const b = nodes[right];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dz = b.z - a.z;
                const dist2 = Math.max(0.018, dx * dx + dy * dy + dz * dz);
                const force = repel / dist2;
                vx[left] -= dx * force;
                vy[left] -= dy * force;
                vz[left] -= dz * force;
                vx[right] += dx * force;
                vy[right] += dy * force;
                vz[right] += dz * force;
            }
        }

        for (let index = 0; index < count; index++) {
            const node = nodes[index];
            node.x = clamp(node.x + vx[index], -2.25, 2.25);
            node.y = clamp(node.y + vy[index], -1.85, 1.85);
            node.z = clamp(node.z + vz[index], -2.25, 2.25);
            node.baseX = node.x;
            node.baseY = node.y;
            node.baseZ = node.z;
            vx[index] *= 0.72;
            vy[index] *= 0.72;
            vz[index] *= 0.72;
        }
    }
}

function applyGalaxyMetadata(nodes: GalaxyNode[]): void {
    for (const node of nodes) {
        const offset = node.entity.metadata?.galaxyOffset;
        if (offset) {
            node.x += offset.x;
            node.y += offset.y;
            node.z += offset.z;
            node.baseX += offset.x;
            node.baseY += offset.y;
            node.baseZ += offset.z;
        }
        if (node.entity.metadata?.galaxyRole === 'context') {
            node.radius *= 0.82;
        }
    }
}

function prioritizeEntities(entities: GalaxyRenderableNode[]): GalaxyRenderableNode[] {
    const maxNodes =
        entities.length > 1200 ? 180 :
        entities.length > 640 ? 210 :
        entities.length > 320 ? 240 : 260;
    return [...entities]
        .sort((left, right) => entityPriority(right) - entityPriority(left) || left.label.localeCompare(right.label))
        .slice(0, maxNodes);
}

function entityPriority(entity: GalaxyRenderableNode): number {
    const mentions = Math.max(1, Number(entity.totalMentions || 1));
    return (hasAtlasSeed(entity) ? 100000 : 0) + mentions;
}

export function hslToRgb(rawHsl: string): Rgb {
    const values = rawHsl.match(/-?\d+(?:\.\d+)?/g)?.map((part) => Number(part)) ?? [];
    const [h = 190, s = 70, l = 55] = values;
    const hue = ((h % 360) + 360) % 360;
    const saturation = clamp(s / 100, 0, 1);
    const lightness = clamp(l / 100, 0, 1);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = lightness - chroma / 2;
    const [red, green, blue] =
        hue < 60 ? [chroma, x, 0] :
            hue < 120 ? [x, chroma, 0] :
                hue < 180 ? [0, chroma, x] :
                    hue < 240 ? [0, x, chroma] :
                        hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
    return {
        r: Math.round((red + match) * 255),
        g: Math.round((green + match) * 255),
        b: Math.round((blue + match) * 255),
    };
}
