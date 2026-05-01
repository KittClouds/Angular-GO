import * as THREE from 'three';

import {
    mergeGalaxySettings,
    type GalaxyNodeDragMode,
    type GalaxyRenderSettings,
} from './graph-galaxy-engine';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

const EPSILON = 0.0008;
const MAX_XZ = 3.15;
const MAX_Y = 2.55;

export class GraphGalaxyForceController {
    private base3d = new Float32Array(0);
    private base2d = new Float32Array(0);
    private vx = new Float32Array(0);
    private vy = new Float32Array(0);
    private vz = new Float32Array(0);
    private fixed = new Uint8Array(0);
    private readonly dragDelta = new THREE.Vector3();
    private readonly neighbors: number[][] = [];
    private scene: GalaxySceneV2 | null = null;
    private settings: GalaxyRenderSettings = mergeGalaxySettings();
    private mode: '3d' | '2d' = '3d';
    private activeIndex = -1;
    private alpha = 0;
    private relaxing = false;
    private forceActive = false;

    bind(scene: GalaxySceneV2): void {
        this.scene = scene;
        this.base3d = scene.positions3d.slice();
        this.base2d = scene.positions2d.slice();
        this.vx = new Float32Array(scene.ids.length);
        this.vy = new Float32Array(scene.ids.length);
        this.vz = new Float32Array(scene.ids.length);
        this.fixed = new Uint8Array(scene.ids.length);
        this.neighbors.length = scene.ids.length;
        for (let i = 0; i < scene.ids.length; i++) this.neighbors[i] = [];
        for (let i = 0; i < scene.edgePairs.length; i += 2) {
            const a = scene.edgePairs[i];
            const b = scene.edgePairs[i + 1];
            if (a < this.neighbors.length && b < this.neighbors.length) {
                this.neighbors[a].push(b);
                this.neighbors[b].push(a);
            }
        }
        this.activeIndex = -1;
        this.alpha = 0;
        this.relaxing = false;
        this.forceActive = false;
    }

    setSettings(settings: Partial<GalaxyRenderSettings> | null | undefined): void {
        const previous = this.settings;
        this.settings = mergeGalaxySettings(settings ?? undefined);
        const layoutChanged = previous.edgeLength !== this.settings.edgeLength || previous.nodeDistance !== this.settings.nodeDistance;
        if (!layoutChanged || !this.scene || this.scene.ids.length < 2 || this.scene.layoutMode !== 'single') return;
        this.forceActive = true;
        this.relaxing = false;
        this.alpha = Math.max(this.alpha, this.scene.edgePairs.length ? 0.62 : 0.36);
    }

    setMode(mode: '3d' | '2d'): void {
        this.mode = mode;
    }

    cancel(): void {
        this.activeIndex = -1;
        this.alpha = 0;
        this.relaxing = false;
        this.forceActive = false;
        this.vx.fill(0);
        this.vy.fill(0);
        this.vz.fill(0);
    }

    begin(nodeId: string): boolean {
        const index = this.scene?.ids.indexOf(nodeId) ?? -1;
        this.activeIndex = index;
        if (index >= 0) {
            this.vx[index] = 0;
            this.vy[index] = 0;
            this.vz[index] = 0;
        }
        return index >= 0;
    }

    writeActivePosition(out: THREE.Vector3): boolean {
        const scene = this.scene;
        if (!scene || this.activeIndex < 0) return false;
        const live = this.livePositions(scene);
        const offset = this.activeIndex * 3;
        out.set(live[offset], live[offset + 1], live[offset + 2]);
        return true;
    }

    dragTo(target: THREE.Vector3, mode: GalaxyNodeDragMode): boolean {
        const scene = this.scene;
        if (!scene || this.activeIndex < 0 || mode === 'camera') return false;
        if (mode === 'force' && scene.layoutMode !== 'single') return this.drag(this.dragDelta.set(
            target.x - this.livePositions(scene)[this.activeIndex * 3],
            target.y - this.livePositions(scene)[this.activeIndex * 3 + 1],
            this.mode === '2d' ? 0 : target.z - this.livePositions(scene)[this.activeIndex * 3 + 2],
        ), 'stretch');
        const live = this.livePositions(scene);
        const offset = this.activeIndex * 3;
        this.dragDelta.set(
            target.x - live[offset],
            target.y - live[offset + 1],
            this.mode === '2d' ? 0 : target.z - live[offset + 2],
        );

        if (mode === 'force') {
            this.setPosition(live, this.activeIndex, target.x, target.y, this.mode === '2d' ? 0 : target.z);
            this.zeroVelocity(this.activeIndex);
            this.alpha = Math.max(this.alpha, 0.66);
            this.forceActive = true;
            this.relaxing = false;
            this.syncTwinBuffers(scene, live);
            return true;
        }

        return this.drag(this.dragDelta, mode);
    }

