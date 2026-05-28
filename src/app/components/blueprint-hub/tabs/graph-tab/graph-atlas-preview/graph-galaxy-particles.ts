import * as THREE from 'three';

import type { GalaxyRenderSettings } from './graph-galaxy-engine';
import type { GalaxyFocusMask } from './graph-galaxy-focus';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

const MAX_FLOW_PARTICLES = 1800;
const EMPTY_VEC3 = new Float32Array(0);
const EMPTY_SCALAR = new Float32Array(0);
const CAPS_SURFACE_EDGE_MIN_RADIUS = 0.34;
const CAPS_SURFACE_EDGE_MAX_RADIUS_DELTA = 0.36;
const CAPS_SHELL_RADII = [0.54, 0.98, 1.22, 1.34, 1.48, 1.68, 1.92];
const HYBRID_SURFACE_EDGE_MIN_RADIUS = 2.32 * 0.92;
const HYBRID_SURFACE_EDGE_MAX_RADIUS_DELTA = 0.42;

export class GraphGalaxyParticles {
    readonly points: THREE.Points;
    private readonly geometry = new THREE.BufferGeometry();
    private readonly material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        toneMapped: false,
        vertexColors: true,
        uniforms: {
            uBaseSize: { value: 7 },
        },
        vertexShader: `
            uniform float uBaseSize;
            attribute float alpha;
            attribute float flowSize;
            varying vec3 vColor;
            varying float vAlpha;

            void main() {
                vColor = color;
                vAlpha = alpha;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                float perspectiveScale = clamp(180.0 / max(110.0, -mvPosition.z), 0.85, 1.55);
                gl_PointSize = min(7.2, flowSize * uBaseSize * perspectiveScale);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vAlpha;

            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                float softDot = smoothstep(0.5, 0.12, dist);
                float core = smoothstep(0.28, 0.0, dist);
                vec3 litColor = vColor * (0.82 + core * 0.18);
                gl_FragColor = vec4(litColor, vAlpha * softDot);
            }
        `,
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
            this.setEmptyAttributes();
            this.points.visible = false;
            return;
        }

        const particleCount = Math.min(edgeCount, MAX_FLOW_PARTICLES);
        const stride = edgeCount / particleCount;
        for (let i = 0; i < particleCount; i++) {
            const edge = Math.min(edgeCount - 1, Math.floor(i * stride));
            const seed = this.stableUnit(edge * 17 + 3);
            this.edgeIndexes.push(edge);
            this.seeds.push(seed);
            this.speeds.push(0.23 + this.stableUnit(edge * 31 + 11) * 0.32);
        }

        const count = this.edgeIndexes.length;
        this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        this.geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(count), 1));
        this.geometry.setAttribute('flowSize', new THREE.BufferAttribute(new Float32Array(count), 1));
        this.updateSettings(settings);
        this.points.visible = true;
    }

    updateSettings(settings: GalaxyRenderSettings): void {
        this.material.uniforms['uBaseSize'].value = 3.35 + settings.particleSize * 0.95;
        this.points.visible = settings.particleFlow && this.edgeIndexes.length > 0;
    }

    update(
        data: GalaxySceneV2 | null,
        positions: Float32Array | null,
        settings: GalaxyRenderSettings,
        time: number,
        focus?: GalaxyFocusMask | null,
    ): void {
        if (!data || !positions || !this.points.visible) return;
        const positionAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colorAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
        const alphaAttr = this.geometry.getAttribute('alpha') as THREE.BufferAttribute;
        const sizeAttr = this.geometry.getAttribute('flowSize') as THREE.BufferAttribute;
        const baseAlpha = settings.particleOpacity * (focus?.hasFocus ? 0.72 : 0.42);
        const flowSize = 0.62 + settings.particleSize * 0.1;
        const curved = settings.edgeMode === 'curved';
        for (let i = 0; i < this.edgeIndexes.length; i++) {
            const edge = this.edgeIndexes[i];
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const t = (this.seeds[i] + time * 0.001 * this.speeds[i] * settings.particleSpeed) % 1;
            const lift = curved ? this.edgeLift(data, settings, edge, source, target) : 0;
            this.writeEdgePosition(positionAttr, i, data, positions, source, target, lift, t);
            this.writeTargetColor(colorAttr, data, edge, i);
            alphaAttr.setX(i, focus?.hasFocus && focus.edgeLevels[edge] === 0 ? 0 : baseAlpha);
            sizeAttr.setX(i, flowSize);
        }
        positionAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
    }

    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }

    private setEmptyAttributes(): void {
        this.geometry.setAttribute('position', new THREE.BufferAttribute(EMPTY_VEC3, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(EMPTY_VEC3, 3));
        this.geometry.setAttribute('alpha', new THREE.BufferAttribute(EMPTY_SCALAR, 1));
        this.geometry.setAttribute('flowSize', new THREE.BufferAttribute(EMPTY_SCALAR, 1));
    }

    private edgeLift(data: GalaxySceneV2, settings: GalaxyRenderSettings, edge: number, source: number, target: number): number {
        const interGalaxy = data.edgeKinds[edge] === 1;
        const curveScale = THREE.MathUtils.clamp(settings.edgeCurveStrength, 0.25, 1.2) * (interGalaxy ? 0.92 : 0.58);
        return (0.08 + Math.abs(source - target) * 0.002) * curveScale + (interGalaxy ? 0.18 : 0);
    }

    private writeEdgePosition(
        positionAttr: THREE.BufferAttribute,
        particle: number,
        data: GalaxySceneV2,
        positions: Float32Array,
        source: number,
        target: number,
        lift: number,
        t: number,
    ): void {
        if (this.capsSurfaceParticle(data, positions, source, target)) {
            const point = this.capsSurfacePoint(positions, source, target, t);
            if (point) {
                positionAttr.setXYZ(particle, point.x, point.y, point.z);
                return;
            }
        }
        positionAttr.setXYZ(particle, this.edgeX(positions, source, target, t), this.edgeY(positions, source, target, lift, t), this.edgeZ(positions, source, target, t));
    }

    private capsSurfaceParticle(data: GalaxySceneV2, positions: Float32Array, source: number, target: number): boolean {
        if (positions !== data.positions3d) return false;
        const ax = positions[source * 3], ay = positions[source * 3 + 1], az = positions[source * 3 + 2];
        const bx = positions[target * 3], by = positions[target * 3 + 1], bz = positions[target * 3 + 2];
        const ar = Math.hypot(ax, ay, az);
        const br = Math.hypot(bx, by, bz);
        if (data.layoutMode === 'hybridSpace') return this.hybridSurfaceParticle(ar, br, ax, ay, az, bx, by, bz);
        if (data.layoutMode !== 'lorentzTree') return false;
        if (ar < CAPS_SURFACE_EDGE_MIN_RADIUS || br < CAPS_SURFACE_EDGE_MIN_RADIUS) return false;
        if (Math.abs(ar - br) > CAPS_SURFACE_EDGE_MAX_RADIUS_DELTA) return false;
        if (this.capsShellIndex(ar) !== this.capsShellIndex(br)) return false;
        const dot = (ax * bx + ay * by + az * bz) / Math.max(0.000001, ar * br);
        return dot > -0.985;
    }

    private hybridSurfaceParticle(ar: number, br: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
        if (ar < HYBRID_SURFACE_EDGE_MIN_RADIUS || br < HYBRID_SURFACE_EDGE_MIN_RADIUS) return false;
        if (Math.abs(ar - br) > HYBRID_SURFACE_EDGE_MAX_RADIUS_DELTA) return false;
        const dot = (ax * bx + ay * by + az * bz) / Math.max(0.000001, ar * br);
        return dot > -0.985;
    }

    private capsShellIndex(radius: number): number {
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < CAPS_SHELL_RADII.length; index++) {
            const distance = Math.abs(radius - CAPS_SHELL_RADII[index]);
            if (distance >= bestDistance) continue;
            best = index;
            bestDistance = distance;
        }
        return best;
    }

    private capsSurfacePoint(positions: Float32Array, source: number, target: number, t: number): { x: number; y: number; z: number } | null {
        const ax = positions[source * 3], ay = positions[source * 3 + 1], az = positions[source * 3 + 2];
        const bx = positions[target * 3], by = positions[target * 3 + 1], bz = positions[target * 3 + 2];
        const ar = Math.hypot(ax, ay, az);
        const br = Math.hypot(bx, by, bz);
        if (ar <= 0.000001 || br <= 0.000001) return null;
        const anx = ax / ar, any = ay / ar, anz = az / ar;
        const bnx = bx / br, bny = by / br, bnz = bz / br;
        const radius = THREE.MathUtils.lerp(ar, br, t);
        const dot = THREE.MathUtils.clamp(anx * bnx + any * bny + anz * bnz, -1, 1);

        if (dot > 0.9995) {
            const x = THREE.MathUtils.lerp(anx, bnx, t);
            const y = THREE.MathUtils.lerp(any, bny, t);
            const z = THREE.MathUtils.lerp(anz, bnz, t);
            const len = Math.hypot(x, y, z);
            return len <= 0.000001 ? null : { x: x / len * radius, y: y / len * radius, z: z / len * radius };
        }

        if (dot < -0.985) return null;
        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);
        if (Math.abs(sinTheta) <= 0.000001) return null;
        const sourceScale = Math.sin((1 - t) * theta) / sinTheta;
        const targetScale = Math.sin(t * theta) / sinTheta;
        return {
            x: (anx * sourceScale + bnx * targetScale) * radius,
            y: (any * sourceScale + bny * targetScale) * radius,
            z: (anz * sourceScale + bnz * targetScale) * radius,
        };
    }

    private edgeX(positions: Float32Array, source: number, target: number, t: number): number {
        return THREE.MathUtils.lerp(positions[source * 3], positions[target * 3], t);
    }

    private edgeY(positions: Float32Array, source: number, target: number, lift: number, t: number): number {
        return THREE.MathUtils.lerp(positions[source * 3 + 1], positions[target * 3 + 1], t) + lift * Math.sin(Math.PI * t);
    }

    private edgeZ(positions: Float32Array, source: number, target: number, t: number): number {
        return THREE.MathUtils.lerp(positions[source * 3 + 2], positions[target * 3 + 2], t);
    }

    private writeTargetColor(colorAttr: THREE.BufferAttribute, data: GalaxySceneV2, edge: number, particle: number): void {
        const offset = edge * 6 + 3;
        colorAttr.setXYZ(particle, data.edgeColors[offset], data.edgeColors[offset + 1], data.edgeColors[offset + 2]);
    }

    private stableUnit(value: number): number {
        const raw = Math.sin((value + 1) * 12.9898) * 43758.5453;
        return raw - Math.floor(raw);
    }
}
