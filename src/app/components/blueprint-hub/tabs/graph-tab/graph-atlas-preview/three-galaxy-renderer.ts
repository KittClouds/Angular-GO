import * as THREE from 'three';

import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';
import { buildGalaxyFocusMask, type GalaxyFocusMask } from './graph-galaxy-focus';
import { mergeGalaxySettings, type GalaxyRenderSettings } from './graph-galaxy-engine';
import { GraphGalaxyForceController } from './graph-galaxy-force-controller';
import { buildGalaxyGlows, buildGalaxyNodes, type GalaxyNodeObject } from './graph-galaxy-objects';
import { GraphGalaxyParticles } from './graph-galaxy-particles';
import { makeHaloTexture, makeLabelSprite, makeNodeTexture, type LabelSprite } from './graph-galaxy-textures';
import type { GraphRendererMode, GraphRendererPointer, GraphRendererPort } from './graph-renderer-port';

export class ThreeGalaxyRenderer implements GraphRendererPort {
    private renderer: THREE.WebGLRenderer | null = null;
    private readonly scene = new THREE.Scene();
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly perspective = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
    private readonly ortho = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.01, 100);
    private readonly color = new THREE.Color();
    private readonly force = new GraphGalaxyForceController();
    private readonly dragVector = new THREE.Vector3();
    private readonly cameraRight = new THREE.Vector3();
    private readonly cameraUp = new THREE.Vector3();
    private readonly nodeTexture = makeNodeTexture();
    private readonly haloTexture = makeHaloTexture();
    private readonly particles = new GraphGalaxyParticles();
    private mode: GraphRendererMode = '3d';
    private sceneData: GalaxySceneV2 | null = null;
    private nodes: THREE.Group | null = null;
    private glows: THREE.Group | null = null;
    private edges: THREE.LineSegments | null = null;
    private labels: LabelSprite[] = [];
    private selectedId: string | null = null;
    private hoverId: string | null = null;
    private settings: GalaxyRenderSettings = mergeGalaxySettings();
    private nodeShape = this.settings.nodeShape;
    private yaw = -0.34;
    private pitch = 0.22;
    private distance = 7.2;
    private panX = 0;
    private panY = 0;
    private panZ = 0;

    mount(canvas: HTMLCanvasElement): void {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x02040a, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.scene.add(this.particles.points);
        this.resetCamera();
    }

    setScene(scene: GalaxySceneV2): void {
        this.sceneData = scene;
        this.clearObjects();
        this.nodeShape = this.settings.nodeShape;
        this.nodes = buildGalaxyNodes(scene, this.settings, this.nodeTexture);
        this.glows = buildGalaxyGlows(scene, this.haloTexture);
        this.edges = this.buildEdges(scene);
        this.force.bind(scene);
        this.particles.bind(scene, this.settings);
        this.force.setMode(this.mode);
        if (this.edges) this.scene.add(this.edges);
        if (this.glows) this.scene.add(this.glows);
        if (this.nodes) this.scene.add(this.nodes);
        this.applyModePositions();
        this.render();
    }

    setSettings(settings: Partial<GalaxyRenderSettings> | null): void {
        const previousShape = this.settings.nodeShape;
        this.settings = mergeGalaxySettings(settings);
        if (this.sceneData) this.particles.bind(this.sceneData, this.settings);
        if (this.sceneData && previousShape !== this.settings.nodeShape) {
            this.nodeShape = this.settings.nodeShape;
            this.rebuildNodeObjects(this.sceneData);
            this.applyModePositions();
            this.render();
            return;
        }
        this.applyMaterialSettings();
        this.applyModePositions();
        this.render();
    }

    setMode(mode: GraphRendererMode): void {
        this.mode = mode;
        this.force.setMode(mode);
        this.applyModePositions();
        this.updateCamera();
    }

    resize(width: number, height: number, dpr: number): void {
        if (!this.renderer) return;
        this.renderer.setPixelRatio(dpr);
        this.renderer.setSize(width, height, false);
        this.perspective.aspect = Math.max(0.01, width / Math.max(1, height));
        const aspect = this.perspective.aspect;
        this.ortho.left = -4.2 * aspect;
        this.ortho.right = 4.2 * aspect;
        this.ortho.top = 3.1;
        this.ortho.bottom = -3.1;
        this.updateCamera();
    }

    render(): void {
        const renderer = this.renderer;
        if (!renderer) return;
        this.particles.update(this.sceneData, this.positions(), this.settings, performance.now());
        renderer.render(this.scene, this.camera());
    }

    rotate(deltaX: number, deltaY: number): void {
        if (this.mode === '2d') {
            this.pan(deltaX, deltaY);
            return;
        }
        this.yaw += deltaX * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * 0.004, -0.95, 0.95);
        this.updateCamera();
    }

    pan(deltaX: number, deltaY: number): void {
        const scale = this.mode === '2d' ? 0.008 * this.distance : 0.0045 * this.distance;
        this.panX -= deltaX * scale;
        this.panY += deltaY * scale;
        this.updateCamera();
    }

    zoom(delta: number): void {
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.0012), 2.2, 22);
        this.updateCamera();
    }

    resetCamera(): void {
        this.yaw = -0.34;
        this.pitch = 0.22;
        this.distance = 7.2;
        this.panX = 0;
        this.panY = 0;
        this.panZ = 0;
        this.updateCamera();
    }

    fitToGraph(): void {
        this.distance = this.mode === '2d' ? 6.2 : 7.2;
        this.panX = 0;
        this.panY = 0;
        this.panZ = 0;
        this.updateCamera();
    }

    focusNode(id: string): void {
        const data = this.sceneData;
        if (!data) return;
        const index = data.ids.indexOf(id);
        if (index < 0) return;
        const positions = this.mode === '2d' ? data.positions2d : data.positions3d;
        this.panX = positions[index * 3];
        this.panY = positions[index * 3 + 1];
        this.panZ = positions[index * 3 + 2];
        this.distance = Math.min(this.distance, 5.4);
        this.updateCamera();
    }

    clearFocus(): void {
        this.panX = this.panY = this.panZ = 0;
        this.updateCamera();
    }

    beginNodeDrag(id: string): boolean {
        return this.force.begin(id);
    }

    dragNode(deltaX: number, deltaY: number): boolean {
        if (this.settings.nodeDragMode === 'camera') return false;
        const scale = this.mode === '2d' ? 0.008 * this.distance : 0.0045 * this.distance;
        if (this.mode === '2d') {
            this.dragVector.set(deltaX * scale, -deltaY * scale, 0);
        } else {
            this.camera().matrixWorld.extractBasis(this.cameraRight, this.cameraUp, this.dragVector);
            this.dragVector.copy(this.cameraRight).multiplyScalar(deltaX * scale).addScaledVector(this.cameraUp, -deltaY * scale);
        }
        if (!this.force.drag(this.dragVector, this.settings.nodeDragMode)) return false;
        this.updateLiveGeometry();
        return true;
    }

    endNodeDrag(): boolean {
        return this.force.end(this.settings.nodeDragMode);
    }

    tickForces(): boolean {
        const active = this.force.tick();
        active ? this.updateLiveGeometry() : this.applyModePositions();
        return active;
    }

    hasActiveForces(): boolean {
        return this.force.active();
    }

    selectNode(id: string | null): void {
        if (this.selectedId === id) return;
        this.selectedId = id;
        this.applyModePositions();
    }

    hoverNode(id: string | null): void {
        if (this.hoverId === id) return;
        this.hoverId = id;
        this.applyModePositions();
    }

    pick(pointer: GraphRendererPointer): string | null {
        if (!this.nodes || !this.sceneData) return null;
        this.pointer.x = (pointer.x / Math.max(1, pointer.width)) * 2 - 1;
        this.pointer.y = -(pointer.y / Math.max(1, pointer.height)) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera());
        const hit = this.raycaster.intersectObjects(this.nodes.children, false)[0];
        const index = Number(hit?.object.userData['index']);
        return Number.isFinite(index) ? this.sceneData.ids[index] ?? null : null;
    }

    dispose(): void {
        this.clearObjects();
        this.nodeTexture.dispose();
        this.haloTexture.dispose();
        this.scene.remove(this.particles.points);
        this.particles.dispose();
        this.renderer?.dispose();
        this.renderer = null;
    }

    private buildEdges(scene: GalaxySceneV2): THREE.LineSegments | null {
        if (!scene.edgePairs.length) return null;
        const geometry = new THREE.BufferGeometry();
        const edgeCount = scene.edgePairs.length / 2;
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeCount * 16 * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(edgeCount * 16 * 3), 3));
        const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: this.settings.edgeOpacity, blending: THREE.AdditiveBlending, toneMapped: false });
        return new THREE.LineSegments(geometry, material);
    }

    private applyModePositions(): void {
        const data = this.sceneData;
        if (!data) return;
        const positions = this.mode === '2d' ? data.positions2d : data.positions3d;
        const focus = buildGalaxyFocusMask(data, this.selectedId, this.hoverId);
        this.updateInstances(data, positions, focus);
        this.updateEdgeGeometry(data, positions, focus);
        this.rebuildLabels(data, positions);
    }

    private updateLiveGeometry(): void {
        const data = this.sceneData;
        if (!data) return;
        const positions = this.positions();
        if (!positions) return;
        const focus = buildGalaxyFocusMask(data, this.selectedId, this.hoverId);
        this.updateInstances(data, positions, focus);
        this.updateEdgeGeometry(data, positions, focus);
    }

    private updateInstances(data: GalaxySceneV2, positions: Float32Array, focus: GalaxyFocusMask): void {
        if (!this.nodes || !this.glows) return;
        for (let i = 0; i < data.ids.length; i++) {
            const node = this.nodes.children[i] as GalaxyNodeObject | undefined;
            const glow = this.glows.children[i] as THREE.Sprite | undefined;
            if (!node || !glow) continue;
            const active = data.ids[i] === this.selectedId;
            const hovered = data.ids[i] === this.hoverId;
            const level = focus.nodeLevels[i] ?? 1;
            const dimmed = focus.hasFocus && level === 0;
            const neighbor = focus.hasFocus && level === 2;
            const pulse = active && this.settings.selectedPulse ? 1.22 : 1;
            const core = Math.max(0.052, data.radii[i] * 0.034) * pulse;
            const sphere = this.nodeShape === 'sphere';
            const halo = core * this.settings.glow * (sphere
                ? (hovered ? 4.8 : active ? 5.2 : neighbor ? 3.4 : dimmed ? 1.35 : 2.9)
                : (hovered ? 7.6 : active ? 7.9 : neighbor ? 4.8 : dimmed ? 1.9 : 4.1));
            node.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            node.scale.setScalar(core * (sphere
                ? (hovered || active ? 1.85 : neighbor ? 1.48 : dimmed ? 1.03 : 1.28)
                : (hovered || active ? 3.9 : neighbor ? 3.18 : dimmed ? 2.35 : 2.95)));
            this.nodeColor(data, i, active, hovered, neighbor, dimmed);
            const material = node.material as THREE.SpriteMaterial | THREE.MeshBasicMaterial;
            material.color.copy(this.color);
            material.opacity = dimmed ? 0.18 : neighbor ? 0.82 : hovered || active ? 1 : 0.94;
            glow.position.copy(node.position);
            glow.scale.setScalar(halo);
            this.glowColor(data, i, active, hovered, dimmed);
            glow.material.color.copy(this.color);
            glow.material.opacity = THREE.MathUtils.clamp((dimmed ? 0.05 : hovered || active ? 0.72 : neighbor ? 0.38 : 0.34) * this.settings.glow, 0, 0.82);
        }
    }

    private updateEdgeGeometry(data: GalaxySceneV2, positions: Float32Array, focus: GalaxyFocusMask): void {
        if (!this.edges) return;
        const positionAttr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colorAttr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
        let cursor = 0;
        const steps = this.settings.edgeMode === 'curved' ? 8 : 1;
        for (let edge = 0; edge < data.edgePairs.length / 2; edge++) {
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const ax = positions[source * 3], ay = positions[source * 3 + 1], az = positions[source * 3 + 2];
            const bx = positions[target * 3], by = positions[target * 3 + 1], bz = positions[target * 3 + 2];
            const lift = this.settings.edgeMode === 'curved' ? 0.08 + Math.abs(source - target) * 0.002 : 0;
            for (let step = 0; step < steps; step++) {
                const t0 = step / steps;
                const t1 = (step + 1) / steps;
                cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, lift, t0);
                cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, lift, t1);
            }
            for (let step = steps; step < 8; step++) {
                cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, 0, 1);
                cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, 0, 1);
            }
        }
        positionAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        this.edges.geometry.computeBoundingSphere();
    }

    private rebuildLabels(data: GalaxySceneV2, positions: Float32Array): void {
        this.clearLabels();
        if (this.settings.labelMode === 'off') return;
        const limit = data.ids.length <= 18 ? data.ids.length : Math.max(1, this.settings.labelLimit);
        const important = [...data.ids.keys()].sort((a, b) => data.radii[b] - data.radii[a]).slice(0, limit);
        const selected = this.selectedId ? data.ids.indexOf(this.selectedId) : -1;
        const hovered = this.hoverId ? data.ids.indexOf(this.hoverId) : -1;
        const labelIndexes = new Set<number>();
        if (this.settings.labelMode === 'always' || this.settings.labelMode === 'important') {
            for (const index of important) labelIndexes.add(index);
        }
        if (selected >= 0) labelIndexes.add(selected);
        if (hovered >= 0) labelIndexes.add(hovered);
        for (const index of labelIndexes) {
            const active = index === selected || index === hovered;
            const sprite = makeLabelSprite(data.labels[index], active);
            sprite.position.set(positions[index * 3], positions[index * 3 + 1] + Math.max(0.11, data.radii[index] * 0.045), positions[index * 3 + 2]);
            sprite.scale.set(active ? 0.72 : 0.52, active ? 0.2 : 0.15, 1);
            this.labels.push(sprite);
            this.scene.add(sprite);
        }
    }

    private updateCamera(): void {
        const target = new THREE.Vector3(this.panX, this.panY, this.panZ);
        if (this.mode === '3d') {
            const x = target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
            const y = target.y + Math.sin(this.pitch) * this.distance;
            const z = Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
            this.perspective.position.set(x, y, z);
            this.perspective.lookAt(target);
            this.perspective.updateProjectionMatrix();
        } else {
            this.ortho.position.set(target.x, target.y, this.distance);
            this.ortho.lookAt(target);
            this.ortho.zoom = THREE.MathUtils.clamp(8 / this.distance, 0.45, 3.5);
            this.ortho.updateProjectionMatrix();
        }
        this.render();
    }

    private camera(): THREE.Camera {
        return this.mode === '3d' ? this.perspective : this.ortho;
    }

    private colorPart(data: GalaxySceneV2, index: number, channel: number): number {
        const value = data.colors[index * 3 + channel];
        const red = data.colors[index * 3];
        const green = data.colors[index * 3 + 1];
        const blue = data.colors[index * 3 + 2];
        if (!Number.isFinite(value) || red + green + blue <= 0.001) return [0.82, 0.36, 1][channel];
        return value;
    }

    private nodeColor(data: GalaxySceneV2, index: number, active: boolean, hovered: boolean, neighbor: boolean, dimmed: boolean): void {
        if (active) {
            this.color.setRGB(0.28, 0.95, 0.92);
            return;
        }
        if (this.nodeShape === 'sphere') {
            this.color.setRGB(0.34, 0.08, 0.54);
            this.color.offsetHSL(0, hovered ? 0.18 : neighbor ? 0.1 : 0.06, hovered ? 0.16 : neighbor ? 0.07 : dimmed ? -0.16 : -0.01);
            return;
        }
        this.color.setRGB(this.colorPart(data, index, 0), this.colorPart(data, index, 1), this.colorPart(data, index, 2));
        this.color.offsetHSL(0, hovered ? 0.16 : neighbor ? 0.08 : 0.05, hovered ? 0.12 : neighbor ? 0.04 : dimmed ? -0.2 : -0.03);
    }

    private glowColor(data: GalaxySceneV2, index: number, active: boolean, hovered: boolean, dimmed: boolean): void {
        if (active) {
            this.color.setRGB(0.16, 0.92, 1);
            return;
        }
        if (this.nodeShape === 'sphere') {
            this.color.setRGB(0.62, 0.18, 0.86);
            this.color.offsetHSL(0, hovered ? 0.16 : 0.08, hovered ? 0.12 : dimmed ? -0.18 : -0.02);
            return;
        }
        this.color.setRGB(this.colorPart(data, index, 0), this.colorPart(data, index, 1), this.colorPart(data, index, 2));
        this.color.offsetHSL(0, hovered ? 0.26 : 0.2, hovered ? 0.16 : dimmed ? -0.22 : -0.02);
    }

    private applyMaterialSettings(): void {
        if (this.edges) {
            this.edges.visible = this.settings.edgeMode !== 'hidden';
            const material = this.edges.material as THREE.LineBasicMaterial;
            material.opacity = this.settings.edgeMode === 'hidden' ? 0 : Math.max(0.02, this.settings.edgeOpacity);
            material.linewidth = Math.max(1, this.settings.edgeWidth);
            material.needsUpdate = true;
        }
        this.glows?.children.forEach((child) => {
            const material = (child as THREE.Sprite).material;
            material.opacity = THREE.MathUtils.clamp(this.settings.glow * 0.36, 0, 0.72);
            material.needsUpdate = true;
        });
        this.particles.updateSettings(this.settings);
    }

    private rebuildNodeObjects(data: GalaxySceneV2): void {
        for (const group of [this.nodes, this.glows]) {
            if (!group) continue;
            this.scene.remove(group);
            group.traverse((child) => {
                const drawable = child as THREE.Mesh | THREE.Sprite;
                const geometry = (drawable as THREE.Mesh).geometry;
                geometry?.dispose();
                const material = drawable.material;
                if (Array.isArray(material)) material.forEach((item) => item.dispose());
                else material?.dispose();
            });
        }
        this.nodes = buildGalaxyNodes(data, this.settings, this.nodeTexture);
        this.glows = buildGalaxyGlows(data, this.haloTexture);
        if (this.glows) this.scene.add(this.glows);
        if (this.nodes) this.scene.add(this.nodes);
    }

    private positions(): Float32Array | null {
        if (!this.sceneData) return null;
        return this.mode === '2d' ? this.sceneData.positions2d : this.sceneData.positions3d;
    }

    private writeEdgeVertex(
        positionAttr: THREE.BufferAttribute,
        colorAttr: THREE.BufferAttribute,
        cursor: number,
        data: GalaxySceneV2,
        focus: GalaxyFocusMask,
        edge: number,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        lift: number,
        t: number,
    ): number {
        const curve = lift * Math.sin(Math.PI * t);
        positionAttr.setXYZ(cursor, THREE.MathUtils.lerp(ax, bx, t), THREE.MathUtils.lerp(ay, by, t) + curve, THREE.MathUtils.lerp(az, bz, t));
        const color = this.edgeColor(data, edge, t);
        const boost = focus.hasFocus ? (focus.edgeLevels[edge] ? 1.35 : 0.1) : 1;
        colorAttr.setXYZ(cursor, Math.min(1, color.r * boost), Math.min(1, color.g * boost), Math.min(1, color.b * boost));
        return cursor + 1;
    }

    private edgeColor(data: GalaxySceneV2, edge: number, t: number): THREE.Color {
        if (this.settings.edgeColorMode === 'muted') return this.color.setRGB(0.22, 0.25, 0.3);
        if (this.settings.edgeColorMode === 'cyan') return this.color.setRGB(0.16, 0.86, 0.96);
        if (this.settings.edgeColorMode === 'confidence') {
            const confidence = THREE.MathUtils.clamp(data.edgeAlpha[edge] * 3, 0.18, 1);
            return this.color.setRGB(0.12 + confidence * 0.18, 0.38 + confidence * 0.52, 0.7 + confidence * 0.28);
        }
        const offset = edge * 6 + (t < 0.5 ? 0 : 3);
        return this.color.setRGB(data.edgeColors[offset], data.edgeColors[offset + 1], data.edgeColors[offset + 2]);
    }

    private clearObjects(): void {
        for (const object of [this.nodes, this.glows, this.edges]) {
            if (!object) continue;
            this.scene.remove(object);
            if (object instanceof THREE.Group) {
                object.traverse((child) => {
                    const drawable = child as THREE.Mesh | THREE.Sprite;
                    const geometry = (drawable as THREE.Mesh).geometry;
                    geometry?.dispose();
                    const material = drawable.material;
                    if (Array.isArray(material)) material.forEach((item) => item.dispose());
                    else material?.dispose();
                });
            } else {
                object.geometry.dispose();
                const material = object.material;
                Array.isArray(material) ? material.forEach((item) => item.dispose()) : material.dispose();
            }
        }
        this.clearLabels();
        this.nodes = null;
        this.glows = null;
        this.edges = null;
    }

    private clearLabels(): void {
        for (const label of this.labels) {
            this.scene.remove(label);
            label.material.map.dispose();
            label.material.dispose();
        }
        this.labels = [];
    }
}