    drag(delta: THREE.Vector3, mode: GalaxyNodeDragMode): boolean {
        const scene = this.scene;
        if (!scene || this.activeIndex < 0 || mode === 'camera') return false;
        this.relaxing = false;
        this.forceActive = false;
        this.alpha = 0;
        this.move(scene.positions3d, this.activeIndex, delta.x, delta.y, delta.z);
        this.move(scene.positions2d, this.activeIndex, delta.x, delta.y, 0);
        const pull = mode === 'pin' ? 0.18 : 0.14;
        for (const neighbor of this.neighbors[this.activeIndex] ?? []) {
            if (this.fixed[neighbor]) continue;
            this.move(scene.positions3d, neighbor, delta.x * pull, delta.y * pull, delta.z * pull);
            this.move(scene.positions2d, neighbor, delta.x * pull, delta.y * pull, 0);
        }
        return true;
    }

    end(mode: GalaxyNodeDragMode): boolean {
        if (this.activeIndex < 0) return false;
        if (mode === 'pin') this.fixed[this.activeIndex] = 1;
        else if (mode === 'stretch') this.relaxing = true;
        else if (mode === 'force') {
            this.forceActive = true;
            this.alpha = Math.max(this.alpha, 0.38);
        }
        this.activeIndex = -1;
        return this.active();
    }

    tick(): boolean {
        const scene = this.scene;
        if (!scene) return false;
        if (this.forceActive && this.alpha > EPSILON) {
            this.tickForce(scene);
            return true;
        }
        if (this.relaxing) return this.tickElastic(scene);
        return false;
    }

    active(): boolean {
        return this.activeIndex >= 0 || this.relaxing || this.alpha > EPSILON;
    }

    private tickForce(scene: GalaxySceneV2): void {
        const live = this.livePositions(scene);
        const base = this.mode === '2d' ? this.base2d : this.base3d;
        const count = scene.ids.length;
        const alpha = this.alpha;
        const targetLength = 0.34 + this.settings.edgeLength * 0.84;
        const repel = 0.0038 * this.settings.nodeDistance;
        const shellStrength = count > 48 && this.mode === '3d' ? 0.02 : 0.006;

        for (let i = 0; i < scene.edgePairs.length; i += 2) {
            this.applySpring(live, scene.edgePairs[i], scene.edgePairs[i + 1], targetLength, 0.021 * alpha);
        }

        for (let a = 0; a < count; a++) {
            for (let b = a + 1; b < count; b++) {
                this.applyRepulsion(live, scene.radii, a, b, repel * alpha);
            }
        }

        for (let i = 0; i < count; i++) {
            if (this.isLocked(i)) continue;
            const offset = i * 3;
            this.vx[i] += (base[offset] - live[offset]) * shellStrength * alpha;
            this.vy[i] += (base[offset + 1] - live[offset + 1]) * shellStrength * alpha;
            if (this.mode === '3d') this.vz[i] += (base[offset + 2] - live[offset + 2]) * shellStrength * alpha;
        }

        let kinetic = 0;
        for (let i = 0; i < count; i++) {
            if (this.isLocked(i)) {
                this.zeroVelocity(i);
                continue;
            }
            const offset = i * 3;
            live[offset] = clamp(live[offset] + this.vx[i] * alpha, -MAX_XZ, MAX_XZ);
            live[offset + 1] = clamp(live[offset + 1] + this.vy[i] * alpha, -MAX_Y, MAX_Y);
            if (this.mode === '3d') live[offset + 2] = clamp(live[offset + 2] + this.vz[i] * alpha, -MAX_XZ, MAX_XZ);
            else live[offset + 2] = 0;
            kinetic = Math.max(kinetic, Math.abs(this.vx[i]) + Math.abs(this.vy[i]) + Math.abs(this.vz[i]));
            this.vx[i] *= 0.82;
            this.vy[i] *= 0.82;
            this.vz[i] *= 0.82;
        }

        this.syncTwinBuffers(scene, live);
        this.alpha *= 0.92;
        if (this.alpha <= EPSILON || kinetic <= EPSILON) {
            this.alpha = 0;
            this.forceActive = false;
        }
    }

