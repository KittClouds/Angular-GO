import * as THREE from 'three';

import type { GalaxyHopfRibbonView, GalaxyLorentzGuideView, GalaxySceneGroupView, GalaxySceneV2 } from './graph-galaxy-scene-v2';
import { buildGalaxyFocusMask, type GalaxyFocusMask } from './graph-galaxy-focus';
import { mergeGalaxySettings, type GalaxyRenderSettings } from './graph-galaxy-engine';
import { GraphGalaxyForceController, productManifoldExpansionScale } from './graph-galaxy-force-controller';
import { buildGalaxyGlows, buildGalaxyNodes, type GalaxyNodeObject } from './graph-galaxy-objects';
import { GraphGalaxyParticles } from './graph-galaxy-particles';
import { makeAtomTexture, makeHaloTexture, makeLabelSprite, makeNodeTexture, type LabelSprite } from './graph-galaxy-textures';
import type { GraphRendererMode, GraphRendererPointer, GraphRendererPort } from './graph-renderer-port';

const MAX_EDGE_SEGMENTS = 8;
const MAX_EDGE_STROKES = 5;
const MAX_HOPF_RIBBON_GUIDES = 128;
const MAX_HOPF_DATA_TUBES = 20;
const MAX_HOPF_TORUS_TUBES = 12;
const HOPF_TUBE_SEGMENTS = 96;
const HOPF_TUBE_RADIAL_SEGMENTS = 6;
const MAX_LORENTZ_GUIDES = 260;
const MAX_LORENTZ_TUBES = 40;
const LORENTZ_TUBE_SEGMENTS = 36;
const LORENTZ_TUBE_RADIAL_SEGMENTS = 5;
const PRODUCT_KLEIN_RADIUS = 2.18;
const PRODUCT_KLEIN_RING_SEGMENTS = 96;
const PRODUCT_HOPF_TUBE_SCALE = 0.75;
const CAPS_SURFACE_EDGE_MIN_RADIUS = 0.34;
const CAPS_SURFACE_EDGE_MAX_RADIUS_DELTA = 0.36;
const CAPS_SHELL_RADII = [0.54, 0.98, 1.22, 1.34, 1.48, 1.68, 1.92];
const HYBRID_SURFACE_EDGE_MIN_RADIUS = 2.32 * 0.92;
const HYBRID_SURFACE_EDGE_MAX_RADIUS_DELTA = 0.42;
type GuideSurface = 'default' | 'product';

