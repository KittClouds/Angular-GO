import type { GalaxyEdge, GalaxyLorentzGuide, GalaxyNode, Rgb } from './graph-galaxy-engine';

const LORENTZ_SCENE_RADIUS = 2.18;
const LORENTZ_RING_SEGMENTS = 96;
const LORENTZ_MAX_MEMBERSHIP_GUIDES = 220;
const TAU = Math.PI * 2;

const KIND_HSL: Record<string, string> = {
    identity: '188 80% 66%',
    relationship: '326 76% 66%',
    location: '166 66% 58%',
    event: '42 88% 62%',
    temporal: '260 76% 68%',
    causal: '24 82% 62%',
    mechanical: '206 76% 62%',
    emotional: '318 74% 66%',
    political: '356 72% 62%',
    evidence: '136 70% 62%',
    provenance: '92 58% 60%',
    contradiction: '2 86% 65%',
    abstraction: '228 66% 66%',
    species: '286 64% 66%',
    powerSystem: '292 80% 66%',
    documentStructure: '214 78% 62%',
};

export function applyLorentzTreeLayout(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyLorentzGuide[] {
    for (const node of nodes) {
        const info = lorentzNodeInfo(node);
        if (info) {
            node.x = clamp(info.klein[0] * LORENTZ_SCENE_RADIUS, -2.35, 2.35);
            node.y = clamp(info.klein[1] * LORENTZ_SCENE_RADIUS, -2.0, 2.0);
            node.z = clamp(info.klein[2] * LORENTZ_SCENE_RADIUS, -2.35, 2.35);
            node.depth = clamp(Math.hypot(info.klein[0], info.klein[1], info.klein[2]) / 0.96, 0, 1);
            node.radius *= lorentzNodeScale(info);
        } else {
            const fallback = stableVector(node.entity.id);
            node.x = fallback.x * 0.7;
            node.y = fallback.y * 0.48;
            node.z = fallback.z * 0.7;
            node.depth = 0.25;
            node.radius *= 0.86;
        }
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
    }

    for (const link of links) {
        if (!isLorentzTreeEdge(link)) continue;
        const source = nodes[link.source];
        const target = nodes[link.target];
        const sourceLevel = lorentzNodeInfo(source)?.level ?? 0;
        const targetLevel = lorentzNodeInfo(target)?.level ?? 0;
        const levelDelta = Math.abs(sourceLevel - targetLevel);
        link.alpha = Math.min(0.44, link.alpha * 1.36 + 0.035);
        link.curve *= 0.82 + Math.min(0.5, levelDelta * 0.12);
    }

    return [
        ...buildMembershipGuides(nodes, links),
        ...buildRootLaneGuides(nodes),
        ...buildLevelShellGuides(nodes),
        buildWAxisGuide(),
    ];
}

interface LorentzInfo {
    klein: [number, number, number, number];
    level: number;
    memberships: Array<Record<string, unknown>>;
    primaryTreeKind: string;
    treeId: string;
    w: number;
}

function buildMembershipGuides(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyLorentzGuide[] {
    const guides: GalaxyLorentzGuide[] = [];
    for (const link of links) {
        if (!isLorentzTreeEdge(link)) continue;
        const source = nodes[link.source];
        const target = nodes[link.target];
        const sourceInfo = lorentzNodeInfo(source);
        const targetInfo = lorentzNodeInfo(target);
        const treeKind = treeKindFromEdge(link.type) || targetInfo?.primaryTreeKind || sourceInfo?.primaryTreeKind || 'identity';
        const level = Math.max(sourceInfo?.level ?? 0, targetInfo?.level ?? 0);
        guides.push({
            id: `lorentz:guide:${link.id}`,
            nodeIds: [source.entity.id, target.entity.id],
            positions3d: laneSegments(source, target, level, treeKind),
            importance: Math.max(source.radius, target.radius) + link.confidence,
            treeId: targetInfo?.treeId || sourceInfo?.treeId || 'lorentz',
            treeKind,
            level,
            guideKind: 'membership',
            guideWeight: 0.72 + Math.min(0.5, link.confidence * 0.2),
            ...rgbForKind(treeKind),
        });
    }
    return guides
        .sort((left, right) => right.importance - left.importance || left.id.localeCompare(right.id))
        .slice(0, LORENTZ_MAX_MEMBERSHIP_GUIDES);
}

function buildRootLaneGuides(nodes: GalaxyNode[]): GalaxyLorentzGuide[] {
    return nodes
        .filter((node) => {
            const info = lorentzNodeInfo(node);
            return info && info.memberships.some((membership) => !membership['parentNodeId']);
        })
        .sort((left, right) => left.entity.id.localeCompare(right.entity.id))
        .slice(0, 32)
        .map((node) => {
            const info = lorentzNodeInfo(node)!;
            const treeKind = info.primaryTreeKind;
            return {
                id: `lorentz:root-lane:${node.entity.id}`,
                nodeIds: [node.entity.id],
                positions3d: rootLaneSegments(node, info),
                importance: 1.8 + node.radius,
                treeId: info.treeId,
                treeKind,
                level: 0,
                guideKind: 'rootLane' as const,
                guideWeight: 0.92,
                ...rgbForKind(treeKind),
            };
        });
}

function buildLevelShellGuides(nodes: GalaxyNode[]): GalaxyLorentzGuide[] {
    const levels = new Set<number>();
    for (const node of nodes) {
        const info = lorentzNodeInfo(node);
        if (info) levels.add(Math.min(8, Math.max(0, Math.round(info.level))));
    }
    return [...levels].sort((left, right) => left - right).slice(0, 7).map((level) => {
        const radius = levelRadius(level);
        return {
            id: `lorentz:level-shell:${level}`,
            nodeIds: [],
            positions3d: shellRingSegments(radius),
            importance: 0.2,
            treeId: 'lorentz:levels',
            treeKind: 'documentStructure',
            level,
            guideKind: 'levelShell' as const,
            guideWeight: Math.max(0.22, 0.62 - level * 0.045),
            ...rgbForKind(level % 2 === 0 ? 'documentStructure' : 'identity'),
        };
    });
}

function buildWAxisGuide(): GalaxyLorentzGuide {
    const positions = new Float32Array(48 * 6);
    for (let index = 0; index < 48; index++) {
        const a = -2.08 + (index / 48) * 4.16;
        const b = -2.08 + ((index + 1) / 48) * 4.16;
        const offset = index * 6;
        positions[offset] = 0;
        positions[offset + 1] = a;
        positions[offset + 2] = -0.03;
        positions[offset + 3] = 0;
        positions[offset + 4] = b;
        positions[offset + 5] = 0.03;
    }
    return {
        id: 'lorentz:w-axis',
        nodeIds: [],
        positions3d: positions,
        importance: 0.1,
        treeId: 'lorentz:w',
        treeKind: 'identity',
        level: 0,
        guideKind: 'wAxis',
        guideWeight: 0.24,
        r: 130,
        g: 238,
        b: 255,
    };
}

function laneSegments(source: GalaxyNode, target: GalaxyNode, level: number, treeKind: string): Float32Array {
    const steps = 12;
    const positions = new Float32Array(steps * 6);
    const lift = (0.06 + level * 0.018) * (stableUnit(`${source.entity.id}:${target.entity.id}:${treeKind}`) > 0.5 ? 1 : -1);
    const midpoint = {
        x: (source.x + target.x) * 0.5,
        y: (source.y + target.y) * 0.5 + lift,
        z: (source.z + target.z) * 0.5,
    };
    for (let index = 0; index < steps; index++) {
        const a = index / steps;
        const b = (index + 1) / steps;
        writeQuadratic(positions, index * 6, source, midpoint, target, a);
        writeQuadratic(positions, index * 6 + 3, source, midpoint, target, b);
    }
    return positions;
}

function rootLaneSegments(node: GalaxyNode, info: LorentzInfo): Float32Array {
    const positions = new Float32Array(8 * 6);
    const bias = info.w * 0.06;
    const center = { x: bias, y: -bias, z: 0 };
    for (let index = 0; index < 8; index++) {
        const a = index / 8;
        const b = (index + 1) / 8;
        writeQuadratic(positions, index * 6, center, { x: node.x * 0.24, y: node.y * 0.24 + 0.05, z: node.z * 0.24 }, node, a);
        writeQuadratic(positions, index * 6 + 3, center, { x: node.x * 0.24, y: node.y * 0.24 + 0.05, z: node.z * 0.24 }, node, b);
    }
    return positions;
}

function shellRingSegments(radius: number): Float32Array {
    const planes = 3;
    const positions = new Float32Array(planes * LORENTZ_RING_SEGMENTS * 6);
    let cursor = 0;
    for (let plane = 0; plane < planes; plane++) {
        for (let index = 0; index < LORENTZ_RING_SEGMENTS; index++) {
            const a = (index / LORENTZ_RING_SEGMENTS) * TAU;
            const b = ((index + 1) / LORENTZ_RING_SEGMENTS) * TAU;
            cursor = writeRingPoint(positions, cursor, plane, radius, a);
            cursor = writeRingPoint(positions, cursor, plane, radius, b);
        }
    }
    return positions;
}

function writeQuadratic(buffer: Float32Array, offset: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, t: number): void {
    const left = (1 - t) * (1 - t);
    const mid = 2 * (1 - t) * t;
    const right = t * t;
    buffer[offset] = left * a.x + mid * b.x + right * c.x;
    buffer[offset + 1] = left * a.y + mid * b.y + right * c.y;
    buffer[offset + 2] = left * a.z + mid * b.z + right * c.z;
}

function writeRingPoint(buffer: Float32Array, cursor: number, plane: number, radius: number, angle: number): number {
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (plane === 0) buffer.set([x, y, 0], cursor);
    else if (plane === 1) buffer.set([x, 0, y], cursor);
    else buffer.set([0, x, y], cursor);
    return cursor + 3;
}

function levelRadius(level: number): number {
    return clamp(0.58 + level * 0.24, 0.58, 2.18);
}

function lorentzNodeInfo(node: GalaxyNode): LorentzInfo | null {
    const value = node.entity.metadata?.['lorentz'];
    if (!value || typeof value !== 'object') return null;
    const metadata = value as Record<string, unknown>;
    const klein = metadata['klein'];
    if (!Array.isArray(klein) || klein.length < 4) return null;
    const memberships = Array.isArray(metadata['memberships']) ? metadata['memberships'] as Array<Record<string, unknown>> : [];
    const primary = memberships[0];
    return {
        klein: [finite(klein[0]), finite(klein[1]), finite(klein[2]), finite(klein[3])],
        level: finite(metadata['level'] ?? primary?.['level']),
        memberships,
        primaryTreeKind: String(metadata['primaryTreeKind'] || primary?.['treeKind'] || 'identity'),
        treeId: String(primary?.['treeId'] || 'lorentz'),
        w: finite(metadata['w']),
    };
}

function lorentzNodeScale(info: LorentzInfo): number {
    const membershipBoost = Math.min(0.18, info.memberships.length * 0.035);
    const levelScale = info.level <= 0 ? 1.16 : Math.max(0.72, 1 - info.level * 0.035);
    const wGlow = Math.min(0.08, Math.abs(info.w) * 0.1);
    return levelScale + membershipBoost + wGlow;
}

function isLorentzTreeEdge(link: GalaxyEdge): boolean {
    return String(link.type || '').startsWith('lorentz-tree');
}

function treeKindFromEdge(type: string): string {
    const [, kind = ''] = String(type || '').split(':');
    return kind || 'identity';
}

function rgbForKind(kind: string): Rgb {
    return hslToRgb(KIND_HSL[kind] ?? '198 74% 64%');
}

function hslToRgb(rawHsl: string): Rgb {
    const values = rawHsl.match(/-?\d+(?:\.\d+)?/g)?.map((part) => Number(part)) ?? [];
    const [h = 190, s = 70, l = 55] = values;
    const hue = ((h % 360) + 360) % 360;
    const saturation = clamp(s / 100, 0, 1);
    const lightness = clamp(l / 100, 0, 1);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const match = lightness - chroma / 2;
    const [red, green, blue] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
    return { r: Math.round((red + match) * 255), g: Math.round((green + match) * 255), b: Math.round((blue + match) * 255) };
}

function stableVector(id: string): { x: number; y: number; z: number } {
    const a = stableUnit(`${id}:a`) * TAU;
    const y = stableUnit(`${id}:y`) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    return { x: Math.cos(a) * radial, y, z: Math.sin(a) * radial };
}

function stableUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}