    private tickElastic(scene: GalaxySceneV2): boolean {
        const live = this.livePositions(scene);
        const base = this.mode === '2d' ? this.base2d : this.base3d;
        let maxDelta = 0;
        for (let index = 0; index < scene.ids.length; index++) {
            if (this.fixed[index]) continue;
            const offset = index * 3;
            for (let axis = 0; axis < 3; axis++) {
                if (this.mode === '2d' && axis === 2) continue;
                const next = live[offset + axis] + (base[offset + axis] - live[offset + axis]) * 0.18;
                maxDelta = Math.max(maxDelta, Math.abs(next - live[offset + axis]));
                live[offset + axis] = next;
            }
        }
        this.syncTwinBuffers(scene, live);
        this.relaxing = maxDelta > EPSILON;
        return this.relaxing;
    }

    private applySpring(live: Float32Array, a: number, b: number, target: number, strength: number): void {
        if (a === b) return;
        const ao = a * 3;
        const bo = b * 3;
        const dx = live[bo] - live[ao];
        const dy = live[bo + 1] - live[ao + 1];
        const dz = this.mode === '2d' ? 0 : live[bo + 2] - live[ao + 2];
        const distSq = dx * dx + dy * dy + dz * dz + 0.000001;
        const dist = Math.sqrt(distSq);
        const force = (dist - target) * strength / dist;
        this.addForce(a, dx * force, dy * force, dz * force);
        this.addForce(b, -dx * force, -dy * force, -dz * force);
    }

    private applyRepulsion(live: Float32Array, radii: Float32Array, a: number, b: number, strength: number): void {
        const ao = a * 3;
        const bo = b * 3;
        let dx = live[bo] - live[ao];
        let dy = live[bo + 1] - live[ao + 1];
        let dz = this.mode === '2d' ? 0 : live[bo + 2] - live[ao + 2];
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 0.000001) {
            dx = ((a * 17 + b * 13) % 19 - 9) * 0.001;
            dy = ((a * 11 + b * 7) % 17 - 8) * 0.001;
            dz = this.mode === '2d' ? 0 : ((a * 5 + b * 3) % 13 - 6) * 0.001;
            distSq = dx * dx + dy * dy + dz * dz;
        }
        const dist = Math.sqrt(distSq);
        const minDist = 0.045 + (radii[a] + radii[b]) * 0.014;
        const push = (strength / distSq) + (dist < minDist ? (minDist - dist) * 0.065 : 0);
        const fx = (dx / dist) * push;
        const fy = (dy / dist) * push;
        const fz = (dz / dist) * push;
        this.addForce(a, -fx, -fy, -fz);
        this.addForce(b, fx, fy, fz);
    }

    private addForce(index: number, x: number, y: number, z: number): void {
        if (this.isLocked(index)) return;
        this.vx[index] += x;
        this.vy[index] += y;
        this.vz[index] += z;
    }

    private isLocked(index: number): boolean {
        return this.fixed[index] === 1 || index === this.activeIndex;
    }

    private zeroVelocity(index: number): void {
        this.vx[index] = 0;
        this.vy[index] = 0;
        this.vz[index] = 0;
    }

    private livePositions(scene: GalaxySceneV2): Float32Array {
        return this.mode === '2d' ? scene.positions2d : scene.positions3d;
    }

    private move(buffer: Float32Array, index: number, x: number, y: number, z: number): void {
        const offset = index * 3;
        buffer[offset] += x;
        buffer[offset + 1] += y;
        buffer[offset + 2] += z;
    }

    private setPosition(buffer: Float32Array, index: number, x: number, y: number, z: number): void {
        const offset = index * 3;
        buffer[offset] = clamp(x, -MAX_XZ, MAX_XZ);
        buffer[offset + 1] = clamp(y, -MAX_Y, MAX_Y);
        buffer[offset + 2] = this.mode === '2d' ? 0 : clamp(z, -MAX_XZ, MAX_XZ);
    }

    private syncTwinBuffers(scene: GalaxySceneV2, live: Float32Array): void {
        if (live === scene.positions2d) this.copy2dTo3d(scene);
        else this.copy3dTo2d(scene);
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

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
