import { entityColorStore } from '../../../../../lib/store/entityColorStore';

export type GalaxyLabelMode = 'hover' | 'selected' | 'important' | 'always' | 'off';
export type GalaxyEdgeMode = 'curved' | 'straight' | 'hidden';
export type GalaxyEdgeColorMode = 'aqua' | 'orchid' | 'gold' | 'entityBlend' | 'confidence' | 'muted' | 'cyan';
export type GalaxyBackgroundMode = 'nebula' | 'grid' | 'quiet' | 'void';
export type GalaxyNodeDragMode = 'stretch' | 'force' | 'pin' | 'camera';
export type GalaxyNodeShapeMode = 'atom' | 'halo' | 'sphere';
export type GalaxyLayoutMode = 'single' | 'multiGalaxy' | 'hybridSpace';

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
    layoutMode: GalaxyLayoutMode;
    hybridShellVisible: boolean;
    hybridShellOpacity: number;
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
        sourceId?: string;
        sourceTitle?: string;
        sourceType?: string;
        noteId?: string;
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
    groupId?: string;
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
    interGalaxy?: boolean;
}

export interface GalaxyGroup extends Rgb {
    id: string;
    label: string;
    kind: 'note' | 'folder' | 'narrative' | 'semantic-cluster' | 'entity-cluster' | 'query' | 'other';
    center: { x: number; y: number; z: number };
    radius: number;
    nodeIds: string[];
    importance: number;
}

export interface GalaxyScene {
    nodes: GalaxyNode[];
    links: GalaxyEdge[];
    layoutMode: GalaxyLayoutMode;
    groups: GalaxyGroup[];
}

export const DEFAULT_GALAXY_SETTINGS: GalaxyRenderSettings = {
    labelMode: 'hover',
    edgeMode: 'curved',
    edgeColorMode: 'entityBlend',
    glow: 1,
    edgeOpacity: 0.34,
    edgeWidth: 0.45,
    edgeLength: 1,
    edgeCurveStrength: 0.55,
    nodeDistance: 1,
    particleFlow: false,
    particleSize: 1,
    particleSpeed: 1,
    particleOpacity: 0.72,
    autoRotate: false,
    backgroundMode: 'nebula',
    nodeDragMode: 'stretch',
    nodeShape: 'atom',
    clickFocus: true,
    labelLimit: 14,
    selectedPulse: true,
    layoutMode: 'single',
    hybridShellVisible: true,
    hybridShellOpacity: 1,
};

export function mergeGalaxySettings(settings?: Partial<GalaxyRenderSettings> | null): GalaxyRenderSettings {
    const merged = { ...DEFAULT_GALAXY_SETTINGS, ...settings };
    if (merged.edgeColorMode === 'cyan') merged.edgeColorMode = 'aqua';
    merged.edgeCurveStrength = Math.min(1.2, Math.max(0.25, merged.edgeCurveStrength));
    merged.edgeWidth = Math.min(1.1, Math.max(0.15, merged.edgeWidth));
    merged.hybridShellOpacity = Math.min(1, Math.max(0, merged.hybridShellOpacity));
    return merged;
}

export function buildGalaxyScene(
    entitiesInput: GalaxyRenderableNode[],
    edges: GalaxyInputEdge[],
    settings: GalaxyRenderSettings,
): GalaxyScene {
    const entities = prioritizeEntities(entitiesInput);
    const preserveAtlasLayout = shouldPreserveAtlasLayout(entities);
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
    if (settings.layoutMode === 'hybridSpace') {
        applyGalaxyMetadata(nodes);
        applyHybridSpaceLayout(nodes, links);
        return { nodes, links, layoutMode: 'hybridSpace', groups: [] };
    }

    const groupPlan = settings.layoutMode === 'multiGalaxy' ? buildGroupPlan(nodes) : [];
    if (groupPlan.length > 1) {
        applyGalaxyMetadata(nodes);
        const groups = applyMultiGalaxyLayout(nodes, links, groupPlan);
        return { nodes, links, layoutMode: 'multiGalaxy', groups };
    }

    if (!preserveAtlasLayout) {
        relaxNodes(nodes, links, settings);
    }
    applyGalaxyMetadata(nodes);
    return { nodes, links, layoutMode: 'single', groups: [] };
}

function hasAtlasSeed(entity: GalaxyRenderableNode): boolean {
    return Number.isFinite(entity.atlasX) && Number.isFinite(entity.atlasY) && Number.isFinite(entity.atlasZ);
}