export class ThreeGalaxyRenderer implements GraphRendererPort {
    private renderer: THREE.WebGLRenderer | null = null;
    private readonly scene = new THREE.Scene();
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly dragPlane = new THREE.Plane();
    private readonly dragPlanePoint = new THREE.Vector3();
    private readonly dragHit = new THREE.Vector3();
    private readonly dragOffset = new THREE.Vector3();
    private readonly dragTarget = new THREE.Vector3();
    private readonly zoomPlane = new THREE.Plane();
    private readonly zoomBefore = new THREE.Vector3();
    private readonly zoomAfter = new THREE.Vector3();
    private readonly zoomNormal = new THREE.Vector3();
    private readonly pickVector = new THREE.Vector3();
    private readonly cameraTarget = new THREE.Vector3();
    private readonly perspective = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
    private readonly ortho = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.01, 100);
    private readonly color = new THREE.Color();
    private readonly densityVector = new THREE.Vector3();
    private readonly edgeSurfacePoint = new THREE.Vector3();
    private readonly force = new GraphGalaxyForceController();
    private readonly dragVector = new THREE.Vector3();
    private readonly atomTexture = makeAtomTexture();
    private readonly nodeTexture = makeNodeTexture();
    private readonly haloTexture = makeHaloTexture();
    private readonly particles = new GraphGalaxyParticles();
    private mode: GraphRendererMode = '3d';
    private sceneData: GalaxySceneV2 | null = null;
    private nodes: THREE.Group | null = null;
    private glows: THREE.Group | null = null;
    private shells: THREE.Group | null = null;
    private edges: THREE.LineSegments | null = null;
    private labels: LabelSprite[] = [];
    private focusMask: GalaxyFocusMask | null = null;
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
    private dragReady = false;
    private densityBins = new Uint16Array(0);
    private densityNodeBins = new Int32Array(0);
    private densityFactors = new Float32Array(0);

    mount(canvas: HTMLCanvasElement): boolean {
        if (this.renderer) return false;
        this.scene.background = new THREE.Color(0x02040a);
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
        this.renderer.setClearColor(0x02040a, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.scene.add(this.particles.points);
        this.resetCamera();
        return true;
    }

    hasContext(): boolean {
        return Boolean(this.renderer);
    }

    releaseContext(): void {
        const renderer = this.renderer;
        if (!renderer) return;
        renderer.forceContextLoss();
        renderer.dispose();
        this.renderer = null;
    }

    setScene(scene: GalaxySceneV2): void {
        this.sceneData = scene;
        this.clearObjects();
        this.nodeShape = this.settings.nodeShape;
        this.shells = this.buildGroupShells(scene);
        this.nodes = buildGalaxyNodes(scene, this.settings, this.nodeTexture, this.atomTexture);
        this.glows = buildGalaxyGlows(scene, this.haloTexture);
        this.edges = this.buildEdges(scene);
        this.force.bind(scene);
        this.force.setSettings(this.settings);
        this.particles.bind(scene, this.settings);
        this.force.setMode(this.mode);
        if (this.shells) this.scene.add(this.shells);
        if (this.edges) this.scene.add(this.edges);
        if (this.glows) this.scene.add(this.glows);
        if (this.nodes) this.scene.add(this.nodes);
        this.applyModePositions();
        this.render();
    }

    setSettings(settings: Partial<GalaxyRenderSettings> | null): void {
        const previousShape = this.settings.nodeShape;
        this.settings = mergeGalaxySettings(settings);
        this.force.setSettings(this.settings);
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
        this.particles.update(this.sceneData, this.positions(), this.settings, performance.now(), this.focusMask);
        renderer.render(this.scene, this.camera());
    }

    rotate(deltaX: number, deltaY: number): void {
        if (this.mode === '2d') {
            this.pan(deltaX, deltaY);
            return;
        }
        this.yaw += deltaX * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * 0.004, -1.35, 1.35);
        this.updateCamera();
    }

    pan(deltaX: number, deltaY: number): void {
        const scale = this.mode === '2d' ? 0.008 * this.distance : 0.0045 * this.distance;
        this.panX -= deltaX * scale;
        this.panY += deltaY * scale;
        this.updateCamera();
    }

    zoom(delta: number): void {
        const nextDistance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.0012), 2.2, 22);
        if (nextDistance === this.distance) return;
        this.distance = nextDistance;
        this.updateCamera();
    }

    zoomAt(delta: number, pointer: GraphRendererPointer): void {
        const nextDistance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.0012), 2.2, 22);
        if (nextDistance === this.distance) return;
        const hasAnchor = this.pointerToCameraTargetPlane(pointer, this.zoomBefore);
        this.distance = nextDistance;
        if (!hasAnchor) {
            this.updateCamera();
            return;
        }
        this.updateCamera(false);
        if (this.pointerToCameraTargetPlane(pointer, this.zoomAfter)) {
            this.zoomBefore.sub(this.zoomAfter);
            this.panX += this.zoomBefore.x;
            this.panY += this.zoomBefore.y;
            this.panZ += this.zoomBefore.z;
        }
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

    beginNodeDrag(id: string, pointer: GraphRendererPointer): boolean {
        if (!this.force.begin(id)) return false;
        this.dragReady = this.configureNodeDrag(pointer);
        return this.dragReady;
    }

    dragNode(pointer: GraphRendererPointer): boolean {
        if (this.settings.nodeDragMode === 'camera') return false;
        if (!this.dragReady || !this.pointerToDragPlane(pointer, this.dragHit)) return false;
        this.dragTarget.copy(this.dragHit).add(this.dragOffset);
        if (this.mode === '2d') this.dragTarget.z = 0;
        if (!this.force.dragTo(this.dragTarget, this.settings.nodeDragMode)) return false;
        this.updateLiveGeometry();
        return true;
    }

    endNodeDrag(): boolean {
        this.dragReady = false;
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
        if (!this.sceneData) return null;
        const screenHit = this.screenSpacePick(pointer);
        if (screenHit >= 0) return this.sceneData.ids[screenHit] ?? null;
        if (!this.nodes) return null;
        this.pointer.x = (pointer.x / Math.max(1, pointer.width)) * 2 - 1;
        this.pointer.y = -(pointer.y / Math.max(1, pointer.height)) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera());
        const hit = this.raycaster.intersectObjects(this.nodes.children, false)[0];
        const index = Number(hit?.object.userData['index']);
        return Number.isFinite(index) ? this.sceneData.ids[index] ?? null : null;
    }

    dispose(): void {
        this.clearObjects();
        this.atomTexture.dispose();
        this.nodeTexture.dispose();
        this.haloTexture.dispose();
        this.scene.remove(this.particles.points);
        this.particles.dispose();
        this.releaseContext();
        this.renderer = null;
    }

    private buildEdges(scene: GalaxySceneV2): THREE.LineSegments | null {
        if (!scene.edgePairs.length) return null;
        const geometry = new THREE.BufferGeometry();
        const edgeCount = scene.edgePairs.length / 2;
        const vertexCapacity = edgeCount * MAX_EDGE_SEGMENTS * 2 * MAX_EDGE_STROKES;
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCapacity * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexCapacity * 3), 3));
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.edgeMaterialOpacity(),
            linewidth: this.edgeMaterialWidth(),
            blending: THREE.NormalBlending,
            toneMapped: false,
        });
        return new THREE.LineSegments(geometry, material);
    }

    private applyModePositions(): void {
        const data = this.sceneData;
        if (!data) return;
        const positions = this.mode === '2d' ? data.positions2d : data.positions3d;
        const focus = buildGalaxyFocusMask(data, this.selectedId, this.hoverId);
        this.focusMask = focus;
        this.updateGroupShells(data);
        this.updateLorentzGuideGeometry(data, positions);
        this.updateGuideFocus(data, focus);
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
        this.focusMask = focus;
        this.updateGroupShells(data);
        this.updateLorentzGuideGeometry(data, positions);
        this.updateGuideFocus(data, focus);
        this.updateInstances(data, positions, focus);
        this.updateEdgeGeometry(data, positions, focus);
    }

    private updateInstances(data: GalaxySceneV2, positions: Float32Array, focus: GalaxyFocusMask): void {
        if (!this.nodes || !this.glows) return;
        const density = this.nodeDensityFactors(data, positions);
        for (let i = 0; i < data.ids.length; i++) {
            const node = this.nodes.children[i] as GalaxyNodeObject | undefined;
            const glow = this.glows.children[i] as THREE.Sprite | undefined;
            if (!node || !glow) continue;
            const densityFactor = density[i] ?? 1;
            const active = data.ids[i] === this.selectedId;
            const hovered = data.ids[i] === this.hoverId;
            const level = focus.nodeLevels[i] ?? 1;
            const dimmed = focus.hasFocus && level === 0;
            const neighbor = focus.hasFocus && level === 2;
            const pulse = active && this.settings.selectedPulse ? 1.14 : 1;
            const core = Math.max(0.038, data.radii[i] * 0.021) * pulse;
            const sphere = this.nodeShape === 'sphere';
            const atom = this.nodeShape === 'atom';
            const productAtom = atom && data.layoutMode === 'productManifold';
            const halo = atom ? 0 : core * this.settings.glow * (sphere
                    ? (hovered ? 1.94 : active ? 2.12 : neighbor ? 1.28 : dimmed ? 0.52 : 0.94)
                    : (hovered ? 4.9 : active ? 5.05 : neighbor ? 3.1 : dimmed ? 1.15 : 2.45));
            node.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            node.scale.setScalar(core * (atom
                ? (hovered || active ? 2.38 : neighbor ? 1.84 : dimmed ? 1.15 : 1.6) * (productAtom ? 0.93 : 1)
                : sphere
                    ? (hovered || active ? 0.89 : neighbor ? 0.72 : dimmed ? 0.52 : 0.6)
                    : (hovered || active ? 2.65 : neighbor ? 2.02 : dimmed ? 1.34 : 1.72)));
            this.nodeColor(data, i, active, hovered, neighbor, dimmed);
            const material = node.material as THREE.SpriteMaterial | THREE.MeshBasicMaterial;
            material.color.copy(this.color);
            material.opacity = productAtom
                ? (dimmed ? 0.16 : neighbor ? 0.86 : hovered || active ? 1 : 0.98)
                : (dimmed ? 0.18 : neighbor ? 0.82 : hovered || active ? 1 : 0.94);
            glow.position.copy(node.position);
            glow.scale.setScalar(halo * (0.82 + densityFactor * 0.18));
            this.glowColor(data, i, active, hovered, dimmed);
            glow.material.color.copy(this.color);
            const glowBase = atom ? 0 : sphere
                    ? (dimmed ? 0.012 : hovered || active ? 0.28 : neighbor ? 0.11 : 0.078)
                    : (dimmed ? 0.04 : hovered || active ? 0.58 : neighbor ? 0.28 : 0.22);
            glow.material.opacity = THREE.MathUtils.clamp(glowBase * this.settings.glow * densityFactor, 0, 0.24);
            glow.visible = glow.material.opacity > 0;
        }
    }

    private nodeDensityFactors(data: GalaxySceneV2, positions: Float32Array): Float32Array {
        const count = data.ids.length;
        if (this.densityFactors.length < count) this.densityFactors = new Float32Array(count);
        this.densityFactors.fill(1, 0, count);
        if (count < 2) return this.densityFactors;

        const renderer = this.renderer;
        const canvas = renderer?.domElement;
        const width = Math.max(1, canvas?.clientWidth || canvas?.width || 1);
        const height = Math.max(1, canvas?.clientHeight || canvas?.height || 1);
        const cellSize = 26;
        const cols = Math.max(1, Math.ceil(width / cellSize));
        const rows = Math.max(1, Math.ceil(height / cellSize));
        const binCount = cols * rows;
        if (this.densityBins.length < binCount) this.densityBins = new Uint16Array(binCount);
        if (this.densityNodeBins.length < count) this.densityNodeBins = new Int32Array(count);
        this.densityBins.fill(0, 0, binCount);
        this.densityNodeBins.fill(-1, 0, count);

        const camera = this.camera();
        for (let i = 0; i < count; i++) {
            const offset = i * 3;
            this.densityVector.set(positions[offset], positions[offset + 1], positions[offset + 2]).project(camera);
            if (this.densityVector.z < -1 || this.densityVector.z > 1) continue;
            const sx = (this.densityVector.x * 0.5 + 0.5) * width;
            const sy = (-this.densityVector.y * 0.5 + 0.5) * height;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
            const bin = Math.floor(sx / cellSize) + Math.floor(sy / cellSize) * cols;
            this.densityNodeBins[i] = bin;
            if (this.densityBins[bin] < 65535) this.densityBins[bin]++;
        }

        for (let i = 0; i < count; i++) {
            const bin = this.densityNodeBins[i];
            if (bin < 0) continue;
            const x = bin % cols;
            const y = Math.floor(bin / cols);
            let local = 0;
            for (let yy = Math.max(0, y - 1); yy <= Math.min(rows - 1, y + 1); yy++) {
                for (let xx = Math.max(0, x - 1); xx <= Math.min(cols - 1, x + 1); xx++) {
                    local += this.densityBins[xx + yy * cols];
                }
            }
            this.densityFactors[i] = THREE.MathUtils.clamp(1 / Math.sqrt(1 + Math.max(0, local - 1) * 0.42), 0.28, 1);
        }
        return this.densityFactors;
    }

    private updateEdgeGeometry(data: GalaxySceneV2, positions: Float32Array, focus: GalaxyFocusMask): void {
        if (!this.edges) return;
        const positionAttr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colorAttr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
        positionAttr.array.fill(0);
        colorAttr.array.fill(0);
        let cursor = 0;
        const baseSteps = this.settings.edgeMode === 'curved' ? MAX_EDGE_SEGMENTS : 1;
        const strokes = this.edgeStrokeCount();
        const strokeOffset = this.edgeStrokeOffset();
        for (let edge = 0; edge < data.edgePairs.length / 2; edge++) {
            const interGalaxy = data.edgeKinds[edge] === 1;
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const ax = positions[source * 3], ay = positions[source * 3 + 1], az = positions[source * 3 + 2];
            const bx = positions[target * 3], by = positions[target * 3 + 1], bz = positions[target * 3 + 2];
            const surfaceEdge = this.capsSurfaceEdge(data, ax, ay, az, bx, by, bz);
            const steps = surfaceEdge ? MAX_EDGE_SEGMENTS : baseSteps;
            const curveScale = THREE.MathUtils.clamp(this.settings.edgeCurveStrength, 0.25, 1.2) * (interGalaxy ? 0.92 : 0.58);
            const lift = this.settings.edgeMode === 'curved'
                ? (0.08 + Math.abs(source - target) * 0.002) * curveScale + (interGalaxy ? 0.18 : 0)
                : 0;
            const dx = bx - ax;
            const dy = by - ay;
            const length = Math.hypot(dx, dy) || 1;
            const normalX = -dy / length;
            const normalY = dx / length;
            for (let stroke = 0; stroke < strokes; stroke++) {
                const side = stroke === 0 ? 0 : Math.ceil(stroke / 2) * (stroke % 2 === 0 ? -1 : 1);
                const ox = normalX * side * strokeOffset;
                const oy = normalY * side * strokeOffset;
                for (let step = 0; step < steps; step++) {
                    const t0 = step / steps;
                    const t1 = (step + 1) / steps;
                    if (surfaceEdge) {
                        cursor = this.writeCapsSurfaceEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, ox, oy, t0);
                        cursor = this.writeCapsSurfaceEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax, ay, az, bx, by, bz, ox, oy, t1);
                    } else {
                        cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax + ox, ay + oy, az, bx + ox, by + oy, bz, lift, t0);
                        cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax + ox, ay + oy, az, bx + ox, by + oy, bz, lift, t1);
                    }
                }
            }
        }
        this.edges.geometry.setDrawRange(0, cursor);
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

    private updateCamera(render = true): void {
        const target = this.cameraTarget.set(this.panX, this.panY, this.panZ);
        if (this.mode === '3d') {
            const x = target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance;
            const y = target.y + Math.sin(this.pitch) * this.distance;
            const z = target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance;
            this.perspective.position.set(x, y, z);
            this.perspective.lookAt(target);
            this.perspective.updateProjectionMatrix();
        } else {
            this.ortho.position.set(target.x, target.y, this.distance);
            this.ortho.lookAt(target);
            this.ortho.zoom = THREE.MathUtils.clamp(8 / this.distance, 0.45, 3.5);
            this.ortho.updateProjectionMatrix();
        }
        if (render) this.render();
    }

    private camera(): THREE.Camera {
        return this.mode === '3d' ? this.perspective : this.ortho;
    }

    private configureNodeDrag(pointer: GraphRendererPointer): boolean {
        if (!this.force.writeActivePosition(this.dragPlanePoint)) return false;
        this.camera().getWorldDirection(this.dragVector).normalize();
        this.dragPlane.setFromNormalAndCoplanarPoint(this.dragVector, this.dragPlanePoint);
        if (!this.pointerToDragPlane(pointer, this.dragHit)) {
            this.dragOffset.set(0, 0, 0);
            return true;
        }
        this.dragOffset.copy(this.dragPlanePoint).sub(this.dragHit);
        return true;
    }

    private pointerToDragPlane(pointer: GraphRendererPointer, out: THREE.Vector3): boolean {
        this.pointer.x = (pointer.x / Math.max(1, pointer.width)) * 2 - 1;
        this.pointer.y = -(pointer.y / Math.max(1, pointer.height)) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera());
        return Boolean(this.raycaster.ray.intersectPlane(this.dragPlane, out));
    }

    private pointerToCameraTargetPlane(pointer: GraphRendererPointer, out: THREE.Vector3): boolean {
        this.pointer.x = (pointer.x / Math.max(1, pointer.width)) * 2 - 1;
        this.pointer.y = -(pointer.y / Math.max(1, pointer.height)) * 2 + 1;
        this.camera().getWorldDirection(this.zoomNormal).normalize();
        this.zoomPlane.setFromNormalAndCoplanarPoint(this.zoomNormal, this.cameraTarget.set(this.panX, this.panY, this.panZ));
        this.raycaster.setFromCamera(this.pointer, this.camera());
        return Boolean(this.raycaster.ray.intersectPlane(this.zoomPlane, out));
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
            this.color.setRGB(0.22, 0.86, 0.78);
            return;
        }
        this.color.setRGB(this.colorPart(data, index, 0), this.colorPart(data, index, 1), this.colorPart(data, index, 2));
        const compact = this.nodeShape === 'atom' || this.nodeShape === 'sphere';
        this.color.offsetHSL(0, hovered ? 0.2 : neighbor ? 0.14 : compact ? 0.18 : 0.08, hovered ? 0.04 : neighbor ? -0.02 : dimmed ? -0.24 : compact ? -0.08 : -0.06);
    }

    private glowColor(data: GalaxySceneV2, index: number, active: boolean, hovered: boolean, dimmed: boolean): void {
        if (active) {
            this.color.setRGB(0.14, 0.8, 0.9);
            return;
        }
        this.color.setRGB(this.colorPart(data, index, 0), this.colorPart(data, index, 1), this.colorPart(data, index, 2));
        this.color.offsetHSL(0, hovered ? 0.2 : this.nodeShape === 'atom' ? 0.18 : 0.16, hovered ? 0.02 : dimmed ? -0.25 : -0.14);
    }

    private applyMaterialSettings(): void {
        if (this.edges) {
            this.edges.visible = this.settings.edgeMode !== 'hidden';
            const material = this.edges.material as THREE.LineBasicMaterial;
            material.opacity = this.settings.edgeMode === 'hidden' ? 0 : this.edgeMaterialOpacity();
            material.linewidth = this.edgeMaterialWidth();
            material.needsUpdate = true;
        }
        this.glows?.children.forEach((child) => {
            const material = (child as THREE.Sprite).material;
            material.opacity = THREE.MathUtils.clamp(this.settings.glow * 0.2, 0, 0.34);
            material.needsUpdate = true;
        });
        this.shells?.traverse((child) => {
            const drawable = child as THREE.Mesh | THREE.LineSegments;
            const material = drawable.material as THREE.Material | undefined;
            if (!material) return;
            const guideKind = child.userData['guideKind'];
            if (guideKind === 'hopf') {
                const weight = Number(child.userData['guideWeight'] ?? 1);
                const layer = String(child.userData['hopfLayer'] ?? 'line');
                const hopfGuideKind = child.userData['hopfGuideKind'] as GalaxyHopfRibbonView['guideKind'] | undefined;
                const surface = this.guideSurface(child);
                this.setGuideOpacity(material, this.hopfLayerOpacity(layer, hopfGuideKind, weight, surface));
            } else if (guideKind === 'lorentz') {
                const weight = Number(child.userData['guideWeight'] ?? 1);
                const layer = String(child.userData['lorentzLayer'] ?? 'line');
                const lorentzGuideKind = child.userData['lorentzGuideKind'] as GalaxyLorentzGuideView['guideKind'] | undefined;
                const treeKind = String(child.userData['treeKind'] ?? '');
                const surface = this.guideSurface(child);
                this.setGuideOpacity(material, this.lorentzLayerOpacity(layer, lorentzGuideKind, treeKind, weight, surface));
            } else if (guideKind === 'klein') {
                const layer = String(child.userData['kleinLayer'] ?? 'boundary');
                this.setGuideOpacity(material, this.productKleinLayerOpacity(layer));
            } else if (guideKind === 'multi') {
                this.setGuideOpacity(material, this.multiShellOpacity());
            } else {
                this.setGuideOpacity(material, this.hybridShellOpacity());
            }
            material.needsUpdate = true;
        });
        this.particles.updateSettings(this.settings);
    }

    private updateGuideFocus(data: GalaxySceneV2, focus: GalaxyFocusMask): void {
        this.shells?.traverse((child) => {
            if (child.userData['guideKind'] !== 'lorentz') return;
            const drawable = child as THREE.Mesh | THREE.LineSegments;
            const material = drawable.material as THREE.Material | undefined;
            if (!material) return;
            const surface = this.guideSurface(child);
            const layer = String(child.userData['lorentzLayer'] ?? 'line');
            const guideKind = child.userData['lorentzGuideKind'] as GalaxyLorentzGuideView['guideKind'] | undefined;
            const treeKind = String(child.userData['treeKind'] ?? '');
            const weight = Number(child.userData['guideWeight'] ?? 1);
            const baseOpacity = this.lorentzLayerOpacity(layer, guideKind, treeKind, weight, surface);
            const guides = child.userData['lorentzGuides'] as GalaxyLorentzGuideView[] | undefined;
            if (drawable instanceof THREE.LineSegments && Array.isArray(guides)) {
                this.updateLorentzGuideLineColors(drawable, guides, surface, focus, data);
                this.setGuideOpacity(material, baseOpacity);
            } else {
                const nodeIds = Array.isArray(child.userData['nodeIds']) ? child.userData['nodeIds'] as string[] : [];
                const focusScale = this.lorentzGuideFocusMultiplier(data, focus, nodeIds);
                this.setGuideOpacity(material, baseOpacity * focusScale);
            }
            material.needsUpdate = true;
        });
    }

    private updateLorentzGuideGeometry(data: GalaxySceneV2, positions: Float32Array): void {
        if (data.layoutMode !== 'lorentzTree' || !this.shells) return;
        const indexById = this.nodeIndexById(data);
        this.shells.traverse((child) => {
            if (child.userData['guideKind'] !== 'lorentz') return;
            const guides = child.userData['lorentzGuides'] as GalaxyLorentzGuideView[] | undefined;
            if (child instanceof THREE.LineSegments && Array.isArray(guides)) {
                this.updateLorentzGuideLinePositions(child, guides, data, positions, indexById);
                return;
            }
            const guide = child.userData['lorentzGuide'] as GalaxyLorentzGuideView | undefined;
            const layer = child.userData['lorentzLayer'];
            if (!(child instanceof THREE.Mesh) || !guide || (layer !== 'tubeCore' && layer !== 'tubeGlow')) return;
            const points = this.lorentzGuidePath(guide, data, positions, indexById);
            if (points.length < 4) return;
            const previous = child.geometry;
            const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
            child.geometry = new THREE.TubeGeometry(curve, LORENTZ_TUBE_SEGMENTS, this.lorentzTubeRadius(guide, layer, this.guideSurface(child)), LORENTZ_TUBE_RADIAL_SEGMENTS, false);
            previous.dispose();
        });
    }

    private updateLorentzGuideLinePositions(
        line: THREE.LineSegments,
        guides: GalaxyLorentzGuideView[],
        data: GalaxySceneV2,
        positions: Float32Array,
        indexById: Map<string, number>,
    ): void {
        const positionAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!positionAttr) return;
        const output = positionAttr.array as Float32Array;
        let cursor = 0;
        for (const guide of guides) {
            cursor = this.writeLorentzGuidePositions(output, cursor, guide, data, positions, indexById);
        }
        positionAttr.needsUpdate = true;
        line.geometry.computeBoundingSphere();
    }

    private writeLorentzGuidePositions(
        output: Float32Array,
        cursor: number,
        guide: GalaxyLorentzGuideView,
        data: GalaxySceneV2,
        positions: Float32Array,
        indexById: Map<string, number>,
    ): number {
        const sourceIndex = this.liveGuideNodeIndex(guide, data, indexById, 0);
        const targetIndex = this.liveGuideNodeIndex(guide, data, indexById, 1);
        if (guide.guideKind !== 'membership' || sourceIndex < 0 || targetIndex < 0) {
            output.set(guide.positions3d, cursor);
            return cursor + guide.positions3d.length;
        }
        const oldLast = guide.positions3d.length - 3;
        const oldAx = guide.positions3d[0], oldAy = guide.positions3d[1], oldAz = guide.positions3d[2];
        const oldBx = guide.positions3d[oldLast], oldBy = guide.positions3d[oldLast + 1], oldBz = guide.positions3d[oldLast + 2];
        const newA = sourceIndex * 3;
        const newB = targetIndex * 3;
        return this.writeReanchoredGuidePositions(
            output,
            cursor,
            guide.positions3d,
            oldAx, oldAy, oldAz,
            oldBx, oldBy, oldBz,
            positions[newA], positions[newA + 1], positions[newA + 2],
            positions[newB], positions[newB + 1], positions[newB + 2],
        );
    }

    private writeReanchoredGuidePositions(
        output: Float32Array,
        cursor: number,
        source: Float32Array,
        oldAx: number, oldAy: number, oldAz: number,
        oldBx: number, oldBy: number, oldBz: number,
        newAx: number, newAy: number, newAz: number,
        newBx: number, newBy: number, newBz: number,
    ): number {
        const odx = oldBx - oldAx, ody = oldBy - oldAy, odz = oldBz - oldAz;
        const ndx = newBx - newAx, ndy = newBy - newAy, ndz = newBz - newAz;
        const oldLenSq = Math.max(0.000001, odx * odx + ody * ody + odz * odz);
        const offsetScale = THREE.MathUtils.clamp(Math.sqrt((ndx * ndx + ndy * ndy + ndz * ndz) / oldLenSq), 0.25, 2.4);
        for (let index = 0; index < source.length; index += 3) {
            const px = source[index], py = source[index + 1], pz = source[index + 2];
            const t = THREE.MathUtils.clamp(((px - oldAx) * odx + (py - oldAy) * ody + (pz - oldAz) * odz) / oldLenSq, 0, 1);
            const oldBaseX = oldAx + odx * t, oldBaseY = oldAy + ody * t, oldBaseZ = oldAz + odz * t;
            output[cursor++] = newAx + ndx * t + (px - oldBaseX) * offsetScale;
            output[cursor++] = newAy + ndy * t + (py - oldBaseY) * offsetScale;
            output[cursor++] = newAz + ndz * t + (pz - oldBaseZ) * offsetScale;
        }
        output[cursor - source.length] = newAx;
        output[cursor - source.length + 1] = newAy;
        output[cursor - source.length + 2] = newAz;
        output[cursor - 3] = newBx;
        output[cursor - 2] = newBy;
        output[cursor - 1] = newBz;
        return cursor;
    }

    private nodeIndexById(data: GalaxySceneV2): Map<string, number> {
        const indexes = new Map<string, number>();
        for (let index = 0; index < data.ids.length; index++) indexes.set(data.ids[index], index);
        return indexes;
    }

    private liveGuideNodeIndex(guide: GalaxyLorentzGuideView, data: GalaxySceneV2, indexById: Map<string, number>, nodeOffset: number): number {
        const id = guide.nodeIds[nodeOffset];
        const index = id ? indexById.get(id) : undefined;
        return index !== undefined && index >= 0 && index < data.ids.length ? index : -1;
    }

    private updateLorentzGuideLineColors(
        line: THREE.LineSegments,
        guides: GalaxyLorentzGuideView[],
        surface: GuideSurface,
        focus: GalaxyFocusMask,
        data: GalaxySceneV2,
    ): void {
        const colorAttr = line.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (!colorAttr) return;
        let cursor = 0;
        for (const [guideIndex, guide] of guides.entries()) {
            const focusScale = this.lorentzGuideFocusMultiplier(data, focus, guide.nodeIds);
            for (let source = 0; source < guide.positions3d.length; source += 3) {
                const phase = source / Math.max(3, guide.positions3d.length - 3);
                this.writeLorentzGuideColor(colorAttr.array as Float32Array, cursor, guide, guideIndex, phase, surface, focusScale);
                cursor += 3;
            }
        }
        colorAttr.needsUpdate = true;
    }

    private lorentzGuideFocusMultiplier(data: GalaxySceneV2, focus: GalaxyFocusMask, nodeIds: readonly string[]): number {
        if (!focus.hasFocus || focus.focusIndex < 0) return 1;
        const focusId = data.ids[focus.focusIndex];
        if (!focusId) return 1;
        if (!nodeIds.length) return 0.22;
        return nodeIds.includes(focusId) ? 1.18 : 0.12;
    }

    private setGuideOpacity(material: THREE.Material, opacity: number): void {
        const shader = material as THREE.ShaderMaterial;
        if (shader.uniforms?.['opacity']) {
            shader.uniforms['opacity'].value = opacity;
        } else {
            material.opacity = opacity;
        }
    }

    private guideSurface(object: THREE.Object3D): GuideSurface {
        return object.userData['guideSurface'] === 'product' ? 'product' : 'default';
    }

    private hybridShellOpacity(): number {
        if (!this.settings.hybridShellVisible) return 0;
        const shellOpacity = THREE.MathUtils.clamp(this.settings.hybridShellOpacity, 0, 1);
        const glow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        return THREE.MathUtils.clamp(0.02 + glow * 0.004, 0.014, 0.032) * shellOpacity;
    }

    private multiShellOpacity(): number {
        if (!this.settings.hybridShellVisible) return 0;
        const shellOpacity = THREE.MathUtils.clamp(this.settings.hybridShellOpacity, 0, 1);
        const glow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        return THREE.MathUtils.clamp(0.014 + glow * 0.003, 0.01, 0.026) * shellOpacity;
    }

    private productKleinLayerOpacity(layer: string): number {
        if (!this.settings.productKleinVisible) return 0;
        const glow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        if (layer === 'boundary') return THREE.MathUtils.clamp(0.012 + glow * 0.002, 0, 0.018);
        if (layer === 'chord') return THREE.MathUtils.clamp(0.035 + glow * 0.006, 0, 0.052);
        return THREE.MathUtils.clamp(0.028 + glow * 0.004, 0, 0.04);
    }

    private edgeMaterialOpacity(): number {
        const glow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        return Math.max(0.012, this.settings.edgeOpacity * (0.46 + glow * 0.18));
    }

    private edgeMaterialWidth(): number {
        const glow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        return Math.max(1, this.settings.edgeWidth * (0.66 + glow * 0.08));
    }

    private edgeStrokeCount(): number {
        if (this.settings.edgeMode === 'hidden') return 1;
        const width = Math.max(0, this.settings.edgeWidth - 0.55);
        return THREE.MathUtils.clamp(1 + Math.round(width * 1.4), 1, MAX_EDGE_STROKES);
    }

    private edgeStrokeOffset(): number {
        return 0.0032 * Math.max(0, this.settings.edgeWidth - 0.55);
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
        this.nodes = buildGalaxyNodes(data, this.settings, this.nodeTexture, this.atomTexture);
        this.glows = buildGalaxyGlows(data, this.haloTexture);
        if (this.glows) this.scene.add(this.glows);
        if (this.nodes) this.scene.add(this.nodes);
    }

    private buildGroupShells(scene: GalaxySceneV2): THREE.Group | null {
        if (scene.layoutMode === 'hybridSpace') return this.buildHybridGuides();
        if (scene.layoutMode === 'hopfProjection') return this.buildHopfGuides(scene);
        if (scene.layoutMode === 'lorentzTree') return this.buildLorentzGuides(scene);
        if (scene.layoutMode === 'siegelFinsler') return this.buildLorentzGuides(scene);
        if (scene.layoutMode === 'productManifold') return this.buildProductGuides(scene);
        if (scene.layoutMode !== 'multiGalaxy' || scene.groups.length < 2) return null;
        const group = new THREE.Group();
        for (const shell of scene.groups) {
            const geometry = new THREE.SphereGeometry(shell.radius, 40, 20);
            const material = this.multiGlassMaterial(shell);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(shell.center.x, shell.center.y, shell.center.z);
            mesh.userData['groupId'] = shell.id;
            mesh.userData['guideKind'] = 'multi';
            mesh.userData['pickable'] = false;
            group.add(mesh);
        }
        return group;
    }

    private multiGlassMaterial(shell: GalaxySceneGroupView): THREE.ShaderMaterial {
        const tint = new THREE.Color(shell.color.r, shell.color.g, shell.color.b);
        return new THREE.ShaderMaterial({
            uniforms: {
                coreColor: { value: new THREE.Color(0.055, 0.28, 0.255) },
                rimColor: { value: new THREE.Color(0.42, 1.0, 0.92) },
                depthColor: { value: new THREE.Color(0.58, 0.32, 1.0) },
                tintColor: { value: tint },
                opacity: { value: this.multiShellOpacity() },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(cameraPosition - worldPosition.xyz);
                    vWorld = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 coreColor;
                uniform vec3 rimColor;
                uniform vec3 depthColor;
                uniform vec3 tintColor;
                uniform float opacity;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
                    float vertical = smoothstep(-1.65, 1.65, vWorld.y);
                    float latitude = 0.5 + 0.5 * sin(vWorld.y * 2.0);
                    vec3 base = mix(coreColor, depthColor, vertical * 0.42 + latitude * 0.12);
                    vec3 tinted = mix(base, tintColor, 0.16);
                    vec3 hue = mix(tinted, rimColor, smoothstep(0.22, 0.98, rim) * 0.72);
                    float glass = 0.12 + smoothstep(0.04, 0.92, rim) * 0.74;
                    gl_FragColor = vec4(hue, opacity * glass);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
    }

    private buildHybridGuides(): THREE.Group {
        const group = new THREE.Group();
        const outer = new THREE.Mesh(new THREE.SphereGeometry(2.32, 48, 24), this.hybridGlassMaterial());
        outer.userData['guideKind'] = 'hybrid';
        outer.userData['pickable'] = false;
        group.add(outer);
        return group;
    }

    private buildProductGuides(scene: GalaxySceneV2): THREE.Group {
        const group = new THREE.Group();
        const shell = this.buildHybridGuides();
        if (shell.children.length) group.add(shell);
        const klein = this.buildProductKleinGuides();
        if (klein.children.length) group.add(klein);
        const lorentz = this.buildLorentzGuides(scene, 'product');
        if (lorentz.children.length) group.add(lorentz);
        const hopf = this.buildHopfGuides(scene, 'product');
        if (hopf.children.length) group.add(hopf);
        return group;
    }

    private buildProductKleinGuides(): THREE.Group {
        const group = new THREE.Group();
        const boundary = new THREE.Mesh(new THREE.SphereGeometry(PRODUCT_KLEIN_RADIUS, 48, 24), this.productKleinBoundaryMaterial());
        boundary.userData['guideKind'] = 'klein';
        boundary.userData['kleinLayer'] = 'boundary';
        boundary.userData['pickable'] = false;
        group.add(boundary);

        const rings = new THREE.LineSegments(this.productKleinRingGeometry(), this.productKleinLineMaterial('ring'));
        rings.userData['guideKind'] = 'klein';
        rings.userData['kleinLayer'] = 'ring';
        rings.userData['pickable'] = false;
        group.add(rings);

        const chords = new THREE.LineSegments(this.productKleinChordGeometry(), this.productKleinLineMaterial('chord'));
        chords.userData['guideKind'] = 'klein';
        chords.userData['kleinLayer'] = 'chord';
        chords.userData['pickable'] = false;
        group.add(chords);
        return group;
    }

    private productKleinBoundaryMaterial(): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            uniforms: {
                opacity: { value: this.productKleinLayerOpacity('boundary') },
                rimColor: { value: new THREE.Color(0.44, 1.0, 0.92) },
                depthColor: { value: new THREE.Color(0.18, 0.36, 0.58) },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(cameraPosition - worldPosition.xyz);
                    vWorld = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float opacity;
                uniform vec3 rimColor;
                uniform vec3 depthColor;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.1);
                    float latitude = 0.5 + 0.5 * sin(vWorld.y * 2.8);
                    vec3 hue = mix(depthColor, rimColor, 0.34 + latitude * 0.18);
                    float alpha = opacity * (0.08 + smoothstep(0.36, 0.98, rim) * 0.92);
                    gl_FragColor = vec4(hue, alpha);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.NormalBlending,
            toneMapped: false,
        });
    }

    private productKleinLineMaterial(layer: 'ring' | 'chord'): THREE.LineBasicMaterial {
        return new THREE.LineBasicMaterial({
            color: layer === 'chord' ? new THREE.Color(0.26, 0.88, 0.96) : new THREE.Color(0.38, 1, 0.88),
            transparent: true,
            opacity: this.productKleinLayerOpacity(layer),
            depthWrite: false,
            blending: THREE.NormalBlending,
            toneMapped: false,
        });
    }

    private productKleinRingGeometry(): THREE.BufferGeometry {
        const rings = [
            { radius: PRODUCT_KLEIN_RADIUS, plane: 0 },
            { radius: PRODUCT_KLEIN_RADIUS, plane: 1 },
            { radius: PRODUCT_KLEIN_RADIUS, plane: 2 },
            { radius: PRODUCT_KLEIN_RADIUS * 0.68, plane: 0 },
            { radius: PRODUCT_KLEIN_RADIUS * 0.68, plane: 1 },
            { radius: PRODUCT_KLEIN_RADIUS * 0.42, plane: 2 },
        ];
        const positions = new Float32Array(rings.length * PRODUCT_KLEIN_RING_SEGMENTS * 2 * 3);
        let cursor = 0;
        for (const ring of rings) {
            for (let index = 0; index < PRODUCT_KLEIN_RING_SEGMENTS; index++) {
                const a = (index / PRODUCT_KLEIN_RING_SEGMENTS) * Math.PI * 2;
                const b = ((index + 1) / PRODUCT_KLEIN_RING_SEGMENTS) * Math.PI * 2;
                cursor = this.writeKleinRingPoint(positions, cursor, ring.plane, ring.radius, a);
                cursor = this.writeKleinRingPoint(positions, cursor, ring.plane, ring.radius, b);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geometry;
    }

    private productKleinChordGeometry(): THREE.BufferGeometry {
        const directions = [
            [1, 0.18, 0.32],
            [-0.72, 0.54, 0.43],
            [0.34, -0.64, 0.69],
            [-0.12, -0.3, 0.95],
            [0.82, 0.42, -0.38],
            [-0.46, 0.78, -0.42],
        ];
        const positions = new Float32Array(directions.length * 2 * 3);
        let cursor = 0;
        for (const raw of directions) {
            const length = Math.hypot(raw[0], raw[1], raw[2]) || 1;
            const x = raw[0] / length * PRODUCT_KLEIN_RADIUS * 0.96;
            const y = raw[1] / length * PRODUCT_KLEIN_RADIUS * 0.96;
            const z = raw[2] / length * PRODUCT_KLEIN_RADIUS * 0.96;
            positions[cursor++] = -x;
            positions[cursor++] = -y;
            positions[cursor++] = -z;
            positions[cursor++] = x;
            positions[cursor++] = y;
            positions[cursor++] = z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geometry;
    }

    private writeKleinRingPoint(buffer: Float32Array, cursor: number, plane: number, radius: number, angle: number): number {
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (plane === 0) buffer.set([x, y, 0], cursor);
        else if (plane === 1) buffer.set([x, 0, y], cursor);
        else buffer.set([0, x, y], cursor);
        return cursor + 3;
    }

    private hybridGlassMaterial(): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            uniforms: {
                coreColor: { value: new THREE.Color(0.055, 0.28, 0.255) },
                rimColor: { value: new THREE.Color(0.42, 1.0, 0.92) },
                depthColor: { value: new THREE.Color(0.58, 0.32, 1.0) },
                opacity: { value: this.hybridShellOpacity() },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(cameraPosition - worldPosition.xyz);
                    vWorld = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 coreColor;
                uniform vec3 rimColor;
                uniform vec3 depthColor;
                uniform float opacity;
                varying vec3 vNormal;
                varying vec3 vView;
                varying vec3 vWorld;
                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.25);
                    float vertical = smoothstep(-1.85, 1.85, vWorld.y);
                    float latitude = 0.5 + 0.5 * sin(vWorld.y * 2.25);
                    vec3 hue = mix(coreColor, depthColor, vertical * 0.5 + latitude * 0.18);
                    hue = mix(hue, rimColor, smoothstep(0.18, 0.95, rim));
                    float glass = 0.16 + smoothstep(0.05, 0.92, rim) * 0.84;
                    gl_FragColor = vec4(hue, opacity * glass);
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
    }

    private buildLorentzGuides(scene: GalaxySceneV2, surface: GuideSurface = 'default'): THREE.Group {
        const group = new THREE.Group();
        const shells = this.buildLorentzGlassShells(scene.lorentzGuides, surface);
        if (shells) group.add(shells);
        const tubes = this.buildLorentzTubeLayer(scene.lorentzGuides, surface);
        if (tubes) group.add(tubes);
        const lines = this.buildLorentzGuideSegments(scene.lorentzGuides, surface);
        if (lines) group.add(lines);
        return group;
    }

    private buildLorentzGlassShells(guides: GalaxyLorentzGuideView[], surface: GuideSurface): THREE.Group | null {
        const shells = guides
            .filter((guide) => guide.guideKind === 'levelShell')
            .sort((left, right) => left.level - right.level)
            .slice(0, 7);
        if (!shells.length) return null;
        const group = new THREE.Group();
        for (const guide of shells) {
            const radius = this.lorentzShellRadius(guide);
            const geometry = new THREE.SphereGeometry(radius, 48, 24);
            const material = this.lorentzGlassMaterial(guide, surface);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData['guideKind'] = 'lorentz';
            mesh.userData['guideSurface'] = surface;
            mesh.userData['lorentzGuideKind'] = guide.guideKind;
            mesh.userData['lorentzLayer'] = 'shell';
            mesh.userData['guideWeight'] = guide.guideWeight;
            mesh.userData['treeKind'] = guide.treeKind;
            mesh.userData['nodeIds'] = guide.nodeIds;
            mesh.userData['pickable'] = false;
            group.add(mesh);
        }
        return group.children.length ? group : null;
    }

    private lorentzGlassMaterial(guide: GalaxyLorentzGuideView, surface: GuideSurface): THREE.ShaderMaterial {
        const tint = this.lorentzGuideTint(guide, 0, surface);
        return new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(tint.r, tint.g, tint.b) },
                opacity: { value: this.lorentzLayerOpacity('shell', guide.guideKind, guide.treeKind, guide.guideWeight, surface) },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vNormal = normalize(normalMatrix * normal);
                    vView = normalize(cameraPosition - worldPosition.xyz);
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                uniform float opacity;
                varying vec3 vNormal;
                varying vec3 vView;
                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.1);
                    float breath = smoothstep(0.08, 0.96, rim);
                    gl_FragColor = vec4(color, opacity * (0.18 + breath * 0.82));
                }
            `,
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
    }

    private buildLorentzTubeLayer(guides: GalaxyLorentzGuideView[], surface: GuideSurface): THREE.Group | null {
        const lanes = guides
            .filter((guide) => guide.guideKind === 'membership' || guide.guideKind === 'rootLane')
            .sort((left, right) => right.importance - left.importance || left.id.localeCompare(right.id))
            .slice(0, MAX_LORENTZ_TUBES);
        if (!lanes.length) return null;
        const group = new THREE.Group();
        for (const [index, guide] of lanes.entries()) {
            const glow = this.buildLorentzTubeMesh(guide, index, 'tubeGlow', surface);
            const core = this.buildLorentzTubeMesh(guide, index, 'tubeCore', surface);
            if (glow) group.add(glow);
            if (core) group.add(core);
        }
        return group.children.length ? group : null;
    }

    private buildLorentzTubeMesh(guide: GalaxyLorentzGuideView, index: number, layer: 'tubeCore' | 'tubeGlow', surface: GuideSurface): THREE.Mesh | null {
        const points = this.lorentzGuidePath(guide);
        if (points.length < 4) return null;
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
        const geometry = new THREE.TubeGeometry(curve, LORENTZ_TUBE_SEGMENTS, this.lorentzTubeRadius(guide, layer, surface), LORENTZ_TUBE_RADIAL_SEGMENTS, false);
        const tint = this.lorentzGuideTint(guide, index, surface);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(tint.r, tint.g, tint.b),
            transparent: true,
            opacity: this.lorentzLayerOpacity(layer, guide.guideKind, guide.treeKind, guide.guideWeight, surface),
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData['guideKind'] = 'lorentz';
        mesh.userData['guideSurface'] = surface;
        mesh.userData['lorentzGuideKind'] = guide.guideKind;
        mesh.userData['lorentzLayer'] = layer;
        mesh.userData['guideWeight'] = guide.guideWeight;
        mesh.userData['treeKind'] = guide.treeKind;
        mesh.userData['nodeIds'] = guide.nodeIds;
        mesh.userData['lorentzGuide'] = guide;
        mesh.userData['pickable'] = false;
        return mesh;
    }

    private buildLorentzGuideSegments(guides: GalaxyLorentzGuideView[], surface: GuideSurface): THREE.Group | null {
        const visible = guides.slice(0, MAX_LORENTZ_GUIDES);
        if (!visible.length) return null;
        const grouped = new Map<GalaxyLorentzGuideView['guideKind'], GalaxyLorentzGuideView[]>();
        for (const guide of visible) {
            const group = grouped.get(guide.guideKind) ?? [];
            group.push(guide);
            grouped.set(guide.guideKind, group);
        }
        const result = new THREE.Group();
        for (const [guideKind, groupGuides] of grouped) {
            const line = this.buildLorentzGuideLine(groupGuides, guideKind, surface);
            if (line) result.add(line);
        }
        return result.children.length ? result : null;
    }

    private buildLorentzGuideLine(guides: GalaxyLorentzGuideView[], guideKind: GalaxyLorentzGuideView['guideKind'], surface: GuideSurface): THREE.LineSegments | null {
        const vertexCount = guides.reduce((total, guide) => total + guide.positions3d.length / 3, 0);
        if (!vertexCount) return null;
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        let cursor = 0;
        for (const [guideIndex, guide] of guides.entries()) {
            for (let source = 0; source < guide.positions3d.length; source += 3) {
                const phase = source / Math.max(3, guide.positions3d.length - 3);
                positions[cursor] = guide.positions3d[source];
                positions[cursor + 1] = guide.positions3d[source + 1];
                positions[cursor + 2] = guide.positions3d[source + 2];
                this.writeLorentzGuideColor(colors, cursor, guide, guideIndex, phase, surface);
                cursor += 3;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.lorentzLayerOpacity('line', guideKind, guides[0]?.treeKind, this.lorentzGuideWeightForKind(guideKind), surface),
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const line = new THREE.LineSegments(geometry, material);
        line.userData['guideKind'] = 'lorentz';
        line.userData['guideSurface'] = surface;
        line.userData['lorentzGuideKind'] = guideKind;
        line.userData['lorentzLayer'] = 'line';
        line.userData['guideWeight'] = this.lorentzGuideWeightForKind(guideKind);
        line.userData['treeKind'] = guides[0]?.treeKind ?? '';
        line.userData['lorentzGuides'] = guides;
        line.userData['pickable'] = false;
        return line;
    }

    private buildHopfGuides(scene: GalaxySceneV2, surface: GuideSurface = 'default'): THREE.Group {
        const group = new THREE.Group();
        const tubes = this.buildHopfTubeLayer(scene.hopfRibbons, surface);
        if (tubes) group.add(tubes);
        const ribbons = this.buildHopfRibbonSegments(scene.hopfRibbons, surface);
        if (ribbons) group.add(ribbons);
        return group;
    }

    private buildHopfTubeLayer(ribbons: GalaxyHopfRibbonView[], surface: GuideSurface): THREE.Group | null {
        if (!ribbons.length) return null;
        const group = new THREE.Group();
        const dataFibers = ribbons
            .filter((ribbon) => ribbon.guideKind === 'dataFiber')
            .sort((left, right) => right.importance - left.importance)
            .slice(0, MAX_HOPF_DATA_TUBES);
        const torusFibers = ribbons
            .filter((ribbon) => ribbon.guideKind === 'torusBand')
            .filter((_, index) => index % 3 === 0)
            .slice(0, MAX_HOPF_TORUS_TUBES);
        for (const [index, ribbon] of dataFibers.entries()) {
            const glow = this.buildHopfTubeMesh(ribbon, index, 'tubeGlow', surface);
            const core = this.buildHopfTubeMesh(ribbon, index, 'tubeCore', surface);
            if (glow) group.add(glow);
            if (core) group.add(core);
        }
        if (surface === 'default') {
            for (const [index, ribbon] of torusFibers.entries()) {
                const glow = this.buildHopfTubeMesh(ribbon, index, 'tubeGlow', surface);
                const core = this.buildHopfTubeMesh(ribbon, index, 'tubeCore', surface);
                if (glow) group.add(glow);
                if (core) group.add(core);
            }
        }
        return group.children.length ? group : null;
    }

    private buildHopfTubeMesh(ribbon: GalaxyHopfRibbonView, index: number, layer: 'tubeCore' | 'tubeGlow', surface: GuideSurface): THREE.Mesh | null {
        const points = this.hopfRibbonPath(ribbon);
        if (points.length < 4) return null;
        const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.45);
        const radius = this.hopfTubeRadius(ribbon.guideKind, layer, surface);
        const geometry = new THREE.TubeGeometry(curve, HOPF_TUBE_SEGMENTS, radius, HOPF_TUBE_RADIAL_SEGMENTS, true);
        const tint = this.hopfRibbonTint(ribbon, index, surface);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(tint.r, tint.g, tint.b),
            transparent: true,
            opacity: this.hopfLayerOpacity(layer, ribbon.guideKind, this.hopfGuideWeightForKind(ribbon.guideKind, surface), surface),
            depthWrite: false,
            depthTest: true,
            blending: surface === 'product' ? THREE.NormalBlending : THREE.AdditiveBlending,
            toneMapped: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData['guideKind'] = 'hopf';
        mesh.userData['guideSurface'] = surface;
        mesh.userData['hopfGuideKind'] = ribbon.guideKind;
        mesh.userData['hopfLayer'] = layer;
        mesh.userData['guideWeight'] = this.hopfGuideWeightForKind(ribbon.guideKind, surface);
        mesh.userData['pickable'] = false;
        return mesh;
    }

    private hopfRibbonPath(ribbon: GalaxyHopfRibbonView): THREE.Vector3[] {
        const segmentCount = Math.floor(ribbon.positions3d.length / 6);
        if (segmentCount < 4) return [];
        const stride = Math.max(1, Math.floor(segmentCount / 72));
        const points: THREE.Vector3[] = [];
        for (let segment = 0; segment < segmentCount; segment += stride) {
            const offset = segment * 6;
            points.push(new THREE.Vector3(
                ribbon.positions3d[offset],
                ribbon.positions3d[offset + 1],
                ribbon.positions3d[offset + 2],
            ));
        }
        return points;
    }

    private buildHopfRibbonSegments(ribbons: GalaxyHopfRibbonView[], surface: GuideSurface): THREE.Group | null {
        if (!ribbons.length) return null;
        const visible = this.sortedHopfRibbons(ribbons, surface).slice(0, MAX_HOPF_RIBBON_GUIDES);
        const grouped = new Map<GalaxyHopfRibbonView['guideKind'], GalaxyHopfRibbonView[]>();
        for (const ribbon of visible) {
            const group = grouped.get(ribbon.guideKind) ?? [];
            group.push(ribbon);
            grouped.set(ribbon.guideKind, group);
        }
        const result = new THREE.Group();
        for (const [guideKind, groupRibbons] of grouped) {
            const line = this.buildHopfRibbonLine(groupRibbons, guideKind, surface);
            if (line) result.add(line);
        }
        return result.children.length ? result : null;
    }

    private sortedHopfRibbons(ribbons: GalaxyHopfRibbonView[], surface: GuideSurface): GalaxyHopfRibbonView[] {
        if (surface === 'default') return ribbons;
        const rank = (kind: GalaxyHopfRibbonView['guideKind']) =>
            kind === 'dataFiber' ? 0 : kind === 'crossFiberBraid' ? 1 : kind === 'torusBand' ? 2 : kind === 'spaceFiber' ? 3 : 4;
        return [...ribbons].sort((left, right) => rank(left.guideKind) - rank(right.guideKind) || right.importance - left.importance);
    }

    private buildHopfRibbonLine(ribbons: GalaxyHopfRibbonView[], guideKind: GalaxyHopfRibbonView['guideKind'], surface: GuideSurface): THREE.LineSegments | null {
        const vertexCount = ribbons.reduce((total, ribbon) => total + ribbon.positions3d.length / 3, 0);
        const positions = new Float32Array(vertexCount * 3);
        const colors = new Float32Array(vertexCount * 3);
        let cursor = 0;
        for (const [ribbonIndex, ribbon] of ribbons.entries()) {
            for (let source = 0; source < ribbon.positions3d.length; source += 3) {
                const phase = source / Math.max(3, ribbon.positions3d.length - 3);
                positions[cursor] = ribbon.positions3d[source];
                positions[cursor + 1] = ribbon.positions3d[source + 1];
                positions[cursor + 2] = ribbon.positions3d[source + 2];
                this.writeHopfRibbonColor(colors, cursor, ribbon, ribbonIndex, phase, surface);
                cursor += 3;
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: this.hopfGuideOpacity(this.hopfGuideWeightForKind(guideKind, surface), guideKind, surface),
            depthWrite: false,
            depthTest: true,
            blending: surface === 'product' ? THREE.NormalBlending : THREE.AdditiveBlending,
            toneMapped: false,
        });
        const line = new THREE.LineSegments(geometry, material);
        line.userData['guideKind'] = 'hopf';
        line.userData['guideSurface'] = surface;
        line.userData['guideWeight'] = this.hopfGuideWeightForKind(guideKind, surface);
        line.userData['hopfGuideKind'] = guideKind;
        line.userData['hopfLayer'] = 'line';
        line.userData['pickable'] = false;
        return line;
    }

    private hopfRibbonTint(ribbon: GalaxyHopfRibbonView, index: number, surface: GuideSurface): { r: number; g: number; b: number } {
        const palette = this.hopfRibbonPalette(ribbon, index, 0.35, surface);
        return this.hslColor(palette.h, palette.s, palette.l);
    }

    private writeHopfRibbonColor(colors: Float32Array, offset: number, ribbon: GalaxyHopfRibbonView, index: number, phase: number, surface: GuideSurface): void {
        const palette = this.hopfRibbonPalette(ribbon, index, phase, surface);
        this.writeHslColor(colors, offset, palette.h, palette.s, palette.l);
        if (ribbon.guideKind === 'dataFiber' || ribbon.guideKind === 'crossFiberBraid') {
            const mix = surface === 'product' ? 0.44 : 0.2;
            colors[offset] = THREE.MathUtils.lerp(colors[offset], ribbon.color.r, mix);
            colors[offset + 1] = THREE.MathUtils.lerp(colors[offset + 1], ribbon.color.g, mix);
            colors[offset + 2] = THREE.MathUtils.lerp(colors[offset + 2], ribbon.color.b, mix);
        }
    }

    private hopfRibbonPalette(ribbon: GalaxyHopfRibbonView, index: number, phase: number, surface: GuideSurface): { h: number; s: number; l: number } {
        const seed = this.stableUnit(ribbon.id);
        if (surface === 'product') {
            switch (ribbon.guideKind) {
                case 'dataFiber':
                    return { h: 0.48 + seed * 0.26 + phase * 0.04, s: 0.8, l: 0.52 + Math.sin(phase * Math.PI) * 0.047 };
                case 'crossFiberBraid':
                    return { h: 0.5 + seed * 0.22 + phase * 0.035, s: 0.64, l: 0.38 };
                case 'torusBand': {
                    const latitude = this.torusBandIndex(ribbon.id);
                    return { h: 0.62 + latitude * 0.036 + seed * 0.012, s: 0.48, l: 0.2 };
                }
                case 'spaceFiber':
                    return { h: 0.58 + seed * 0.08, s: 0.36, l: 0.17 + (index % 2) * 0.018 };
                case 'axis':
                    return { h: 0.52, s: 0.58, l: 0.26 };
            }
        }
        switch (ribbon.guideKind) {
            case 'dataFiber':
                return { h: 0.5 + seed * 0.3 + phase * 0.055, s: 0.68, l: 0.47 + Math.sin(phase * Math.PI) * 0.05 };
            case 'crossFiberBraid':
                return { h: 0.5 + seed * 0.24 + phase * 0.04, s: 0.58, l: 0.36 + Math.sin(phase * Math.PI) * 0.024 };
            case 'torusBand': {
                const latitude = this.torusBandIndex(ribbon.id);
                return { h: 0.62 + latitude * 0.045 + seed * 0.018 + phase * 0.025, s: 0.64, l: 0.34 };
            }
            case 'spaceFiber':
                return { h: 0.46 + seed * 0.12 + phase * 0.018, s: 0.48, l: 0.25 + (index % 2) * 0.025 };
            case 'axis':
                return { h: 0.52 + phase * 0.02, s: 0.74, l: 0.42 };
        }
    }

    private hopfGuideOpacity(weight = 1, kind?: GalaxyHopfRibbonView['guideKind'], surface: GuideSurface = 'default'): number {
        if (!this.settings.hopfSpaceVisible) return 0;
        const intensity = THREE.MathUtils.clamp(this.settings.hopfSpaceIntensity, 0, 1.4);
        if (surface === 'product') {
            const data = kind === 'dataFiber';
            const braid = kind === 'crossFiberBraid';
            if (braid) return THREE.MathUtils.clamp((0.018 + this.settings.glow * 0.007) * weight * intensity, 0, 0.052);
            const base = data ? 0.036 + this.settings.glow * 0.0215 : 0.0105 + this.settings.glow * 0.005;
            return THREE.MathUtils.clamp(base * weight * intensity, 0, data ? 0.13 : 0.032);
        }
        if (kind === 'crossFiberBraid') return THREE.MathUtils.clamp((0.018 + this.settings.glow * 0.009) * weight * intensity, 0, 0.07);
        return THREE.MathUtils.clamp((0.035 + this.settings.glow * 0.024) * weight * intensity, 0, 0.16);
    }

    private hopfLayerOpacity(layer: string, kind: GalaxyHopfRibbonView['guideKind'] | undefined, weight = 1, surface: GuideSurface = 'default'): number {
        if (!this.settings.hopfSpaceVisible) return 0;
        if (layer === 'tubeCore') return this.hopfTubeOpacity(kind, false, surface);
        if (layer === 'tubeGlow') return this.hopfTubeOpacity(kind, true, surface);
        return this.hopfGuideOpacity(weight, kind, surface);
    }

    private hopfTubeOpacity(kind: GalaxyHopfRibbonView['guideKind'] | undefined, glow: boolean, surface: GuideSurface): number {
        const intensity = THREE.MathUtils.clamp(this.settings.hopfSpaceIntensity, 0, 1.4);
        const globalGlow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        if (surface === 'product') {
            if (kind === 'dataFiber') {
                return THREE.MathUtils.clamp((glow ? 0.0325 : 0.112) * intensity * (0.78 + globalGlow * 0.24), 0, glow ? 0.052 : 0.168);
            }
            return 0;
        }
        if (kind === 'dataFiber') {
            return THREE.MathUtils.clamp((glow ? 0.03 : 0.12) * intensity * (0.76 + globalGlow * 0.24), 0, glow ? 0.055 : 0.22);
        }
        if (kind === 'crossFiberBraid') return 0;
        if (kind === 'torusBand') {
            return THREE.MathUtils.clamp((glow ? 0.012 : 0.045) * intensity * (0.8 + globalGlow * 0.18), 0, glow ? 0.026 : 0.085);
        }
        return 0;
    }

    private hopfTubeRadius(kind: GalaxyHopfRibbonView['guideKind'], layer: 'tubeCore' | 'tubeGlow', surface: GuideSurface): number {
        if (surface === 'product') {
            if (kind === 'dataFiber') return (layer === 'tubeGlow' ? 0.0216 : 0.00675) * PRODUCT_HOPF_TUBE_SCALE;
            return 0.002;
        }
        if (kind === 'dataFiber') return layer === 'tubeGlow' ? 0.012 : 0.0055;
        if (kind === 'torusBand') return layer === 'tubeGlow' ? 0.008 : 0.0038;
        return 0.003;
    }

    private hopfGuideWeightForKind(kind: GalaxyHopfRibbonView['guideKind'], surface: GuideSurface = 'default'): number {
        if (surface === 'product') {
            switch (kind) {
                case 'dataFiber':
                    return 1.58;
                case 'crossFiberBraid':
                    return 0.38;
                case 'spaceFiber':
                    return 0.16;
                case 'torusBand':
                    return 0.18;
                case 'axis':
                    return 0.1;
            }
        }
        switch (kind) {
            case 'dataFiber':
                return 1.22;
            case 'crossFiberBraid':
                return 0.56;
            case 'spaceFiber':
                return 0.34;
            case 'torusBand':
                return 0.54;
            case 'axis':
                return 0.24;
        }
    }

    private lorentzGuidePath(
        guide: GalaxyLorentzGuideView,
        data?: GalaxySceneV2,
        positions?: Float32Array,
        indexById?: Map<string, number>,
    ): THREE.Vector3[] {
        const segmentCount = Math.floor(guide.positions3d.length / 6);
        if (segmentCount < 2) return [];
        const pathSource = data && positions && indexById && guide.guideKind === 'membership'
            ? this.reanchoredLorentzGuidePositions(guide, data, positions, indexById)
            : guide.positions3d;
        const stride = Math.max(1, Math.floor(segmentCount / 40));
        const points: THREE.Vector3[] = [];
        points.push(new THREE.Vector3(pathSource[0], pathSource[1], pathSource[2]));
        for (let segment = 0; segment < segmentCount; segment += stride) {
            const offset = segment * 6 + 3;
            points.push(new THREE.Vector3(
                pathSource[offset],
                pathSource[offset + 1],
                pathSource[offset + 2],
            ));
        }
        const lastOffset = pathSource.length - 3;
        points.push(new THREE.Vector3(pathSource[lastOffset], pathSource[lastOffset + 1], pathSource[lastOffset + 2]));
        return points;
    }

    private reanchoredLorentzGuidePositions(
        guide: GalaxyLorentzGuideView,
        data: GalaxySceneV2,
        positions: Float32Array,
        indexById: Map<string, number>,
    ): Float32Array {
        const output = new Float32Array(guide.positions3d.length);
        this.writeLorentzGuidePositions(output, 0, guide, data, positions, indexById);
        return output;
    }

    private writeLorentzGuideColor(
        colors: Float32Array,
        offset: number,
        guide: GalaxyLorentzGuideView,
        index: number,
        phase: number,
        surface: GuideSurface,
        focusScale = 1,
    ): void {
        const pulse = Math.sin((phase + this.stableUnit(guide.id)) * Math.PI) * 0.08;
        const levelShade = THREE.MathUtils.clamp(0.08 - guide.level * 0.012, -0.04, 0.08);
        colors[offset] = THREE.MathUtils.clamp(guide.color.r * (0.62 + pulse + levelShade), 0, 0.82);
        colors[offset + 1] = THREE.MathUtils.clamp(guide.color.g * (0.66 + pulse + levelShade), 0, 0.86);
        colors[offset + 2] = THREE.MathUtils.clamp(guide.color.b * (0.72 + pulse + levelShade), 0, 0.94);
        if (surface === 'product') {
            const root = guide.guideKind === 'rootLane';
            const colorBlend = guide.guideKind === 'membership' ? 0.04 : root ? 0.18 : 0.3;
            colors[offset] = THREE.MathUtils.lerp(colors[offset], root ? 0.22 : 0.16, colorBlend);
            colors[offset + 1] = THREE.MathUtils.lerp(colors[offset + 1], root ? 0.72 : 0.56, colorBlend);
            colors[offset + 2] = THREE.MathUtils.lerp(colors[offset + 2], root ? 0.96 : 0.88, colorBlend);
        }
        if (guide.guideKind === 'wAxis') {
            colors[offset] = THREE.MathUtils.clamp(0.18 + index * 0.003, 0, 0.46);
            colors[offset + 1] = 0.82;
            colors[offset + 2] = 0.94;
        }
        if (focusScale !== 1) {
            colors[offset] = THREE.MathUtils.clamp(colors[offset] * focusScale, 0, 0.96);
            colors[offset + 1] = THREE.MathUtils.clamp(colors[offset + 1] * focusScale, 0, 0.96);
            colors[offset + 2] = THREE.MathUtils.clamp(colors[offset + 2] * focusScale, 0, 0.96);
        }
    }

    private lorentzGuideTint(guide: GalaxyLorentzGuideView, index: number, surface: GuideSurface = 'default'): { r: number; g: number; b: number } {
        const offset = this.stableUnit(`${guide.id}:${index}`) * 0.08;
        const tint = {
            r: THREE.MathUtils.clamp(guide.color.r + offset, 0, 1),
            g: THREE.MathUtils.clamp(guide.color.g + offset * 0.45, 0, 1),
            b: THREE.MathUtils.clamp(guide.color.b + offset * 0.72, 0, 1),
        };
        if (surface !== 'product') return tint;
        if (guide.guideKind === 'wAxis') return {
            r: 0.18,
            g: 0.82,
            b: 0.94,
        };
        const colorBlend = guide.guideKind === 'membership' ? 0.08 : guide.guideKind === 'rootLane' ? 0.16 : 0.3;
        return {
            r: THREE.MathUtils.lerp(tint.r, 0.18, colorBlend),
            g: THREE.MathUtils.lerp(tint.g, 0.62, colorBlend),
            b: THREE.MathUtils.lerp(tint.b, 0.92, colorBlend),
        };
    }

    private lorentzLayerOpacity(layer: string, guideKind: GalaxyLorentzGuideView['guideKind'] | undefined, treeKind = '', weight = 1, surface: GuideSurface = 'default'): number {
        if (!this.settings.lorentzSpaceVisible) return 0;
        const intensity = THREE.MathUtils.clamp(this.settings.lorentzSpaceIntensity, 0, 1.4);
        const globalGlow = THREE.MathUtils.clamp(this.settings.glow, 0, 1.8);
        const treeBoost = treeKind === 'evidence' || treeKind === 'causal' ? 1.08 : 1;
        if (surface === 'product') {
            const rootBoost = guideKind === 'rootLane' ? 1.12 : 1;
            if (layer === 'tubeCore') return THREE.MathUtils.clamp(0.09 * intensity * treeBoost * rootBoost * weight, 0, 0.18);
            if (layer === 'tubeGlow') return THREE.MathUtils.clamp(0.02 * intensity * (0.76 + globalGlow * 0.18) * weight, 0, 0.05);
            if (layer === 'shell') return THREE.MathUtils.clamp(0.018 * intensity * (0.68 + globalGlow * 0.16) * weight, 0, 0.045);
            return THREE.MathUtils.clamp((0.024 + globalGlow * 0.008) * intensity * weight * this.lorentzGuideWeightForKind(guideKind), 0, 0.11);
        }
        if (layer === 'tubeCore') return THREE.MathUtils.clamp(0.105 * intensity * treeBoost * weight, 0, 0.2);
        if (layer === 'tubeGlow') return THREE.MathUtils.clamp(0.026 * intensity * (0.8 + globalGlow * 0.2) * weight, 0, 0.06);
        if (layer === 'shell') return THREE.MathUtils.clamp(0.022 * intensity * (0.72 + globalGlow * 0.18) * weight, 0, 0.055);
        return THREE.MathUtils.clamp((0.028 + globalGlow * 0.018) * intensity * weight * this.lorentzGuideWeightForKind(guideKind), 0, 0.14);
    }

    private lorentzTubeRadius(guide: GalaxyLorentzGuideView, layer: 'tubeCore' | 'tubeGlow', surface: GuideSurface = 'default'): number {
        const rootBoost = guide.guideKind === 'rootLane' ? 1.22 : 1;
        if (surface === 'product') return layer === 'tubeGlow' ? 0.01125 * rootBoost : 0.00396 * rootBoost;
        return layer === 'tubeGlow' ? 0.0135 * rootBoost : 0.00432 * rootBoost;
    }

    private lorentzGuideWeightForKind(kind: GalaxyLorentzGuideView['guideKind'] | undefined): number {
        switch (kind) {
            case 'membership':
                return 0.86;
            case 'rootLane':
                return 1.08;
            case 'levelShell':
                return 0.46;
            case 'wAxis':
                return 0.24;
            default:
                return 0.7;
        }
    }

    private lorentzShellRadius(guide: GalaxyLorentzGuideView): number {
        const segment = guide.positions3d.length >= 3
            ? Math.hypot(guide.positions3d[0], guide.positions3d[1], guide.positions3d[2])
            : 0;
        return THREE.MathUtils.clamp(segment || 0.58 + guide.level * 0.24, 0.58, 2.18);
    }

    private torusBandIndex(id: string): number {
        const match = id.match(/torus-band:(\d+)/);
        return match ? Math.min(2, Math.max(0, Number(match[1]) || 0)) : 1;
    }

    private stableUnit(value: string): number {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0) / 4294967295;
    }

    private hslColor(h: number, s: number, l: number): { r: number; g: number; b: number } {
        const buffer = new Float32Array(3);
        this.writeHslColor(buffer, 0, h, s, l);
        return { r: buffer[0], g: buffer[1], b: buffer[2] };
    }

    private writeHslColor(colors: Float32Array, offset: number, h: number, s: number, l: number): void {
        const hue = ((h % 1) + 1) % 1;
        if (s <= 0) {
            colors[offset] = colors[offset + 1] = colors[offset + 2] = l;
            return;
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        colors[offset] = this.hueToRgb(p, q, hue + 1 / 3);
        colors[offset + 1] = this.hueToRgb(p, q, hue);
        colors[offset + 2] = this.hueToRgb(p, q, hue - 1 / 3);
    }

    private hueToRgb(p: number, q: number, t: number): number {
        let hue = t;
        if (hue < 0) hue += 1;
        if (hue > 1) hue -= 1;
        if (hue < 1 / 6) return p + (q - p) * 6 * hue;
        if (hue < 1 / 2) return q;
        if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
        return p;
    }

    private updateGroupShells(data: GalaxySceneV2): void {
        if (!this.shells) return;
        if (data.layoutMode === 'productManifold') {
            const scale = productManifoldExpansionScale(this.settings);
            this.shells.scale.set(scale, scale, this.mode === '2d' ? 0.08 : scale);
            return;
        }
        if (data.layoutMode === 'hybridSpace' || data.layoutMode === 'hopfProjection' || data.layoutMode === 'lorentzTree' || data.layoutMode === 'siegelFinsler') {
            this.shells.scale.set(1, 1, this.mode === '2d' ? 0.08 : 1);
            return;
        }
        data.groups.forEach((group, index) => {
            const mesh = this.shells?.children[index] as THREE.Mesh | undefined;
            if (!mesh) return;
            const center = this.groupCenterForMode(group);
            mesh.position.set(center.x, center.y, center.z);
            mesh.scale.set(1, 1, this.mode === '2d' ? 0.08 : 1);
        });
    }

    private groupCenterForMode(group: GalaxySceneGroupView): { x: number; y: number; z: number } {
        return this.mode === '2d'
            ? { x: group.center.x, y: group.center.y, z: 0 }
            : group.center;
    }

    private positions(): Float32Array | null {
        if (!this.sceneData) return null;
        return this.mode === '2d' ? this.sceneData.positions2d : this.sceneData.positions3d;
    }

    private screenSpacePick(pointer: GraphRendererPointer): number {
        const data = this.sceneData;
        const positions = this.positions();
        if (!data || !positions || pointer.width <= 0 || pointer.height <= 0) return -1;
        const camera = this.camera();
        let best = -1;
        let bestScore = Number.POSITIVE_INFINITY;
        const glowBoost = this.settings.glow * 4;
        const shapeBoost = this.settings.nodeShape === 'sphere' ? 4 : this.settings.nodeShape === 'atom' ? 1 : 2;
        const densityPenalty = data.ids.length > 160 ? 4 : 0;

        for (let i = 0; i < data.ids.length; i++) {
            const offset = i * 3;
            this.pickVector.set(positions[offset], positions[offset + 1], positions[offset + 2]).project(camera);
            if (this.pickVector.z < -1 || this.pickVector.z > 1) continue;
            const sx = (this.pickVector.x * 0.5 + 0.5) * pointer.width;
            const sy = (-this.pickVector.y * 0.5 + 0.5) * pointer.height;
            const dx = sx - pointer.x;
            const dy = sy - pointer.y;
            const radius = THREE.MathUtils.clamp(11 + data.radii[i] * 1.9 + glowBoost + shapeBoost - densityPenalty, 10, 34);
            const score = (dx * dx + dy * dy) / (radius * radius);
            if (score <= 1 && score < bestScore) {
                bestScore = score;
                best = i;
            }
        }

        return best;
    }

    private capsSurfaceEdge(data: GalaxySceneV2, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
        if (this.mode !== '3d') return false;
        const ar = Math.hypot(ax, ay, az);
        const br = Math.hypot(bx, by, bz);
        if (data.layoutMode === 'hybridSpace') return this.hybridSurfaceEdge(ar, br, ax, ay, az, bx, by, bz);
        if (data.layoutMode !== 'lorentzTree') return false;
        if (ar < CAPS_SURFACE_EDGE_MIN_RADIUS || br < CAPS_SURFACE_EDGE_MIN_RADIUS) return false;
        if (Math.abs(ar - br) > CAPS_SURFACE_EDGE_MAX_RADIUS_DELTA) return false;
        if (this.capsShellIndex(ar) !== this.capsShellIndex(br)) return false;
        const dot = (ax * bx + ay * by + az * bz) / Math.max(0.000001, ar * br);
        return dot > -0.985;
    }

    private hybridSurfaceEdge(ar: number, br: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
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

    private capsSurfacePoint(out: THREE.Vector3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number): boolean {
        const ar = Math.hypot(ax, ay, az);
        const br = Math.hypot(bx, by, bz);
        if (ar <= 0.000001 || br <= 0.000001) return false;
        const anx = ax / ar, any = ay / ar, anz = az / ar;
        const bnx = bx / br, bny = by / br, bnz = bz / br;
        const radius = THREE.MathUtils.lerp(ar, br, t);
        const dot = THREE.MathUtils.clamp(anx * bnx + any * bny + anz * bnz, -1, 1);

        if (dot > 0.9995) {
            const x = THREE.MathUtils.lerp(anx, bnx, t);
            const y = THREE.MathUtils.lerp(any, bny, t);
            const z = THREE.MathUtils.lerp(anz, bnz, t);
            const len = Math.hypot(x, y, z);
            if (len <= 0.000001) return false;
            out.set(x / len * radius, y / len * radius, z / len * radius);
            return true;
        }

        if (dot < -0.985) return false;
        const theta = Math.acos(dot);
        const sinTheta = Math.sin(theta);
        if (Math.abs(sinTheta) <= 0.000001) return false;
        const sourceScale = Math.sin((1 - t) * theta) / sinTheta;
        const targetScale = Math.sin(t * theta) / sinTheta;
        out.set(
            (anx * sourceScale + bnx * targetScale) * radius,
            (any * sourceScale + bny * targetScale) * radius,
            (anz * sourceScale + bnz * targetScale) * radius,
        );
        return true;
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
        this.writeEdgeColor(colorAttr, cursor, data, focus, edge, t);
        return cursor + 1;
    }

    private writeCapsSurfaceEdgeVertex(
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
        ox: number,
        oy: number,
        t: number,
    ): number {
        if (!this.capsSurfacePoint(this.edgeSurfacePoint, ax, ay, az, bx, by, bz, t)) {
            return this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax + ox, ay + oy, az, bx + ox, by + oy, bz, 0, t);
        }
        positionAttr.setXYZ(cursor, this.edgeSurfacePoint.x + ox, this.edgeSurfacePoint.y + oy, this.edgeSurfacePoint.z);
        this.writeEdgeColor(colorAttr, cursor, data, focus, edge, t);
        return cursor + 1;
    }

    private writeEdgeColor(colorAttr: THREE.BufferAttribute, cursor: number, data: GalaxySceneV2, focus: GalaxyFocusMask, edge: number, t: number): void {
        const color = this.edgeColor(data, edge, t);
        const bridgeBoost = data.edgeKinds[edge] === 1 ? 1.18 : 1;
        const glowBoost = 0.82 + THREE.MathUtils.clamp(this.settings.glow, 0, 1.8) * 0.2;
        const boost = (focus.hasFocus ? (focus.edgeLevels[edge] ? 1.04 : 0.1) : 0.76) * bridgeBoost * glowBoost;
        colorAttr.setXYZ(cursor, Math.min(0.78, color.r * boost), Math.min(0.86, color.g * boost), Math.min(0.88, color.b * boost));
    }

    private edgeColor(data: GalaxySceneV2, edge: number, t: number): THREE.Color {
        if (data.edgeKinds[edge] === 1 && (this.settings.edgeColorMode === 'entityBlend' || this.settings.edgeColorMode === 'aqua' || this.settings.edgeColorMode === 'cyan')) {
            return this.color.setRGB(
                THREE.MathUtils.lerp(0.12, 0.46, t),
                THREE.MathUtils.lerp(0.64, 0.24, t),
                THREE.MathUtils.lerp(0.7, 0.86, t),
            );
        }
        switch (this.settings.edgeColorMode) {
            case 'muted':
                return this.color.setRGB(0.13, 0.15, 0.2);
            case 'aqua':
            case 'cyan':
                return this.color.setRGB(0.07, 0.5, 0.58);
            case 'orchid':
                return this.color.setRGB(0.4, 0.18, 0.62);
            case 'gold':
                return this.color.setRGB(0.58, 0.36, 0.12);
            case 'confidence': {
                const confidence = THREE.MathUtils.clamp(data.edgeAlpha[edge] * 2.4, 0.16, 0.82);
                return this.color.setRGB(0.08 + confidence * 0.1, 0.24 + confidence * 0.32, 0.42 + confidence * 0.22);
            }
            default: {
                const offset = edge * 6 + (t < 0.5 ? 0 : 3);
                this.color.setRGB(data.edgeColors[offset], data.edgeColors[offset + 1], data.edgeColors[offset + 2]);
                this.color.offsetHSL(0, 0.06, -0.2);
                return this.color;
            }
        }
    }

    private clearObjects(): void {
        for (const object of [this.nodes, this.glows, this.shells, this.edges]) {
            if (!object) continue;
            this.scene.remove(object);
            if (object instanceof THREE.Group) {
                object.traverse((child) => {
                    const drawable = child as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
                    const geometry = drawable.geometry;
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
        this.shells = null;
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
