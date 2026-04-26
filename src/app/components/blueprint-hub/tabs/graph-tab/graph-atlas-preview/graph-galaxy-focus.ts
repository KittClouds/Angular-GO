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
