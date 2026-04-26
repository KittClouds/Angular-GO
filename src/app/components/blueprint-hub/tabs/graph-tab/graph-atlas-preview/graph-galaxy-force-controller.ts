import * as THREE from 'three';

import type { GalaxyNodeDragMode } from './graph-galaxy-engine';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

export class GraphGalaxyForceController {
    private base3d = new Float32Array(0);
    private base2d = new Float32Array(0);
    private readonly neighbors: number[][] = [];
    private scene: GalaxySceneV2 | null = null;
    private mode: '3d' | '2d' = '3d';
    private activeIndex = -1;
    private pinned = new Set<number>();
    private relaxing = false;

    bind(scene: GalaxySceneV2): void {
        this.scene = scene;
        this.base3d = scene.positions3d.slice();
        this.base2d = scene.positions2d.slice();
        this.neighbors.length = scene.ids.length;
        for (let i = 0; i < scene.ids.length; i++) this.neighbors[i] = [];
        for (let i = 0; i < scene.edgePairs.length; i += 2) {
            const a = scene.edgePairs[i], b = scene.edgePairs[i + 1];
            if (a < this.neighbors.length && b < this.neighbors.length) {
                this.neighbors[a].push(b);
                this.neighbors[b].push(a);
            }
        }
        this.activeIndex = -1;
        this.pinned.clear();
        this.relaxing = false;
    }

    setMode(mode: '3d' | '2d'): void {
        this.mode = mode;
    }

    begin(nodeId: string): boolean {
        const index = this.scene?.ids.indexOf(nodeId) ?? -1;
        this.activeIndex = index;
        return index >= 0;
    }

    drag(delta: THREE.Vector3, mode: GalaxyNodeDragMode): boolean {
        const scene = this.scene;
        if (!scene || this.activeIndex < 0 || mode === 'camera') return false;
        this.relaxing = false;
        this.move(scene.positions3d, this.activeIndex, delta.x, delta.y, delta.z);
        this.move(scene.positions2d, this.activeIndex, delta.x, delta.y, 0);
        const pull = mode === 'force' ? 0.2 : 0.14;
        for (const neighbor of this.neighbors[this.activeIndex] ?? []) {
            if (this.pinned.has(neighbor)) continue;
            this.move(scene.positions3d, neighbor, delta.x * pull, delta.y * pull, delta.z * pull);
            this.move(scene.positions2d, neighbor, delta.x * pull, delta.y * pull, 0);
        }
        return true;
    }

    end(mode: GalaxyNodeDragMode): boolean {
        if (this.activeIndex < 0) return false;
        if (mode === 'force') this.pinned.add(this.activeIndex);
        else if (mode === 'stretch') this.relaxing = true;
        this.activeIndex = -1;
        return this.relaxing;
    }

    tick(): boolean {
        const scene = this.scene;
        if (!scene || !this.relaxing) return false;
        const live = this.mode === '2d' ? scene.positions2d : scene.positions3d;
        const base = this.mode === '2d' ? this.base2d : this.base3d;
        let maxDelta = 0;
        for (let index = 0; index < scene.ids.length; index++) {
            if (this.pinned.has(index)) continue;
            const offset = index * 3;
            for (let axis = 0; axis < 3; axis++) {
                if (this.mode === '2d' && axis === 2) continue;
                const next = live[offset + axis] + (base[offset + axis] - live[offset + axis]) * 0.18;
                maxDelta = Math.max(maxDelta, Math.abs(next - live[offset + axis]));
                live[offset + axis] = next;
            }
        }
        if (this.mode === '2d') this.copy2dTo3d(scene);
        else this.copy3dTo2d(scene);
        this.relaxing = maxDelta > 0.0008;
        return this.relaxing;
    }

    active(): boolean {
        return this.activeIndex >= 0 || this.relaxing;
    }

    private move(buffer: Float32Array, index: number, x: number, y: number, z: number): void {
        const offset = index * 3;
        buffer[offset] += x;
        buffer[offset + 1] += y;
        buffer[offset + 2] += z;
    }

    private copy2dTo3d(scene: GalaxySceneV2): void {
        for (let i = 0; i < scene.ids.length; i++) {
            scene.positions3d[i * 3] = scene.positions2d[i * 3];
            scene.positions3d[i * 3 + 1] = scene.positions2d[i * 3 + 1];
        }
    }

    private copy3dTo2d(scene: GalaxySceneV2): void {
        for (let i = 0; i < scene.ids.length; i++) {
            scene.positions2d[i * 3] = scene.positions3d[i * 3];
            scene.positions2d[i * 3 + 1] = scene.positions3d[i * 3 + 1];
        }
    }
}
