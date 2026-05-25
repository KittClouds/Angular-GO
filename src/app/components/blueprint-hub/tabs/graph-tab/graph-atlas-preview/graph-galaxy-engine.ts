import {
    entityColorStore,
    normalizeGraphNodeColorKind,
    normalizeEntityKind,
} from '../../../../../lib/store/entityColorStore';
import { applyLorentzTreeLayout } from './graph-galaxy-lorentz-layout';

export type GalaxyLabelMode = 'hover' | 'selected' | 'important' | 'always' | 'off';
export type GalaxyEdgeMode = 'curved' | 'straight' | 'hidden';
export type GalaxyEdgeColorMode = 'aqua' | 'orchid' | 'gold' | 'entityBlend' | 'confidence' | 'muted' | 'cyan';
export type GalaxyBackgroundMode = 'nebula' | 'grid' | 'quiet' | 'void';
export type GalaxyNodeDragMode = 'stretch' | 'force' | 'pin' | 'camera';
export type GalaxyNodeShapeMode = 'atom' | 'halo' | 'sphere';
export type GalaxyLayoutMode = 'single' | 'multiGalaxy' | 'hybridSpace' | 'hopfProjection' | 'lorentzTree' | 'productManifold';
export type GalaxyEmbeddingTopologyMode = 'off' | 'clusters' | 'regions' | 'lanes' | 'medoids' | 'outliers' | 'backbone' | 'bridges';

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
    hopfSpaceVisible: boolean;
    hopfSpaceIntensity: number;
    lorentzSpaceVisible: boolean;
    lorentzSpaceIntensity: number;
    productKleinVisible: boolean;
    embeddingTopologyMode: GalaxyEmbeddingTopologyMode;
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
        sourceSystem?: string;
        graphColorKind?: string;
        graphRelationFamily?: string;
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

export interface GalaxyHopfRibbon extends Rgb {
    id: string;
    nodeIds: string[];
    positions3d: Float32Array;
    importance: number;
    guideKind: 'dataFiber' | 'spaceFiber' | 'torusBand' | 'axis';
    guideWeight: number;
}

export interface GalaxyLorentzGuide extends Rgb {
    id: string;
    nodeIds: string[];
    positions3d: Float32Array;
    importance: number;
    treeId: string;
    treeKind: string;
    level: number;
    guideKind: 'membership' | 'rootLane' | 'levelShell' | 'wAxis';
    guideWeight: number;
}

export interface GalaxyScene {
    nodes: GalaxyNode[];
    links: GalaxyEdge[];
    layoutMode: GalaxyLayoutMode;
    groups: GalaxyGroup[];
    hopfRibbons?: GalaxyHopfRibbon[];
    lorentzGuides?: GalaxyLorentzGuide[];
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
    clickFocus: false,
    labelLimit: 14,
    selectedPulse: true,
    layoutMode: 'single',
    hybridShellVisible: true,
    hybridShellOpacity: 1,
    hopfSpaceVisible: true,
    hopfSpaceIntensity: 1,
    lorentzSpaceVisible: true,
    lorentzSpaceIntensity: 1,
    productKleinVisible: true,
    embeddingTopologyMode: 'off',
};

