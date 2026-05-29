import type { GalaxyGroup, GalaxyHopfRibbon, GalaxyLayoutMode, GalaxyLorentzGuide, GalaxyNode, GalaxyScene } from './graph-galaxy-engine';

export type GalaxySceneSourceMode = 'entities' | 'graph' | 'embeddings';

export interface GalaxySceneGroupView {
    id: string;
    label: string;
    kind: GalaxyGroup['kind'];
    center: { x: number; y: number; z: number };
    radius: number;
    color: { r: number; g: number; b: number };
    nodeIds: string[];
    importance: number;
}

export interface GalaxyHopfRibbonView {
    id: string;
    nodeIds: string[];
    positions3d: Float32Array;
    positions2d: Float32Array;
    color: { r: number; g: number; b: number };
    importance: number;
    guideKind: GalaxyHopfRibbon['guideKind'];
    guideWeight: number;
}

export interface GalaxyLorentzGuideView {
    id: string;
    nodeIds: string[];
    positions3d: Float32Array;
    positions2d: Float32Array;
    color: { r: number; g: number; b: number };
    importance: number;
    treeId: string;
    treeKind: string;
    level: number;
    guideKind: GalaxyLorentzGuide['guideKind'];
    guideWeight: number;
}

export interface GalaxySceneV2 {
    sourceMode: GalaxySceneSourceMode;
    layoutMode: GalaxyLayoutMode;
    ids: string[];
    labels: string[];
    kinds: string[];
    groupIds: string[];
    hopfBaseIds?: string[];
    hopfRoles?: Uint8Array;
    groups: GalaxySceneGroupView[];
    hopfRibbons: GalaxyHopfRibbonView[];
    lorentzGuides: GalaxyLorentzGuideView[];
    positions3d: Float32Array;
    positions2d: Float32Array;
    radii: Float32Array;
    colors: Float32Array;
    edgePairs: Uint32Array;
    edgeColors: Float32Array;
    edgeAlpha: Float32Array;
    edgeKinds: Uint8Array;
}

export function galaxySceneToV2(scene: GalaxyScene, sourceMode: GalaxySceneSourceMode = 'entities'): GalaxySceneV2 {
    const nodeCount = scene.nodes.length;
    const ids: string[] = new Array(nodeCount);
    const labels: string[] = new Array(nodeCount);
    const kinds: string[] = new Array(nodeCount);
    const groupIds: string[] = new Array(nodeCount);
    const hopfBaseIds: string[] = new Array(nodeCount);
    const hopfRoles = new Uint8Array(nodeCount);
    const positions3d = new Float32Array(nodeCount * 3);
    const positions2d = new Float32Array(nodeCount * 3);
    const radii = new Float32Array(nodeCount);
    const colors = new Float32Array(nodeCount * 3);

    for (let index = 0; index < nodeCount; index++) {
        const node = scene.nodes[index];
        ids[index] = node.entity.id;
        labels[index] = node.entity.label;
        kinds[index] = node.entity.kind;
        groupIds[index] = node.groupId || '';
        const hopf = hopfMetadata(node);
        hopfBaseIds[index] = String(hopf?.['baseId'] || '');
        hopfRoles[index] = hopf?.['role'] === 'anchor' ? 1 : hopf?.['role'] === 'fiber' ? 2 : 0;
        writePosition(positions3d, index, node.x, node.y, node.z);
        writePosition(positions2d, index, node.x, node.y, 0);
        radii[index] = node.radius;
        writeColor(colors, index, node);
    }

    const edgePairs = new Uint32Array(scene.links.length * 2);
    const edgeColors = new Float32Array(scene.links.length * 6);
    const edgeAlpha = new Float32Array(scene.links.length);
    const edgeKinds = new Uint8Array(scene.links.length);
    for (let index = 0; index < scene.links.length; index++) {
        const edge = scene.links[index];
        const source = scene.nodes[edge.source];
        const target = scene.nodes[edge.target];
        edgePairs[index * 2] = edge.source;
        edgePairs[index * 2 + 1] = edge.target;
        writeColor(edgeColors, index * 2, source);
        writeColor(edgeColors, index * 2 + 1, target);
        edgeAlpha[index] = edge.alpha;
        edgeKinds[index] = edge.interGalaxy ? 1 : hierarchyEdgeKind(edge.type);
    }

    return {
        sourceMode,
        layoutMode: scene.layoutMode,
        ids,
        labels,
        kinds,
        groupIds,
        hopfBaseIds,
        hopfRoles,
        groups: scene.groups.map(groupView),
        hopfRibbons: (scene.hopfRibbons ?? []).map(hopfRibbonView),
        lorentzGuides: (scene.lorentzGuides ?? []).map(lorentzGuideView),
        positions3d,
        positions2d,
        radii,
        colors,
        edgePairs,
        edgeColors,
        edgeAlpha,
        edgeKinds,
    };
}

function hierarchyEdgeKind(type: string): number {
    return /target-parent|note-chunk|chunk-anchor|chunk-entity|anchor-entity|event-chunk|event-entity|memory-entity/i.test(type) ? 2 : 0;
}

function hopfMetadata(node: GalaxyNode): Record<string, unknown> | null {
    const value = node.entity.metadata?.['hopf'];
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function groupView(group: GalaxyGroup): GalaxySceneGroupView {
    return {
        id: group.id,
        label: group.label,
        kind: group.kind,
        center: group.center,
        radius: group.radius,
        color: { r: group.r / 255, g: group.g / 255, b: group.b / 255 },
        nodeIds: group.nodeIds,
        importance: group.importance,
    };
}

function hopfRibbonView(ribbon: GalaxyHopfRibbon): GalaxyHopfRibbonView {
    const positions2d = ribbon.positions3d.slice();
    for (let index = 2; index < positions2d.length; index += 3) positions2d[index] = 0;
    return {
        id: ribbon.id,
        nodeIds: ribbon.nodeIds,
        positions3d: ribbon.positions3d,
        positions2d,
        color: { r: ribbon.r / 255, g: ribbon.g / 255, b: ribbon.b / 255 },
        importance: ribbon.importance,
        guideKind: ribbon.guideKind,
        guideWeight: ribbon.guideWeight,
    };
}

function lorentzGuideView(guide: GalaxyLorentzGuide): GalaxyLorentzGuideView {
    const positions2d = guide.positions3d.slice();
    for (let index = 2; index < positions2d.length; index += 3) positions2d[index] = 0;
    return {
        id: guide.id,
        nodeIds: guide.nodeIds,
        positions3d: guide.positions3d,
        positions2d,
        color: { r: guide.r / 255, g: guide.g / 255, b: guide.b / 255 },
        importance: guide.importance,
        treeId: guide.treeId,
        treeKind: guide.treeKind,
        level: guide.level,
        guideKind: guide.guideKind,
        guideWeight: guide.guideWeight,
    };
}

function writePosition(buffer: Float32Array, index: number, x: number, y: number, z: number): void {
    const offset = index * 3;
    buffer[offset] = x;
    buffer[offset + 1] = y;
    buffer[offset + 2] = z;
}

function writeColor(buffer: Float32Array, index: number, node: GalaxyNode): void {
    const offset = index * 3;
    buffer[offset] = node.r / 255;
    buffer[offset + 1] = node.g / 255;
    buffer[offset + 2] = node.b / 255;
}
