import * as THREE from 'three';

import type { GalaxySceneGroupView, GalaxySceneV2 } from './graph-galaxy-scene-v2';
import { buildGalaxyFocusMask, type GalaxyFocusMask } from './graph-galaxy-focus';
import { mergeGalaxySettings, type GalaxyRenderSettings } from './graph-galaxy-engine';
import { GraphGalaxyForceController } from './graph-galaxy-force-controller';
import { buildGalaxyGlows, buildGalaxyNodes, type GalaxyNodeObject } from './graph-galaxy-objects';
import { GraphGalaxyParticles } from './graph-galaxy-particles';
import { makeAtomTexture, makeHaloTexture, makeLabelSprite, makeNodeTexture, type LabelSprite } from './graph-galaxy-textures';
import type { GraphRendererMode, GraphRendererPointer, GraphRendererPort } from './graph-renderer-port';

const MAX_EDGE_SEGMENTS = 8;
const MAX_EDGE_STROKES = 5;

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
    private readonly pickVector = new THREE.Vector3();
    private readonly perspective = new THREE.PerspectiveCamera(48, 1, 0.01, 100);
    private readonly ortho = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.01, 100);
    private readonly color = new THREE.Color();
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
        const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: this.settings.edgeOpacity * 0.62, blending: THREE.NormalBlending, toneMapped: false });
        return new THREE.LineSegments(geometry, material);
    }

    private applyModePositions(): void {
        const data = this.sceneData;
        if (!data) return;
        const positions = this.mode === '2d' ? data.positions2d : data.positions3d;
        const focus = buildGalaxyFocusMask(data, this.selectedId, this.hoverId);
        this.updateGroupShells(data);
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
        this.updateGroupShells(data);
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
            const pulse = active && this.settings.selectedPulse ? 1.14 : 1;
            const core = Math.max(0.038, data.radii[i] * 0.021) * pulse;
            const sphere = this.nodeShape === 'sphere';
            const atom = this.nodeShape === 'atom';
            const halo = core * this.settings.glow * (atom
                ? (hovered ? 2.44 : active ? 2.58 : neighbor ? 1.72 : dimmed ? 0.62 : 1.16)
                : sphere
                    ? (hovered ? 1.94 : active ? 2.12 : neighbor ? 1.28 : dimmed ? 0.52 : 0.94)
                    : (hovered ? 4.9 : active ? 5.05 : neighbor ? 3.1 : dimmed ? 1.15 : 2.45));
            node.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            node.scale.setScalar(core * (atom
                ? (hovered || active ? 2.64 : neighbor ? 2.05 : dimmed ? 1.28 : 1.78)
                : sphere
                    ? (hovered || active ? 0.89 : neighbor ? 0.72 : dimmed ? 0.52 : 0.6)
                    : (hovered || active ? 2.65 : neighbor ? 2.02 : dimmed ? 1.34 : 1.72)));
            this.nodeColor(data, i, active, hovered, neighbor, dimmed);
            const material = node.material as THREE.SpriteMaterial | THREE.MeshBasicMaterial;
            material.color.copy(this.color);
            material.opacity = dimmed ? 0.18 : neighbor ? 0.82 : hovered || active ? 1 : 0.94;
            glow.position.copy(node.position);
            glow.scale.setScalar(halo);
            this.glowColor(data, i, active, hovered, dimmed);
            glow.material.color.copy(this.color);
            const glowBase = atom
                ? (dimmed ? 0.012 : hovered || active ? 0.24 : neighbor ? 0.105 : 0.072)
                : sphere
                    ? (dimmed ? 0.012 : hovered || active ? 0.28 : neighbor ? 0.11 : 0.078)
                    : (dimmed ? 0.04 : hovered || active ? 0.58 : neighbor ? 0.28 : 0.22);
            glow.material.opacity = THREE.MathUtils.clamp(glowBase * this.settings.glow, 0, 0.34);
        }
    }

    private updateEdgeGeometry(data: GalaxySceneV2, positions: Float32Array, focus: GalaxyFocusMask): void {
        if (!this.edges) return;
        const positionAttr = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
        const colorAttr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
        positionAttr.array.fill(0);
        colorAttr.array.fill(0);
        let cursor = 0;
        const steps = this.settings.edgeMode === 'curved' ? MAX_EDGE_SEGMENTS : 1;
        const strokes = this.edgeStrokeCount();
        const strokeOffset = this.edgeStrokeOffset();
        for (let edge = 0; edge < data.edgePairs.length / 2; edge++) {
            const interGalaxy = data.edgeKinds[edge] === 1;
            const source = data.edgePairs[edge * 2];
            const target = data.edgePairs[edge * 2 + 1];
            const ax = positions[source * 3], ay = positions[source * 3 + 1], az = positions[source * 3 + 2];
            const bx = positions[target * 3], by = positions[target * 3 + 1], bz = positions[target * 3 + 2];
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
                    cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax + ox, ay + oy, az, bx + ox, by + oy, bz, lift, t0);
                    cursor = this.writeEdgeVertex(positionAttr, colorAttr, cursor, data, focus, edge, ax + ox, ay + oy, az, bx + ox, by + oy, bz, lift, t1);
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
            material.opacity = this.settings.edgeMode === 'hidden' ? 0 : Math.max(0.012, this.settings.edgeOpacity * 0.62);
            material.linewidth = Math.max(1, this.settings.edgeWidth * 0.72);
            material.needsUpdate = true;
        }
        this.glows?.children.forEach((child) => {
            const material = (child as THREE.Sprite).material;
            material.opacity = THREE.MathUtils.clamp(this.settings.glow * 0.2, 0, 0.34);
            material.needsUpdate = true;
        });
        this.shells?.children.forEach((child) => {
            const material = (child as THREE.Mesh | THREE.Line).material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
            const shellOpacity = this.settings.hybridShellVisible ? this.settings.hybridShellOpacity : 0;
            material.opacity = THREE.MathUtils.clamp(0.012 + this.settings.glow * 0.01, 0.01, 0.028) * shellOpacity;
            material.needsUpdate = true;
        });
        this.particles.updateSettings(this.settings);
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
        if (scene.layoutMode !== 'multiGalaxy' || scene.groups.length < 2) return null;
        const group = new THREE.Group();
        for (const shell of scene.groups) {
            const geometry = new THREE.SphereGeometry(shell.radius, 28, 14);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(shell.color.r, shell.color.g, shell.color.b),
                transparent: true,
                opacity: THREE.MathUtils.clamp(0.026 + this.settings.glow * 0.018, 0.02, 0.07),
                wireframe: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                toneMapped: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(shell.center.x, shell.center.y, shell.center.z);
            mesh.userData['groupId'] = shell.id;
            mesh.userData['pickable'] = false;
            group.add(mesh);
        }
        return group;
    }

    private buildHybridGuides(): THREE.Group {
        const group = new THREE.Group();
        const shellOpacity = this.settings.hybridShellVisible ? this.settings.hybridShellOpacity : 0;
        const shellMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.22, 0.9, 0.86),
            transparent: true,
            opacity: THREE.MathUtils.clamp(0.012 + this.settings.glow * 0.01, 0.01, 0.028) * shellOpacity,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
        });
        const outer = new THREE.Mesh(new THREE.SphereGeometry(2.32, 48, 24), shellMaterial);
        outer.userData['pickable'] = false;
        group.add(outer);
        return group;
    }

    private updateGroupShells(data: GalaxySceneV2): void {
        if (!this.shells) return;
        if (data.layoutMode === 'hybridSpace') {
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
        const bridgeBoost = data.edgeKinds[edge] === 1 ? 1.18 : 1;
        const boost = (focus.hasFocus ? (focus.edgeLevels[edge] ? 1.04 : 0.1) : 0.76) * bridgeBoost;
        colorAttr.setXYZ(cursor, Math.min(0.72, color.r * boost), Math.min(0.8, color.g * boost), Math.min(0.82, color.b * boost));
        return cursor + 1;
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