export function mergeGalaxySettings(settings?: Partial<GalaxyRenderSettings> | null): GalaxyRenderSettings {
    const merged = { ...DEFAULT_GALAXY_SETTINGS, ...settings };
    if (merged.edgeColorMode === 'cyan') merged.edgeColorMode = 'aqua';
    merged.edgeCurveStrength = Math.min(1.2, Math.max(0.25, merged.edgeCurveStrength));
    merged.edgeWidth = Math.min(1.1, Math.max(0.15, merged.edgeWidth));
    merged.hybridShellOpacity = Math.min(1, Math.max(0, merged.hybridShellOpacity));
    merged.hopfSpaceIntensity = Math.min(1.4, Math.max(0, merged.hopfSpaceIntensity));
    merged.lorentzSpaceIntensity = Math.min(1.4, Math.max(0, merged.lorentzSpaceIntensity));
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
            ...hslToRgb(resolveGalaxyNodeColorHsl(entity)),
            sx: 0,
            sy: 0,
            depth: 0,
            galaxyOpacity: Number(entity.metadata?.galaxyOpacity ?? 1),
        };
    });

    const links = buildLinks(edges, idToIndex);
    applyEmbeddingTopologyLens(nodes, links, settings);
    if (settings.layoutMode === 'hybridSpace') {
        applyGalaxyMetadata(nodes);
        applyHybridSpaceLayout(nodes, links);
        return { nodes, links, layoutMode: 'hybridSpace', groups: [] };
    }

    if (settings.layoutMode === 'hopfProjection') {
        applyGalaxyMetadata(nodes);
        const hopfRibbons = applyHopfProjectionLayout(nodes, links);
        return { nodes, links, layoutMode: 'hopfProjection', groups: [], hopfRibbons };
    }

    if (settings.layoutMode === 'lorentzTree') {
        applyGalaxyMetadata(nodes);
        const lorentzGuides = applyLorentzTreeLayout(nodes, links);
        return { nodes, links, layoutMode: 'lorentzTree', groups: [], lorentzGuides };
    }

    if (settings.layoutMode === 'productManifold') {
        applyGalaxyMetadata(nodes);
        const lorentzGuides = applyLorentzTreeLayout(nodes, links, { productTopologyGeometry: true });
        const hopfNodes = productHopfProjectionNodes(nodes, links);
        const hopfLinks = links.map((link) => ({ ...link }));
        const hopfRibbons = applyHopfProjectionLayout(hopfNodes, hopfLinks);
        return { nodes, links, layoutMode: 'productManifold', groups: [], hopfRibbons, lorentzGuides };
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

function applyEmbeddingTopologyLens(
    nodes: GalaxyNode[],
    links: GalaxyEdge[],
    settings: GalaxyRenderSettings,
): void {
    const mode = settings.embeddingTopologyMode;
    if (mode === 'off') return;
    const incident = topologyIncidentIndexes(nodes, links, mode);
    for (const [index, node] of nodes.entries()) {
        const meta = node.entity.metadata || {};
        const isMedoid = meta['embeddingMedoidTargetId'] === node.entity.id;
        const outlierScore = Number(meta['embeddingOutlierScore'] || 0);
        const hubScore = Number(meta['embeddingHubScore'] || 0);
        let boost = 0.72;
        if (mode === 'clusters' && meta['embeddingClusterId']) boost = 1 + Math.min(0.32, hubScore * 0.18);
        else if (mode === 'medoids') boost = isMedoid ? 1.55 : 0.62;
        else if (mode === 'outliers') boost = outlierScore >= 0.72 ? 1.72 : 0.54;
        else if (mode === 'regions') boost = productRegionBoost(String(meta['productRegionRole'] || ''));
        else if (mode === 'lanes') boost = 0.72 + productLaneWeight(meta) * 0.58;
        else if (incident.has(index)) boost = 1.32;
        node.radius *= boost;
        if (mode === 'clusters' && meta['embeddingClusterId']) {
            const color = hslToRgb(clusterLensHsl(String(meta['embeddingClusterId'])));
            node.r = Math.round(node.r * 0.58 + color.r * 0.42);
            node.g = Math.round(node.g * 0.58 + color.g * 0.42);
            node.b = Math.round(node.b * 0.58 + color.b * 0.42);
        } else if (mode === 'regions' && meta['productRegionRole']) {
            mixNodeColor(node, productRegionHsl(String(meta['productRegionRole'])), 0.48);
        } else if (mode === 'lanes' && meta['productLaneKind']) {
            mixNodeColor(node, productLaneHsl(String(meta['productLaneKind'])), 0.5);
        }
    }
    for (const link of links) {
        const role = embeddingEdgeRole(link);
        if (!role) {
            link.alpha *= mode === 'clusters' || mode === 'regions' || mode === 'lanes' ? 0.62 : 0.22;
            continue;
        }
        const selected = mode === 'backbone' && role === 'backbone'
            || mode === 'bridges' && role === 'bridge'
            || mode === 'clusters'
            || mode === 'regions'
            || mode === 'lanes';
        link.alpha = selected ? Math.min(0.5, link.alpha * 2.35 + 0.05) : link.alpha * 0.24;
        link.curve *= selected ? 1.12 : 0.72;
    }
}

function topologyIncidentIndexes(
    nodes: GalaxyNode[],
    links: GalaxyEdge[],
    mode: GalaxyEmbeddingTopologyMode,
): Set<number> {
    const out = new Set<number>();
    if (mode !== 'backbone' && mode !== 'bridges') return out;
    const acceptedRole = mode === 'backbone' ? 'backbone' : 'bridge';
    for (const link of links) {
        if (embeddingEdgeRole(link) !== acceptedRole) continue;
        out.add(link.source);
        out.add(link.target);
    }
    return out;
}

function embeddingEdgeRole(link: GalaxyEdge): 'local' | 'backbone' | 'bridge' | '' {
    const type = String(link.type || '').toLowerCase();
    if (type === 'embedding-backbone') return 'backbone';
    if (type === 'embedding-bridge') return 'bridge';
    if (type === 'embedding-local') return 'local';
    return '';
}

function clusterLensHsl(clusterId: string): string {
    const hue = Math.round(stableUnit(clusterId) * 360);
    return `${hue} 72% 61%`;
}

function productRegionBoost(role: string): number {
    if (role === 'core') return 1.38;
    if (role === 'backbone') return 1.24;
    if (role === 'bridge') return 1.44;
    if (role === 'boundary') return 1.05;
    if (role === 'outlier') return 1.56;
    return 0.72;
}

function productLaneWeight(meta: Record<string, unknown>): number {
    const product = meta['product'] as { lanes?: { laneWeights?: Record<string, number> } } | undefined;
    const lane = String(meta['productLaneKind'] || '');
    return Number(product?.lanes?.laneWeights?.[lane] || 0.55);
}

function mixNodeColor(node: GalaxyNode, rawHsl: string, amount: number): void {
    const color = hslToRgb(rawHsl);
    node.r = Math.round(node.r * (1 - amount) + color.r * amount);
    node.g = Math.round(node.g * (1 - amount) + color.g * amount);
    node.b = Math.round(node.b * (1 - amount) + color.b * amount);
}

function productRegionHsl(role: string): string {
    switch (role) {
        case 'core': return '172 72% 56%';
        case 'backbone': return '206 78% 62%';
        case 'bridge': return '45 92% 58%';
        case 'boundary': return '265 72% 64%';
        case 'outlier': return '340 82% 62%';
        default: return '220 12% 58%';
    }
}

function productLaneHsl(lane: string): string {
    switch (lane) {
        case 'document': return entityColorStore.getRawGraphNodeHsl('document');
        case 'relation': return entityColorStore.getRawGraphNodeHsl('graphFact');
        case 'temporal': return entityColorStore.getRawGraphNodeHsl('temporalFact');
        case 'causal': return entityColorStore.getRawGraphNodeHsl('causalFact');
        case 'evidence': return entityColorStore.getRawGraphNodeHsl('memoryState');
        case 'entity': return entityColorStore.getRawHsl('UNKNOWN');
        default: return '180 62% 56%';
    }
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
const HOPF_PROJECTION_RADIUS = 0.88;
const HOPF_MAX_RADIUS = 2.05;
const TAU = Math.PI * 2;
const HOPF_RIBBON_SEGMENTS = 96;
const HOPF_SPACE_FIBERS = 24;
const HOPF_TORUS_BAND_FIBERS = 14;
const PRODUCT_CONTEXT_SAMPLE_LIMIT = 384;

interface HopfBaseInfo extends Rgb {
    key: string;
    direction: { x: number; y: number; z: number };
    phases: number[];
    nodeIds: string[];
    importance: number;
}

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

function productHopfProjectionNodes(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyNode[] {
    const clones = nodes.map((node) => productHopfClone(node));
    const basesByRef = productEntityBaseMap(nodes);
    const samples: GalaxyNode[] = [];
    const seen = new Set<string>();
    const addSample = (base: GalaxyNode | undefined, context: GalaxyNode | undefined, link: GalaxyEdge, side: string) => {
        if (!base || !context || base === context || samples.length >= PRODUCT_CONTEXT_SAMPLE_LIMIT) return;
        const fiberKind = productContextFiberKind(context, link);
        const key = `${base.entity.id}|${context.entity.id}|${link.id}|${fiberKind}`;
        if (seen.has(key)) return;
        seen.add(key);
        samples.push(productContextSampleNode(base, context, link, fiberKind, side, samples.length));
    };

    for (const link of links) {
        const source = nodes[link.source];
        const target = nodes[link.target];
        if (!source || !target) continue;
        if (isProductEntityBase(source)) addSample(source, target, link, 'target');
        if (isProductEntityBase(target)) addSample(target, source, link, 'source');
    }

    for (const node of nodes) {
        if (samples.length >= PRODUCT_CONTEXT_SAMPLE_LIMIT || isProductEntityBase(node)) continue;
        const sourceEntityId = stringMetadata(node, 'sourceEntityId');
        const base = sourceEntityId ? basesByRef.get(sourceEntityId) : undefined;
        if (base) {
            addSample(base, node, {
                id: `product:implicit-context:${base.entity.id}:${node.entity.id}`,
                source: 0,
                target: 0,
                type: 'product-context',
                confidence: 0.62,
                alpha: 0,
                curve: 0,
                flowOffset: 0,
            }, 'implicit');
        }
    }

    return [...clones, ...samples];
}

function productHopfClone(node: GalaxyNode): GalaxyNode {
    const metadata = node.entity.metadata || {};
    const existingHopf = hopfMetadata(node) || {};
    const fiberKind = String(existingHopf['fiberKind'] || productContextFiberKind(node, null));
    const phase = Number.isFinite(Number(existingHopf['phase']))
        ? Number(existingHopf['phase'])
        : productPhase(`${node.entity.id}:anchor:${fiberKind}`);
    return {
        ...node,
        entity: {
            ...node.entity,
            metadata: {
                ...metadata,
                hopf: {
                    ...existingHopf,
                    role: existingHopf['role'] || 'anchor',
                    baseId: existingHopf['baseId'] || node.entity.id,
                    fiberKind,
                    phase,
                },
            },
        },
    };
}

function productContextSampleNode(
    base: GalaxyNode,
    context: GalaxyNode,
    link: GalaxyEdge,
    fiberKind: string,
    side: string,
    ordinal: number,
): GalaxyNode {
    const phase = productPhase(`${base.entity.id}:${context.entity.id}:${link.id}:${fiberKind}:${ordinal}`);
    const metadata = context.entity.metadata || {};
    const id = `product:context:${base.entity.id}:${context.entity.id}:${link.id}:${side}`;
    return {
        ...context,
        entity: {
            ...context.entity,
            id,
            label: `${base.entity.label} / ${fiberKind.replace(/_/g, ' ')}`,
            kind: `PRODUCT_CONTEXT:${fiberKind}`,
            totalMentions: Math.max(1, Math.round((context.entity.totalMentions || 1) * Math.max(0.65, link.confidence || 0.65))),
            colorHsl: base.entity.colorHsl || context.entity.colorHsl,
            metadata: {
                ...metadata,
                sourceType: 'product_context_sample',
                product: {
                    role: 'contextSample',
                    baseId: base.entity.id,
                    sourceNodeId: context.entity.id,
                    linkId: link.id,
                    linkType: link.type,
                    fiberKind,
                },
                hopf: {
                    role: 'fiber',
                    baseId: base.entity.id,
                    fiberKind,
                    phase,
                },
            },
        },
        r: base.r,
        g: base.g,
        b: base.b,
        radius: Math.max(1.2, context.radius * 0.68),
        galaxyOpacity: 0,
    };
}

function productEntityBaseMap(nodes: GalaxyNode[]): Map<string, GalaxyNode> {
    const out = new Map<string, GalaxyNode>();
    for (const node of nodes) {
        if (!isProductEntityBase(node)) continue;
        for (const ref of productEntityRefs(node)) out.set(ref, node);
    }
    return out;
}

function productEntityRefs(node: GalaxyNode): string[] {
    const refs = new Set<string>([node.entity.id]);
    const sourceId = stringMetadata(node, 'sourceId');
    const sourceEntityId = stringMetadata(node, 'sourceEntityId');
    if (sourceId) refs.add(sourceId);
    if (sourceEntityId) refs.add(sourceEntityId);
    for (const prefix of ['embed:entity:', 'entity::']) {
        if (node.entity.id.startsWith(prefix)) refs.add(node.entity.id.slice(prefix.length));
        if (sourceId.startsWith(prefix)) refs.add(sourceId.slice(prefix.length));
    }
    return [...refs].filter(Boolean);
}

function isProductEntityBase(node: GalaxyNode): boolean {
    const metadata = node.entity.metadata || {};
    const sourceType = String(metadata.sourceType || '').toLowerCase();
    const product = metadata['product'] as Record<string, unknown> | undefined;
    const productSourceType = String(product?.['sourceType'] || '').toLowerCase();
    const kind = String(node.entity.kind || '').toLowerCase();
    const id = node.entity.id.toLowerCase();
    return sourceType === 'entity'
        || productSourceType === 'entity'
        || id.startsWith('embed:entity:')
        || id.startsWith('entity::')
        || kind.includes('character')
        || kind.includes('entity');
}

function productContextFiberKind(context: GalaxyNode, link: GalaxyEdge | null): string {
    const text = [
        link?.type || '',
        context.entity.kind || '',
        context.entity.label || '',
        context.entity.metadata?.sourceType || '',
        context.entity.metadata?.['preview'] || '',
    ].join(' ').toLowerCase();
    if (/caus|because|therefore|effect/.test(text)) return 'causal';
    if (/time|temporal|before|after|timeline/.test(text)) return 'temporal';
    if (/event|scene|episode/.test(text)) return 'event';
    if (/anchor|evidence|source|span|provenance/.test(text)) return 'evidence';
    if (/relationship|co.?occurs|relation|graph-fact|fact/.test(text)) return 'relationship';
    if (/memory|state/.test(text)) return 'evidence';
    if (/chunk|note|document|doc|leaf/.test(text)) return 'document_structure';
    if (/location|place|city|tower|realm/.test(text)) return 'location';
    return 'identity';
}

function productPhase(value: string): number {
    return Math.round(stableUnit(value) * 1000000) / 1000000;
}

function stringMetadata(node: GalaxyNode, key: string): string {
    const value = node.entity.metadata?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
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

function applyHopfProjectionLayout(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyHopfRibbon[] {
    const baseInfos = new Map<string, HopfBaseInfo>();
    for (const node of nodes) {
        const baseKey = hopfBaseKey(node);
        if (!baseKey) continue;
        registerHopfBase(baseInfos, baseKey, node, isHopfAnchor(node));
    }

    for (const node of nodes) {
        const baseKey = hopfBaseKey(node);
        const baseInfo = baseKey ? baseInfos.get(baseKey) : undefined;
        const direction = baseInfo?.direction ?? normalizedDirection(node);
        const phase = hopfPhase(node, baseKey);
        const point = hopfStereographicProjection(direction, phase, hopfPositionScale(node));
        node.x = point.x;
        node.y = point.y;
        node.z = point.z;
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
        node.depth = Math.min(1, Math.hypot(node.x, node.y, node.z) / HOPF_MAX_RADIUS);
        node.radius *= hopfNodeScale(node);
        if (baseInfo && (isHopfAnchor(node) || isHopfFiber(node))) {
            baseInfo.phases.push(normalizePhaseRadians(phase));
            baseInfo.nodeIds.push(node.entity.id);
            baseInfo.importance += Math.max(1, Number(node.entity.totalMentions || 1));
        }
    }

    for (const link of links) {
        const type = link.type.toLowerCase();
        if (type.includes('anchor-fiber')) {
            link.alpha = Math.min(0.5, link.alpha * 1.55 + 0.07);
            link.curve *= 1.48;
            continue;
        }
        if (type.includes('fiber-edge')) {
            link.alpha = Math.min(0.42, link.alpha * 1.22 + 0.03);
            link.curve *= 1.18;
        }
    }

    return buildHopfRibbons(baseInfos);
}

function registerHopfBase(baseInfos: Map<string, HopfBaseInfo>, baseKey: string, node: GalaxyNode, anchor: boolean): void {
    const existing = baseInfos.get(baseKey);
    if (existing && !anchor) return;
    baseInfos.set(baseKey, {
        key: baseKey,
        direction: normalizedDirection(node),
        phases: existing?.phases ?? [],
        nodeIds: existing?.nodeIds ?? [],
        importance: existing?.importance ?? 0,
        r: node.r,
        g: node.g,
        b: node.b,
    });
}

function buildHopfRibbons(baseInfos: Map<string, HopfBaseInfo>): GalaxyHopfRibbon[] {
    const dataFibers = [...baseInfos.values()]
        .filter((info) => info.nodeIds.length > 0)
        .sort((left, right) => right.importance - left.importance)
        .slice(0, 36)
        .map((info) => ({
            id: `hopf:ribbon:${info.key}`,
            nodeIds: [...new Set(info.nodeIds)],
            positions3d: hopfRibbonSegments(info.direction, info.phases),
            importance: info.importance,
            guideKind: 'dataFiber' as const,
            guideWeight: 1,
            r: info.r,
            g: info.g,
            b: info.b,
        }));
    return [
        ...dataFibers,
        ...buildHopfSpaceFibers(),
        ...buildHopfTorusBands(),
        buildHopfAxisCue(),
    ];
}

function hopfRibbonSegments(direction: { x: number; y: number; z: number }, phases: number[]): Float32Array {
    const phaseSet = new Set<number>();
    for (let index = 0; index < HOPF_RIBBON_SEGMENTS; index++) {
        phaseSet.add(roundPhase((index / HOPF_RIBBON_SEGMENTS) * TAU));
    }
    for (const phase of phases) phaseSet.add(roundPhase(phase));
    const samples = [...phaseSet].sort((left, right) => left - right);
    const positions = new Float32Array(samples.length * 2 * 3);
    for (let index = 0; index < samples.length; index++) {
        const current = hopfStereographicProjection(direction, samples[index], 1);
        const next = hopfStereographicProjection(direction, samples[(index + 1) % samples.length], 1);
        const offset = index * 6;
        positions[offset] = current.x;
        positions[offset + 1] = current.y;
        positions[offset + 2] = current.z;
        positions[offset + 3] = next.x;
        positions[offset + 4] = next.y;
        positions[offset + 5] = next.z;
    }
    return positions;
}

function buildHopfSpaceFibers(): GalaxyHopfRibbon[] {
    const fibers: GalaxyHopfRibbon[] = [];
    for (let index = 0; index < HOPF_SPACE_FIBERS; index++) {
        const direction = fibonacciUnitDirection(index, HOPF_SPACE_FIBERS);
        fibers.push({
            id: `hopf:space-fiber:${index}`,
            nodeIds: [],
            positions3d: hopfRibbonSegments(direction, []),
            importance: 0.2,
            guideKind: 'spaceFiber',
            guideWeight: 0.34,
            r: 42,
            g: 204,
            b: index % 2 === 0 ? 214 : 166,
        });
    }
    return fibers;
}

function buildHopfTorusBands(): GalaxyHopfRibbon[] {
    const bands: GalaxyHopfRibbon[] = [];
    const latitudes = [0.34, 0.5, 0.66];
    for (const [latitudeIndex, latitude] of latitudes.entries()) {
        const theta = latitude * Math.PI;
        for (let ringIndex = 0; ringIndex < HOPF_TORUS_BAND_FIBERS; ringIndex++) {
            const phi = (ringIndex / HOPF_TORUS_BAND_FIBERS) * TAU;
            const direction = {
                x: Math.sin(theta) * Math.cos(phi),
                y: Math.cos(theta),
                z: Math.sin(theta) * Math.sin(phi),
            };
            bands.push({
                id: `hopf:torus-band:${latitudeIndex}:${ringIndex}`,
                nodeIds: [],
                positions3d: hopfRibbonSegments(direction, []),
                importance: 0.12,
                guideKind: 'torusBand',
                guideWeight: latitudeIndex === 1 ? 0.28 : 0.2,
                r: latitudeIndex === 1 ? 186 : 92,
                g: latitudeIndex === 1 ? 96 : 142,
                b: 255,
            });
        }
    }
    return bands;
}

function buildHopfAxisCue(): GalaxyHopfRibbon {
    const points = 96;
    const positions = new Float32Array((points - 1) * 2 * 3);
    for (let index = 0; index < points - 1; index++) {
        const a = -1.82 + (index / (points - 1)) * 3.64;
        const b = -1.82 + ((index + 1) / (points - 1)) * 3.64;
        const offset = index * 6;
        positions[offset] = 0;
        positions[offset + 1] = a;
        positions[offset + 2] = 0;
        positions[offset + 3] = 0;
        positions[offset + 4] = b;
        positions[offset + 5] = 0;
    }
    return {
        id: 'hopf:axis:north-south',
        nodeIds: [],
        positions3d: positions,
        importance: 0.1,
        guideKind: 'axis',
        guideWeight: 0.22,
        r: 120,
        g: 240,
        b: 255,
    };
}

function hopfStereographicProjection(direction: { x: number; y: number; z: number }, phase: number, scale: number): { x: number; y: number; z: number } {
    const eta = Math.acos(clamp(direction.y, -1, 1));
    const phi = Math.atan2(direction.z, direction.x);
    const halfEta = eta * 0.5;
    const plus = (phi + phase) * 0.5;
    const minus = (phi - phase) * 0.5;
    const cosEta = Math.cos(halfEta);
    const sinEta = Math.sin(halfEta);
    const x1 = cosEta * Math.cos(plus);
    const y1 = cosEta * Math.sin(plus);
    const x2 = sinEta * Math.cos(minus);
    const y2 = sinEta * Math.sin(minus);
    const inverse = 1 / Math.max(0.32, 1 - y2);
    const raw = { x: x1 * inverse, y: x2 * inverse, z: y1 * inverse };
    const norm = Math.hypot(raw.x, raw.y, raw.z);
    const bound = norm > HOPF_MAX_RADIUS ? HOPF_MAX_RADIUS / norm : 1;
    return {
        x: raw.x * bound * HOPF_PROJECTION_RADIUS * scale,
        y: raw.y * bound * HOPF_PROJECTION_RADIUS * scale,
        z: raw.z * bound * HOPF_PROJECTION_RADIUS * scale,
    };
}

function hopfPhase(node: GalaxyNode, baseKey: string | null): number {
    const metadataPhase = Number(hopfMetadata(node)?.['phase']);
    if (Number.isFinite(metadataPhase)) return metadataPhase >= 0 && metadataPhase <= 1 ? metadataPhase * TAU : metadataPhase;
    if (isHopfAnchor(node)) return stableUnit(`${baseKey || node.entity.id}:anchor-phase`) * 0.08;
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    if (sourceType === 'query') return stableUnit(`${node.entity.id}:query-phase`) * TAU;
    return fiberKindPhase(hopfFiberKind(node)) + (stableUnit(`${node.entity.id}:fiber-phase`) - 0.5) * 0.1;
}

function fiberKindPhase(kind: string): number {
    switch (kind) {
        case 'relationship':
        case 'emotional':
            return TAU * 0.18;
        case 'location':
            return TAU * 0.3;
        case 'event':
        case 'document_structure':
            return TAU * 0.41;
        case 'temporal':
            return TAU * 0.53;
        case 'causal':
        case 'contradiction':
            return TAU * 0.64;
        case 'evidence':
        case 'provenance':
            return TAU * 0.75;
        case 'political':
            return TAU * 0.84;
        case 'mechanical':
        case 'power_system':
            return TAU * 0.92;
        default:
            return TAU * 0.08;
    }
}

function hopfPositionScale(node: GalaxyNode): number {
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    if (sourceType === 'query') return 1.08;
    if (isHopfAnchor(node) || isHopfFiber(node)) return 1;
    if (sourceType === 'entity') return 0.68;
    return 0.88;
}

function normalizePhaseRadians(value: number): number {
    return ((value % TAU) + TAU) % TAU;
}

function roundPhase(value: number): number {
    return Math.round(normalizePhaseRadians(value) * 1000000) / 1000000;
}

function fibonacciUnitDirection(index: number, total: number): { x: number; y: number; z: number } {
    const y = 1 - ((index + 0.5) / total) * 2;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * 2.399963229728653;
    return {
        x: Math.cos(angle) * radial,
        y,
        z: Math.sin(angle) * radial,
    };
}

function hopfNodeScale(node: GalaxyNode): number {
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    if (sourceType === 'query') return 1.14;
    if (isHopfAnchor(node)) return 0.98;
    if (isHopfFiber(node)) return 0.74;
    if (sourceType === 'entity') return 0.82;
    return 0.78;
}

function hopfBaseKey(node: GalaxyNode): string | null {
    const metadata = hopfMetadata(node);
    const baseId = String(metadata?.['baseId'] || '');
    if (baseId) return baseId;
    const id = node.entity.id;
    if (id.startsWith('hopf:anchor:')) return id.slice('hopf:anchor:'.length);
    if (!id.startsWith('hopf:fiber:')) return null;
    const rest = id.slice('hopf:fiber:'.length);
    const separator = rest.lastIndexOf(':');
    return separator > 0 ? rest.slice(0, separator) : rest;
}

function hopfFiberKind(node: GalaxyNode): string {
    const metadataKind = String(hopfMetadata(node)?.['fiberKind'] || '').toLowerCase();
    if (metadataKind) return metadataKind;
    const kind = String(node.entity.kind || '').toLowerCase();
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    const id = node.entity.id;
    const kindMatch = kind.match(/hopf_fiber:([a-z0-9_-]+)/);
    if (kindMatch?.[1]) return kindMatch[1];
    if (id.startsWith('hopf:fiber:')) {
        const separator = id.lastIndexOf(':');
        if (separator > 'hopf:fiber:'.length) return id.slice(separator + 1).toLowerCase();
    }
    return sourceType || kind || 'identity';
}

function isHopfAnchor(node: GalaxyNode): boolean {
    if (hopfMetadata(node)?.['role'] === 'anchor') return true;
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    return sourceType === 'hopf_anchor' || node.entity.id.startsWith('hopf:anchor:') || String(node.entity.kind || '').toLowerCase() === 'hopf_anchor';
}

function isHopfFiber(node: GalaxyNode): boolean {
    if (hopfMetadata(node)?.['role'] === 'fiber') return true;
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    return sourceType === 'hopf_fiber' || node.entity.id.startsWith('hopf:fiber:') || String(node.entity.kind || '').toLowerCase().startsWith('hopf_fiber:');
}

function hopfMetadata(node: GalaxyNode): Record<string, unknown> | null {
    const value = node.entity.metadata?.['hopf'];
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
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
    return semanticNodePriority(entity) + (hasAtlasSeed(entity) ? 100000 : 0) + mentions;
}

const ENTITY_RENDER_KINDS = new Set([
    'character',
    'location',
    'npc',
    'item',
    'faction',
    'network',
    'organization',
    'event',
    'concept',
    'entity',
]);

function semanticNodePriority(entity: GalaxyRenderableNode): number {
    const kind = normalizeRenderKind(String(entity.metadata?.['graphKind'] || entity.kind || ''));
    if (kind === 'chunk' || kind === 'leaf') return 0;
    if (kind === 'mention' || kind === 'anchor') return 30000;
    if (ENTITY_RENDER_KINDS.has(kind) || entity.metadata?.sourceEntityId) return 200000;
    return 80000;
}

function normalizeRenderKind(kind: string): string {
    return kind.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function resolveGalaxyNodeColorHsl(entity: GalaxyRenderableNode): string {
    const metadata = entity.metadata || {};
    const entityKind = normalizeEntityKind(stringValue(metadata['entityKind']) || entity.kind);
    if (entityKind) return entityColorStore.getRawHsl(entityKind);

    const graphColorKind = normalizeGraphNodeColorKind(
        stringValue(metadata['graphColorKind'])
        || stringValue(metadata['graphRelationFamily'])
        || stringValue(metadata['graphKind'])
        || entity.kind,
    );
    if (graphColorKind) return entityColorStore.getRawGraphNodeHsl(graphColorKind);

    return entity.colorHsl || entityColorStore.getRawHsl(entity.kind);
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