function shouldPreserveAtlasLayout(entities: GalaxyRenderableNode[]): boolean {
    return entities.length > 0 && entities.every(hasAtlasSeed);
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

interface GalaxyGroupPlan {
    id: string;
    label: string;
    kind: GalaxyGroup['kind'];
    indexes: number[];
}

function buildGroupPlan(nodes: GalaxyNode[]): GalaxyGroupPlan[] {
    const groups = new Map<string, GalaxyGroupPlan>();
    for (let index = 0; index < nodes.length; index++) {
        const info = groupInfoForNode(nodes[index].entity);
        let group = groups.get(info.id);
        if (!group) {
            group = { ...info, indexes: [] };
            groups.set(info.id, group);
        }
        group.indexes.push(index);
    }

    const ordered = [...groups.values()]
        .sort((left, right) => right.indexes.length - left.indexes.length || left.label.localeCompare(right.label));
    const keep = ordered.slice(0, 24);
    const overflow = ordered.slice(24);
    if (overflow.length) {
        keep.push({
            id: 'group:other-sources',
            label: 'Other Sources',
            kind: 'other',
            indexes: overflow.flatMap((group) => group.indexes),
        });
    }
    return keep.filter((group) => group.indexes.length > 0);
}

function groupInfoForNode(entity: GalaxyRenderableNode): Pick<GalaxyGroupPlan, 'id' | 'label' | 'kind'> {
    const metadata = entity.metadata || {};
    const sourceType = String(metadata.sourceType || '').toLowerCase();
    if (sourceType === 'query') {
        return { id: 'group:query', label: 'Query Trace', kind: 'query' };
    }

    const noteId = stringValue(metadata.noteId) || (sourceType === 'doc' ? stringValue(metadata.sourceId) : '');
    if (noteId) {
        const title = stringValue(metadata.sourceTitle) || sourceTitleFromLabel(entity.label) || `Note ${noteId.slice(0, 6)}`;
        return { id: `note:${noteId}`, label: title, kind: 'note' };
    }

    if (sourceType === 'entity') {
        return { id: 'group:registry-anchors', label: 'Registry Anchors', kind: 'entity-cluster' };
    }

    if (sourceType) {
        return { id: `source:${sourceType}`, label: titleCase(sourceType), kind: 'semantic-cluster' };
    }

    return { id: `kind:${entity.kind || 'unknown'}`, label: titleCase(entity.kind || 'Other'), kind: 'other' };
}

function applyMultiGalaxyLayout(nodes: GalaxyNode[], links: GalaxyEdge[], plans: GalaxyGroupPlan[]): GalaxyGroup[] {
    const groupByNode = new Map<number, GalaxyGroupPlan>();
    for (const group of plans) {
        for (const index of group.indexes) groupByNode.set(index, group);
    }

    const count = plans.length;
    const centerRadius = clamp(2.16 + Math.sqrt(count) * 0.22, 2.35, 3.35);
    const groups: GalaxyGroup[] = plans.map((group, index) => {
        const center = fibonacciSpherePoint(index, count, centerRadius, stableUnit(group.id));
        const radius = clamp(0.46 + Math.sqrt(group.indexes.length) * 0.035, 0.5, 0.86);
        const color = groupColor(group.id, index);
        return {
            id: group.id,
            label: group.label,
            kind: group.kind,
            center,
            radius,
            nodeIds: group.indexes.map((nodeIndex) => nodes[nodeIndex].entity.id),
            importance: group.indexes.length,
            ...color,
        };
    });
    const groupMeta = new Map(groups.map((group) => [group.id, group]));

    for (const [index, node] of nodes.entries()) {
        const plan = groupByNode.get(index);
        const group = plan ? groupMeta.get(plan.id) : undefined;
        if (!group) continue;
        node.groupId = group.id;
        const norm = Math.hypot(node.x, node.y, node.z);
        const fallback = stableVector(node.entity.id);
        const localScale = group.radius / Math.max(1.35, norm || 1.35);
        const lx = norm > 0.001 ? node.x * localScale : fallback.x * group.radius * 0.32;
        const ly = norm > 0.001 ? node.y * localScale : fallback.y * group.radius * 0.32;
        const lz = norm > 0.001 ? node.z * localScale : fallback.z * group.radius * 0.32;
        node.x = group.center.x + lx;
        node.y = group.center.y + ly;
        node.z = group.center.z + lz;
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
        node.radius *= plan?.kind === 'query' ? 1.05 : 0.86;
    }

    for (const link of links) {
        const sourceGroup = nodes[link.source]?.groupId;
        const targetGroup = nodes[link.target]?.groupId;
        link.interGalaxy = Boolean(sourceGroup && targetGroup && sourceGroup !== targetGroup);
        if (link.interGalaxy) {
            link.alpha = Math.min(0.42, link.alpha * 1.28 + 0.035);
            link.curve *= 1.3;
        }
    }

    return groups;
}

const HYBRID_SHELL_RADIUS = 2.32;

function applyHybridSpaceLayout(nodes: GalaxyNode[], links: GalaxyEdge[]): void {
    for (const node of nodes) {
        const direction = normalizedDirection(node);
        const radius = hybridRadius(node);
        node.x = direction.x * radius * HYBRID_SHELL_RADIUS;
        node.y = direction.y * radius * HYBRID_SHELL_RADIUS;
        node.z = direction.z * radius * HYBRID_SHELL_RADIUS;
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
        node.depth = radius;
        node.radius *= hybridNodeScale(node, radius);
    }

    for (const link of links) {
        const source = nodes[link.source];
        const target = nodes[link.target];
        const radialDelta = Math.abs((source?.depth || 0.68) - (target?.depth || 0.68));
        link.alpha = Math.min(0.38, link.alpha * (1.08 + radialDelta * 0.35));
        link.curve *= 0.78 + radialDelta * 0.9;
    }
}

function normalizedDirection(node: GalaxyNode): { x: number; y: number; z: number } {
    const x = Number.isFinite(node.entity.atlasX) ? Number(node.entity.atlasX) : node.x;
    const y = Number.isFinite(node.entity.atlasY) ? Number(node.entity.atlasY) : node.y;
    const z = Number.isFinite(node.entity.atlasZ) ? Number(node.entity.atlasZ) : node.z;
    const norm = Math.hypot(x, y, z);
    if (norm > 0.0001) return { x: x / norm, y: y / norm, z: z / norm };
    return stableVector(node.entity.id);
}

function hybridRadius(node: GalaxyNode): number {
    const metadata = node.entity.metadata || {};
    const sourceType = String(metadata.sourceType || '').toLowerCase();
    const tokenCount = Number(metadata['tokenCount'] || 0);
    const mentions = Math.max(1, Number(node.entity.totalMentions || 1));

    if (sourceType === 'query') return 1.015;
    if (sourceType === 'leaf') return clamp(0.982 + Math.min(0.018, Math.log1p(Math.max(1, tokenCount)) * 0.002), 0.982, 1.0);
    if (sourceType === 'doc') return clamp(0.974 + Math.min(0.026, Math.log1p(Math.max(1, tokenCount)) * 0.0025), 0.974, 1.0);
    if (sourceType === 'entity') return clamp(0.58 + Math.min(0.24, Math.log1p(mentions) * 0.075), 0.58, 0.82);
    if (node.entity.kind?.toLowerCase().includes('folder')) return 0.38;
    if (node.entity.kind?.toLowerCase().includes('narrative')) return 0.28;
    return 0.94;
}

function hybridNodeScale(node: GalaxyNode, radius: number): number {
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    if (sourceType === 'query') return 1.18;
    if (sourceType === 'entity') return 0.98;
    return 0.78 + radius * 0.18;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function sourceTitleFromLabel(label: string): string {
    const [first] = label.split(/[>/:]/).map((part) => part.trim()).filter(Boolean);
    return first || label;
}

function titleCase(value: string): string {
    return value
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fibonacciSpherePoint(index: number, total: number, radius: number, phase: number): { x: number; y: number; z: number } {
    if (total <= 1) return { x: 0, y: 0, z: 0 };
    const y = 1 - (index / Math.max(1, total - 1)) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = (index + phase * 0.37) * 2.399963229728653;
    return {
        x: Math.cos(angle) * radial * radius,
        y: y * radius * 0.58,
        z: Math.sin(angle) * radial * radius,
    };
}

function stableVector(id: string): { x: number; y: number; z: number } {
    const a = stableUnit(`${id}:a`) * Math.PI * 2;
    const y = stableUnit(`${id}:y`) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    return { x: Math.cos(a) * radial, y, z: Math.sin(a) * radial };
}

function groupColor(id: string, index: number): Rgb {
    const palette = [184, 198, 262, 172, 288, 42, 216, 326];
    const hue = palette[index % palette.length] + (stableUnit(id) - 0.5) * 18;
    return hslToRgb(`${hue} 76% 58%`);
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
