import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

export interface GalaxyFocusMask {
    hasFocus: boolean;
    focusIndex: number;
    selectedIndex: number;
    hoverIndex: number;
    nodeLevels: Uint8Array;
    edgeLevels: Uint8Array;
}

export function buildGalaxyFocusMask(data: GalaxySceneV2, selectedId: string | null, hoverId: string | null): GalaxyFocusMask {
    const selectedIndex = selectedId ? data.ids.indexOf(selectedId) : -1;
    const hoverIndex = hoverId ? data.ids.indexOf(hoverId) : -1;
    const focusIndex = hoverIndex >= 0 ? hoverIndex : selectedIndex;
    const nodeLevels = new Uint8Array(data.ids.length);
    const edgeLevels = new Uint8Array(data.edgePairs.length / 2);
    if (focusIndex < 0) {
        nodeLevels.fill(1);
        edgeLevels.fill(1);
        return { hasFocus: false, focusIndex, selectedIndex, hoverIndex, nodeLevels, edgeLevels };
    }

    if (data.layoutMode === 'siegelFinsler' && focusDirectedHierarchy(data, focusIndex, nodeLevels, edgeLevels)) {
        return { hasFocus: true, focusIndex, selectedIndex, hoverIndex, nodeLevels, edgeLevels };
    }

    if (data.layoutMode === 'lorentzTree' && focusStructuralHierarchy(data, focusIndex, nodeLevels, edgeLevels)) {
        return { hasFocus: true, focusIndex, selectedIndex, hoverIndex, nodeLevels, edgeLevels };
    }

    nodeLevels[focusIndex] = 3;
    for (let edge = 0; edge < edgeLevels.length; edge++) {
        const source = data.edgePairs[edge * 2];
        const target = data.edgePairs[edge * 2 + 1];
        if (source === focusIndex || target === focusIndex) {
            edgeLevels[edge] = 2;
            nodeLevels[source] = Math.max(nodeLevels[source], source === focusIndex ? 3 : 2);
            nodeLevels[target] = Math.max(nodeLevels[target], target === focusIndex ? 3 : 2);
        }
    }
    return { hasFocus: true, focusIndex, selectedIndex, hoverIndex, nodeLevels, edgeLevels };
}

function focusDirectedHierarchy(
    data: GalaxySceneV2,
    focusIndex: number,
    nodeLevels: Uint8Array,
    edgeLevels: Uint8Array,
): boolean {
    const edgeCount = edgeLevels.length;
    nodeLevels[focusIndex] = 3;
    let found = false;
    const seen = new Uint8Array(data.ids.length);
    const queue = new Uint32Array(data.ids.length);
    const depths = new Uint8Array(data.ids.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = focusIndex;
    seen[focusIndex] = 1;
    while (head < tail) {
        const current = queue[head++];
        const depth = depths[current];
        if (depth >= 6) continue;
        for (let edge = 0; edge < edgeCount; edge += 1) {
            if (data.edgeKinds[edge] !== 2) continue;
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            if (target !== current) continue;
            found = true;
            edgeLevels[edge] = 2;
            nodeLevels[source] = Math.max(nodeLevels[source], depth <= 1 ? 2 : 1);
            if (!seen[source]) {
                seen[source] = 1;
                depths[source] = depth + 1;
                queue[tail++] = source;
            }
        }
    }

    for (let edge = 0; edge < edgeCount; edge += 1) {
        if (data.edgeKinds[edge] !== 2) continue;
        const source = data.edgePairs[edge * 2];
        const target = data.edgePairs[edge * 2 + 1];
        if (source !== focusIndex) continue;
        found = true;
        edgeLevels[edge] = 2;
        nodeLevels[target] = Math.max(nodeLevels[target], 2);
    }
    return found;
}

function focusStructuralHierarchy(
    data: GalaxySceneV2,
    focusIndex: number,
    nodeLevels: Uint8Array,
    edgeLevels: Uint8Array,
): boolean {
    const edgeCount = edgeLevels.length;
    nodeLevels[focusIndex] = 3;
    let foundAncestor = false;
    const seen = new Uint8Array(data.ids.length);
    const queue = new Uint32Array(data.ids.length);
    const depths = new Uint8Array(data.ids.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = focusIndex;
    seen[focusIndex] = 1;
    while (head < tail) {
        const current = queue[head++];
        const depth = depths[current];
        if (depth >= 5) continue;
        const currentRadius = nodeRadius(data, current);
        for (let edge = 0; edge < edgeCount; edge += 1) {
            if (data.edgeKinds[edge] !== 2) continue;
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const next = source === current ? target : target === current ? source : -1;
            if (next < 0) continue;
            const nextRadius = nodeRadius(data, next);
            const parent = currentRadius >= nextRadius ? current : next;
            const child = parent === current ? next : current;
            if (child !== current) continue;
            foundAncestor = true;
            edgeLevels[edge] = 2;
            nodeLevels[parent] = Math.max(nodeLevels[parent], depth <= 1 ? 2 : 1);
            if (!seen[parent]) {
                seen[parent] = 1;
                depths[parent] = depth + 1;
                queue[tail++] = parent;
            }
        }
    }
    if (foundAncestor) return true;

    let foundChild = false;
    const focusRadius = nodeRadius(data, focusIndex);
    for (let edge = 0; edge < edgeCount; edge += 1) {
        if (data.edgeKinds[edge] !== 2) continue;
        const source = data.edgePairs[edge * 2];
        const target = data.edgePairs[edge * 2 + 1];
        const next = source === focusIndex ? target : target === focusIndex ? source : -1;
        if (next < 0) continue;
        if (focusRadius < nodeRadius(data, next)) continue;
        foundChild = true;
        edgeLevels[edge] = 2;
        nodeLevels[next] = Math.max(nodeLevels[next], 2);
    }
    return foundChild;
}

function nodeRadius(data: GalaxySceneV2, index: number): number {
    const offset = index * 3;
    return Math.hypot(data.positions3d[offset], data.positions3d[offset + 1], data.positions3d[offset + 2]);
}
