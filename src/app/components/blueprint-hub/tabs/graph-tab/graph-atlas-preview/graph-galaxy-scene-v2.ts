import type { GalaxyNode, GalaxyScene } from './graph-galaxy-engine';

export interface GalaxySceneV2 {
    ids: string[];
    labels: string[];
    kinds: string[];
    positions3d: Float32Array;
    positions2d: Float32Array;
    radii: Float32Array;
    colors: Float32Array;
    edgePairs: Uint32Array;
    edgeColors: Float32Array;
    edgeAlpha: Float32Array;
}

export function galaxySceneToV2(scene: GalaxyScene): GalaxySceneV2 {
    const nodeCount = scene.nodes.length;
    const ids: string[] = new Array(nodeCount);
    const labels: string[] = new Array(nodeCount);
    const kinds: string[] = new Array(nodeCount);
    const positions3d = new Float32Array(nodeCount * 3);
    const positions2d = new Float32Array(nodeCount * 3);
    const radii = new Float32Array(nodeCount);
    const colors = new Float32Array(nodeCount * 3);

    for (let index = 0; index < nodeCount; index++) {
        const node = scene.nodes[index];
        ids[index] = node.entity.id;
        labels[index] = node.entity.label;
        kinds[index] = node.entity.kind;
        writePosition(positions3d, index, node.x, node.y, node.z);
        writePosition(positions2d, index, node.x, node.y, 0);
        radii[index] = node.radius;
        writeColor(colors, index, node);
    }

    const edgePairs = new Uint32Array(scene.links.length * 2);
    const edgeColors = new Float32Array(scene.links.length * 6);
    const edgeAlpha = new Float32Array(scene.links.length);
    for (let index = 0; index < scene.links.length; index++) {
        const edge = scene.links[index];
        const source = scene.nodes[edge.source];
        const target = scene.nodes[edge.target];
        edgePairs[index * 2] = edge.source;
        edgePairs[index * 2 + 1] = edge.target;
        writeColor(edgeColors, index * 2, source);
        writeColor(edgeColors, index * 2 + 1, target);
        edgeAlpha[index] = edge.alpha;
    }

    return { ids, labels, kinds, positions3d, positions2d, radii, colors, edgePairs, edgeColors, edgeAlpha };
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
