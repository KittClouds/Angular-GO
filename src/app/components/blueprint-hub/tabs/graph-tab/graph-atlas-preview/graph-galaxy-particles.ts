import * as THREE from 'three';

import type { GalaxyRenderSettings } from './graph-galaxy-engine';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

export class GraphGalaxyParticles {
    readonly points: THREE.Points;
    private readonly geometry = new THREE.BufferGeometry();
    private readonly material = new THREE.PointsMaterial({
        color: 0xffcf6b,
        transparent: true,
        opacity: 0,
        size: 0.03,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    private readonly edgeIndexes: number[] = [];
    private readonly seeds: number[] = [];
    private readonly speeds: number[] = [];

    constructor() {
        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
    }

    bind(data: GalaxySceneV2, settings: GalaxyRenderSettings): void {
        this.edgeIndexes.length = 0;
        this.seeds.length = 0;
        this.speeds.length = 0;
        const edgeCount = data.edgePairs.length / 2;
        if (!settings.particleFlow || edgeCount === 0) {
            this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
            this.points.visible = false;
            return;
        }

        const degrees = new Uint16Array(data.ids.length);
        for (let edge = 0; edge < edgeCount; edge++) {
            degrees[data.edgePairs[edge * 2]]++;
            degrees[data.edgePairs[edge * 2 + 1]]++;
        }
        const ranked = Array.from({ length: edgeCount }, (_, edge) => edge)
            .sort((a, b) => this.edgeScore(data, degrees, b) - this.edgeScore(data, degrees, a));
        const activeEdges = ranked.slice(0, Math.min(edgeCount, Math.max(16, Math.round(Math.sqrt(edgeCount) * 7))));
        for (const edge of activeEdges) {
            const score = this.edgeScore(data, degrees, edge);
            const count = Math.max(1, Math.min(4, Math.ceil(score / 14)));
            for (let item = 0; item < count; item++) {
                this.edgeIndexes.push(edge);
                this.seeds.push((item + 1) / (count + 1));
                this.speeds.push(0.28 + ((score + item * 3) % 9) * 0.035);
            }
        }
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.edgeIndexes.length * 3), 3));
        this.updateSettings(settings);
        this.points.visible = true;
    }

    updateSettings(settings: GalaxyRenderSettings): void {
        this.material.opacity = settings.particleFlow ? settings.particleOpacity * 0.74 : 0;
        this.material.size = 0.018 + settings.particleSize * 0.018;
        this.points.visible = settings.particleFlow && this.edgeIndexes.length > 0;
        this.material.needsUpdate = true;
    }

    update(data: GalaxySceneV2 | null, positions: Float32Array | null, settings: GalaxyRenderSettings, time: number): void {
        if (!data || !positions || !this.points.visible) return;
        const attr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < this.edgeIndexes.length; i++) {
            const edge = this.edgeIndexes[i];
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const t = (this.seeds[i] + time * 0.001 * this.speeds[i] * settings.particleSpeed) % 1;
            attr.setXYZ(
                i,
                THREE.MathUtils.lerp(positions[source * 3], positions[target * 3], t),
                THREE.MathUtils.lerp(positions[source * 3 + 1], positions[target * 3 + 1], t),
                THREE.MathUtils.lerp(positions[source * 3 + 2], positions[target * 3 + 2], t),
            );
        }
        attr.needsUpdate = true;
    }

    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }

    private edgeScore(data: GalaxySceneV2, degrees: Uint16Array, edge: number): number {
        return degrees[data.edgePairs[edge * 2]] + degrees[data.edgePairs[edge * 2 + 1]];
    }
}
