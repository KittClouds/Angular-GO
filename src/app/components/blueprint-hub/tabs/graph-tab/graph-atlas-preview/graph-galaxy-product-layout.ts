import type { GalaxyEdge, GalaxyLorentzGuide, GalaxyNode, Rgb } from './graph-galaxy-engine';
import { normalizeProductHopfPhase, productHopfAgreement, productHopfBraidDirection, productHopfTension } from './graph-galaxy-product-hopf';
import { GRAPH_RELATION_FAMILY_HSL, relationFamilyFromText } from './graph-relation-visual-style';
import { entityColorStore, normalizeGraphNodeColorKind } from '../../../../../lib/store/entityColorStore';

const PRODUCT_SCENE_RADIUS = 2.12;
const PRODUCT_MAX_GUIDES = 260;
const TAU = Math.PI * 2;

const KIND_HSL: Record<string, string> = {
    identity: '188 80% 66%',
    semantic: '178 72% 58%',
    document: '206 76% 62%',
    documentStructure: '206 76% 62%',
    entity: '284 74% 66%',
    evidence: '136 70% 62%',
    event: '42 88% 62%',
    temporal: '260 76% 68%',
    causal: '24 82% 62%',
    bridge: '302 76% 66%',
    backbone: '190 72% 68%',
    outlier: '354 82% 65%',
    ...GRAPH_RELATION_FAMILY_HSL,
};

interface ProductInfo {
    clusterId: string;
    lane: string;
    role: string;
    medoidId: string;
    outlierScore: number;
    hubScore: number;
    phase: number;
    laneWeights: Record<string, number>;
    lorentz: Vec3;
}

interface ProductBasin {
    id: string;
    indexes: number[];
    center: Vec3;
    lane: string;
    medoidIndex: number;
}

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export function applyProductConsensusLayout(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyLorentzGuide[] {
    if (!nodes.length) return [];
    const infos = nodes.map(productInfo);
    const basins = buildBasins(nodes, infos);
    placeBasinCenters(basins);
    const basinById = new Map(basins.map((basin) => [basin.id, basin]));
    const basinIndexByNode = new Map<number, ProductBasin>();
    for (const basin of basins) {
        for (const index of basin.indexes) basinIndexByNode.set(index, basin);
    }

    for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        const info = infos[index];
        const basin = basinById.get(info.clusterId) ?? basins[0];
        const lane = laneDirection(info.lane);
        const local = localOffset(node.entity.id, lane, info);
        const lorentz = scale(info.lorentz, 0.12);
        const rolePush = roleRadialPush(info.role, info.outlierScore);
        const target = add(add(scale(basin.center, rolePush), local), lorentz);
        node.x = target.x;
        node.y = target.y;
        node.z = target.z;
        node.radius *= nodeScale(info);
        node.depth = clamp(length(target) / PRODUCT_SCENE_RADIUS, 0, 1);
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
    }

    relaxConsensus(nodes, links, infos, basinIndexByNode);
    normalizeProductVolume(nodes);
    tuneProductLinks(nodes, links, infos);
    return buildProductGuides(nodes, links, infos, basinIndexByNode);
}

function buildBasins(nodes: GalaxyNode[], infos: ProductInfo[]): ProductBasin[] {
    const byId = new Map<string, ProductBasin>();
    for (let index = 0; index < nodes.length; index++) {
        const info = infos[index];
        let basin = byId.get(info.clusterId);
        if (!basin) {
            basin = { id: info.clusterId, indexes: [], center: { x: 0, y: 0, z: 0 }, lane: info.lane, medoidIndex: -1 };
            byId.set(info.clusterId, basin);
        }
        basin.indexes.push(index);
        if (info.medoidId === nodes[index].entity.id || info.role === 'core') basin.medoidIndex = index;
    }
    const basins = [...byId.values()].sort((left, right) => right.indexes.length - left.indexes.length || left.id.localeCompare(right.id));
    for (const basin of basins) {
        if (basin.medoidIndex >= 0) continue;
        basin.medoidIndex = basin.indexes
            .slice()
            .sort((left, right) => infos[right].hubScore - infos[left].hubScore || infos[left].outlierScore - infos[right].outlierScore || left - right)[0] ?? -1;
    }
    return basins;
}

function placeBasinCenters(basins: ProductBasin[]): void {
    const total = Math.max(1, basins.length);
    for (let index = 0; index < basins.length; index++) {
        const basin = basins[index];
        const lane = laneDirection(basin.lane);
        const angle = (index / total) * TAU + stableUnit(`${basin.id}:basin`) * 0.7;
        const ring = { x: Math.cos(angle), y: Math.sin(angle) * 0.42, z: Math.sin(angle) };
        const height = ((index % 5) - 2) * 0.11 + (stableUnit(`${basin.id}:height`) - 0.5) * 0.14;
        const raw = add(add(scale(ring, 0.82), scale(lane, 0.34)), { x: 0, y: height, z: 0 });
        const radius = clamp(0.58 + Math.sqrt(basin.indexes.length) * 0.055, 0.62, 1.12);
        basin.center = scale(normalize(raw), radius);
    }
}

function relaxConsensus(
    nodes: GalaxyNode[],
    links: GalaxyEdge[],
    infos: ProductInfo[],
    basinByNode: Map<number, ProductBasin>,
): void {
    for (let pass = 0; pass < 4; pass++) {
        for (const link of links) {
            const source = nodes[link.source];
            const target = nodes[link.target];
            if (!source || !target) continue;
            const sourceInfo = infos[link.source];
            const targetInfo = infos[link.target];
            const sameBasin = sourceInfo.clusterId === targetInfo.clusterId;
            const strength = productAffinity(link, sourceInfo, targetInfo);
            const hopfAgreement = productHopfAgreement(sourceInfo, targetInfo);
            const hopfTension = productHopfTension(sourceInfo, targetInfo);
            const phaseBridge = !sameBasin && hopfAgreement > 0.72;
            const ideal = sameBasin ? 0.26 + hopfTension * 0.42 : phaseBridge ? 0.64 + hopfTension * 0.22 : link.type === 'embedding-bridge' ? 0.78 + hopfTension * 0.28 : 0.96 + hopfTension * 0.34;
            pullPair(source, target, ideal, strength * (sameBasin ? 0.038 : 0.025));
            if (hopfTension > 0.28) {
                const braid = productHopfBraidDirection(sourceInfo, targetInfo, link.id);
                const offset = (hopfTension - 0.28) * (sameBasin ? 0.024 : 0.024);
                source.x -= braid.x * offset; source.y -= braid.y * offset; source.z -= braid.z * offset;
                target.x += braid.x * offset; target.y += braid.y * offset; target.z += braid.z * offset;
            }
        }
        for (const basin of new Set(basinByNode.values())) {
            const medoid = basin.medoidIndex >= 0 ? nodes[basin.medoidIndex] : undefined;
            if (!medoid) continue;
            for (const index of basin.indexes) {
                if (index === basin.medoidIndex) continue;
                const node = nodes[index];
                const info = infos[index];
                const pull = info.role === 'bridge' ? 0.018 : info.role === 'outlier' ? 0.006 : 0.032;
                node.x += (medoid.x - node.x) * pull;
                node.y += (medoid.y - node.y) * pull;
                node.z += (medoid.z - node.z) * pull;
            }
        }
    }
}

function pullPair(source: GalaxyNode, target: GalaxyNode, ideal: number, strength: number): void {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dz = target.z - source.z;
    const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
    const force = (distance - ideal) * strength;
    const x = dx / distance * force;
    const y = dy / distance * force;
    const z = dz / distance * force;
    source.x += x;
    source.y += y;
    source.z += z;
    target.x -= x;
    target.y -= y;
    target.z -= z;
}

function normalizeProductVolume(nodes: GalaxyNode[]): void {
    let maxRadius = 0.001;
    for (const node of nodes) maxRadius = Math.max(maxRadius, Math.hypot(node.x, node.y, node.z));
    const scaleFactor = maxRadius > PRODUCT_SCENE_RADIUS ? PRODUCT_SCENE_RADIUS / maxRadius : 1;
    for (const node of nodes) {
        node.x *= scaleFactor;
        node.y *= scaleFactor;
        node.z *= scaleFactor;
        node.depth = clamp(Math.hypot(node.x, node.y, node.z) / PRODUCT_SCENE_RADIUS, 0, 1);
        node.baseX = node.x;
        node.baseY = node.y;
        node.baseZ = node.z;
    }
}

function tuneProductLinks(nodes: GalaxyNode[], links: GalaxyEdge[], infos: ProductInfo[]): void {
    for (const link of links) {
        const sourceInfo = infos[link.source];
        const targetInfo = infos[link.target];
        const sameBasin = sourceInfo.clusterId === targetInfo.clusterId;
        const strength = productAffinity(link, sourceInfo, targetInfo);
        const hopfAgreement = productHopfAgreement(sourceInfo, targetInfo);
        const hopfTension = productHopfTension(sourceInfo, targetInfo);
        if (sameBasin || link.type === 'embedding-backbone') {
            link.alpha = Math.min(0.64, link.alpha * 1.28 + strength * 0.042 + hopfAgreement * 0.018);
            link.curve *= 0.54 + hopfTension * 0.34;
        } else if (link.type === 'embedding-bridge' || sourceInfo.role === 'bridge' || targetInfo.role === 'bridge') {
            link.alpha = Math.min(0.58, link.alpha * 1.08 + strength * 0.028 + hopfAgreement * 0.022);
            link.curve *= 1.08 + hopfTension * 0.58;
        } else {
            link.alpha = Math.min(0.5, link.alpha * 1.04 + strength * 0.018 + hopfAgreement * 0.014);
            link.curve *= 0.92 + hopfTension * 0.48;
        }
        if (sourceInfo.role === 'outlier' || targetInfo.role === 'outlier') link.alpha *= 0.82;
        if (!Number.isFinite(link.curve)) link.curve = 0;
    }
}

function buildProductGuides(
    nodes: GalaxyNode[],
    links: GalaxyEdge[],
    infos: ProductInfo[],
    basinByNode: Map<number, ProductBasin>,
): GalaxyLorentzGuide[] {
    const guides: GalaxyLorentzGuide[] = [];
    for (const link of links) {
        const source = nodes[link.source];
        const target = nodes[link.target];
        if (!source || !target) continue;
        const sourceInfo = infos[link.source];
        const targetInfo = infos[link.target];
        const treeKind = productGuideKind(link, source, target, sourceInfo, targetInfo);
        const sameBasin = sourceInfo.clusterId === targetInfo.clusterId;
        const level = sameBasin ? 1 : 2;
        const strength = productAffinity(link, sourceInfo, targetInfo);
        guides.push({
            id: `product:consensus-guide:${link.id}`,
            nodeIds: [source.entity.id, target.entity.id],
            positions3d: guideSegments(source, target, treeKind, sameBasin, strength, sourceInfo, targetInfo, basinByNode.get(link.source), basinByNode.get(link.target)),
            importance: Math.max(source.radius, target.radius) * 0.54 + strength + link.confidence,
            treeId: sameBasin ? `product:basin:${sourceInfo.clusterId}` : 'product:bridge-consensus',
            treeKind,
            level,
            guideKind: 'membership',
            guideWeight: 0.42 + Math.min(0.42, strength * 0.32 + link.confidence * 0.08),
            ...rgbForKind(treeKind),
        });
    }
    return guides
        .sort((left, right) => right.importance - left.importance || left.id.localeCompare(right.id))
        .slice(0, PRODUCT_MAX_GUIDES);
}

function guideSegments(
    source: GalaxyNode,
    target: GalaxyNode,
    treeKind: string,
    sameBasin: boolean,
    strength: number,
    sourceInfo: ProductInfo,
    targetInfo: ProductInfo,
    sourceBasin?: ProductBasin,
    targetBasin?: ProductBasin,
): Float32Array {
    const steps = 10;
    const positions = new Float32Array(steps * 6);
    const sign = stableUnit(`${source.entity.id}:${target.entity.id}:${treeKind}`) > 0.5 ? 1 : -1;
    const center = sourceBasin && targetBasin
        ? scale(add(sourceBasin.center, targetBasin.center), 0.5)
        : scale(add(vectorOf(source), vectorOf(target)), 0.5);
    const lift = sameBasin ? 0.035 + strength * 0.03 : 0.11 + strength * 0.08;
    const tension = productHopfTension(sourceInfo, targetInfo);
    const braid = productHopfBraidDirection(sourceInfo, targetInfo, `${source.entity.id}:${target.entity.id}:${treeKind}`);
    const midpoint = add(add(center, scale(laneDirection(treeKind), lift * sign)), scale(braid, (0.026 + tension * 0.12) * sign));
    for (let index = 0; index < steps; index++) {
        const a = index / steps;
        const b = (index + 1) / steps;
        writeQuadratic(positions, index * 6, vectorOf(source), midpoint, vectorOf(target), a);
        writeQuadratic(positions, index * 6 + 3, vectorOf(source), midpoint, vectorOf(target), b);
    }
    return positions;
}

function productInfo(node: GalaxyNode): ProductInfo {
    const metadata = node.entity.metadata || {};
    const product = record(metadata['product']);
    const region = record(product['region']);
    const lanes = record(product['lanes']);
    const fiber = record(product['fiber']);
    const hopf = record(metadata['hopf']);
    const laneWeights = numberRecord(lanes['laneWeights']);
    const lane = firstText(
        metadata['productLaneKind'],
        product['dominantLane'],
        region['laneKind'],
        dominantLane(laneWeights),
        hopf['fiberKind'],
        lorentzPrimaryTreeKind(node),
        fallbackLane(node),
    );
    const outlierScore = finite(metadata['embeddingOutlierScore'] ?? region['outlierScore']);
    const hubScore = finite(metadata['embeddingHubScore'] ?? region['hubScore']);
    const directRole = firstText(metadata['productRegionRole'], region['role']);
    const role = directRole || derivedRole(node, outlierScore, hubScore);
    const medoidId = firstText(metadata['embeddingMedoidTargetId'], region['medoidTargetId']);
    const clusterId = firstText(metadata['embeddingClusterId'], region['clusterId'], medoidId && `medoid:${medoidId}`, `lane:${lane}`);
    return {
        clusterId,
        lane,
        role,
        medoidId,
        outlierScore,
        hubScore,
        phase: normalizeProductHopfPhase(fiber['phase'] ?? lanes['fiberPhase'] ?? hopf['phase'], `${node.entity.id}:${lane}`),
        laneWeights,
        lorentz: lorentzDirection(node),
    };
}

function derivedRole(node: GalaxyNode, outlierScore: number, hubScore: number): string {
    const metadata = node.entity.metadata || {};
    const medoid = String(metadata['embeddingMedoidTargetId'] || '');
    if (outlierScore >= 0.72) return 'outlier';
    if (medoid && medoid === node.entity.id) return 'core';
    if (hubScore >= 0.72) return 'backbone';
    if (outlierScore >= 0.42) return 'boundary';
    return 'core';
}

function localOffset(id: string, lane: Vec3, info: ProductInfo): Vec3 {
    const seed = stableVector(`${id}:product:${info.clusterId}:${info.lane}`);
    const tangentA = normalize(cross(lane, Math.abs(lane.y) > 0.72 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
    const tangentB = normalize(cross(lane, tangentA));
    const phase = info.phase + (stableUnit(`${id}:phase`) - 0.5) * 0.52;
    const orbit = add(scale(tangentA, Math.cos(phase)), scale(tangentB, Math.sin(phase)));
    const radius = roleLocalRadius(info.role, info.outlierScore);
    const laneWeight = clamp(info.laneWeights[info.lane] ?? 0.36, 0, 1);
    return add(add(scale(orbit, radius), scale(seed, radius * 0.24)), scale(lane, laneWeight * 0.12));
}

function roleLocalRadius(role: string, outlierScore: number): number {
    if (role === 'core') return 0.075;
    if (role === 'backbone') return 0.16;
    if (role === 'bridge') return 0.31;
    if (role === 'boundary') return 0.42;
    if (role === 'outlier') return 0.56 + clamp(outlierScore - 0.7, 0, 0.3);
    return 0.24;
}

function roleRadialPush(role: string, outlierScore: number): number {
    if (role === 'core') return 0.82;
    if (role === 'backbone') return 0.98;
    if (role === 'bridge') return 1.12;
    if (role === 'boundary') return 1.22;
    if (role === 'outlier') return 1.44 + clamp(outlierScore - 0.7, 0, 0.3) * 0.7;
    return 1;
}

function nodeScale(info: ProductInfo): number {
    if (info.role === 'core') return 1.03;
    if (info.role === 'backbone') return 1.01;
    if (info.role === 'outlier') return 0.9;
    return 0.96;
}

function productAffinity(link: GalaxyEdge, source: ProductInfo, target: ProductInfo): number {
    let score = clamp(link.confidence, 0.12, 1) * 0.36;
    const agreement = productHopfAgreement(source, target);
    const tension = productHopfTension(source, target);
    if (source.clusterId === target.clusterId) score += 0.34;
    if (source.lane === target.lane) score += 0.16;
    if (link.type === 'embedding-backbone') score += 0.22;
    if (link.type === 'embedding-bridge') score += 0.12;
    if (source.medoidId && source.medoidId === target.medoidId) score += 0.12;
    score += agreement * 0.14;
    if (source.clusterId !== target.clusterId && agreement > 0.72) score += 0.08;
    if (tension > 0.62 && link.type !== 'embedding-bridge') score -= tension * 0.08;
    return clamp(score, 0.1, 1);
}

function productGuideKind(link: GalaxyEdge, source: GalaxyNode, target: GalaxyNode, sourceInfo: ProductInfo, targetInfo: ProductInfo): string {
    const relation = relationFamilyFromText(link.type, source.entity.label, source.entity.metadata?.['preview'], target.entity.label, target.entity.metadata?.['preview']);
    if (relation) return relation;
    const sourceKind = productNodeKind(source);
    const targetKind = productNodeKind(target);
    if (sourceKind !== 'semantic') return sourceKind;
    if (targetKind !== 'semantic') return targetKind;
    if (link.type === 'embedding-backbone') return 'backbone';
    if (link.type === 'embedding-bridge' || sourceInfo.role === 'bridge' || targetInfo.role === 'bridge') return 'bridge';
    if (sourceInfo.role === 'outlier' || targetInfo.role === 'outlier') return 'outlier';
    if (sourceInfo.lane === targetInfo.lane) return sourceInfo.lane;
    return targetInfo.lane || sourceInfo.lane || 'semantic';
}

function productNodeKind(node: GalaxyNode): string {
    const text = `${node.entity.kind || ''} ${node.entity.metadata?.['sourceType'] || ''} ${node.entity.label || ''}`.toLowerCase();
    return /causal|cause|effect/.test(text) ? 'causal' : /event|scene/.test(text) ? 'event' : /memory|evidence|source|provenance/.test(text) ? 'evidence' : /chunk|anchor|note|document|doc/.test(text) ? 'documentStructure' : 'semantic';
}

function laneDirection(lane: string): Vec3 {
    const key = lane.toLowerCase();
    if (key.includes('causal')) return normalize({ x: 0.72, y: -0.58, z: 0.26 });
    if (key.includes('temporal') || key.includes('timeline')) return normalize({ x: -0.18, y: -0.86, z: 0.48 });
    if (key.includes('document') || key.includes('structure')) return normalize({ x: -0.62, y: 0.2, z: 0.72 });
    if (key.includes('entity') || key.includes('identity')) return normalize({ x: 0.2, y: 0.66, z: 0.72 });
    if (key.includes('evidence')) return normalize({ x: 0.56, y: 0.28, z: -0.78 });
    if (key.includes('bridge')) return normalize({ x: -0.44, y: 0.18, z: -0.88 });
    return stableVector(`lane:${lane || 'semantic'}`);
}

function lorentzDirection(node: GalaxyNode): Vec3 {
    const lorentz = record(node.entity.metadata?.['lorentz']);
    const klein = lorentz['klein'];
    if (!Array.isArray(klein) || klein.length < 3) return { x: 0, y: 0, z: 0 };
    return normalize({ x: finite(klein[0]), y: finite(klein[1]), z: finite(klein[2]) });
}

function lorentzPrimaryTreeKind(node: GalaxyNode): string {
    const lorentz = record(node.entity.metadata?.['lorentz']);
    const memberships = lorentz['memberships'];
    const primary = Array.isArray(memberships) ? record(memberships[0]) : {};
    return firstText(lorentz['primaryTreeKind'], primary['treeKind']);
}

function fallbackLane(node: GalaxyNode): string {
    const text = `${node.entity.kind || ''} ${node.entity.metadata?.['sourceType'] || ''} ${node.entity.label || ''}`.toLowerCase();
    const relation = relationFamilyFromText(text, node.entity.metadata?.['preview']);
    if (relation) return relation;
    return /causal|cause|effect/.test(text) ? 'causal' : /temporal|timeline|before|after/.test(text) ? 'temporal' : /chunk|anchor|note|document|doc/.test(text) ? 'document' : /entity|character|location|network/.test(text) ? 'entity' : /evidence|memory|source|provenance/.test(text) ? 'evidence' : 'semantic';
}

function dominantLane(weights: Record<string, number>): string {
    let best = '';
    let score = 0;
    for (const [lane, value] of Object.entries(weights)) {
        if (value > score) {
            best = lane;
            score = value;
        }
    }
    return best;
}

function rgbForKind(kind: string): Rgb {
    const graphNodeKind = normalizeGraphNodeColorKind(kind);
    if (graphNodeKind) return hslToRgb(entityColorStore.getRawGraphNodeHsl(graphNodeKind));
    return hslToRgb(KIND_HSL[kind] ?? '198 74% 64%');
}

function hslToRgb(rawHsl: string): Rgb {
    const values = rawHsl.match(/-?\d+(?:\.\d+)?/g)?.map((part) => Number(part)) ?? [];
    const [h = 190, s = 70, l = 55] = values;
    const amount = s * Math.min(l, 100 - l) / 10000;
    const channel = (offset: number) => { const k = (offset + h / 30) % 12; return l / 100 - amount * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return { r: Math.round(channel(0) * 255), g: Math.round(channel(8) * 255), b: Math.round(channel(4) * 255) };
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

function numberRecord(value: unknown): Record<string, number> {
    const source = record(value);
    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(source)) {
        const value = Number(raw); if (Number.isFinite(value)) result[key.toLowerCase()] = value;
    }
    return result;
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const text = String(value || '').trim().toLowerCase(); if (text) return text;
    }
    return '';
}

function vectorOf(node: GalaxyNode): Vec3 { return { x: node.x, y: node.y, z: node.z }; }

function writeQuadratic(buffer: Float32Array, offset: number, a: Vec3, b: Vec3, c: Vec3, t: number): void {
    const left = (1 - t) * (1 - t);
    const mid = 2 * (1 - t) * t;
    const right = t * t;
    buffer[offset] = left * a.x + mid * b.x + right * c.x;
    buffer[offset + 1] = left * a.y + mid * b.y + right * c.y;
    buffer[offset + 2] = left * a.z + mid * b.z + right * c.z;
}

function stableVector(id: string): Vec3 {
    const a = stableUnit(`${id}:a`) * TAU;
    const y = stableUnit(`${id}:y`) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    return { x: Math.cos(a) * radial, y, z: Math.sin(a) * radial };
}

function stableUnit(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return (hash >>> 0) / 4294967295;
}

function finite(value: unknown): number {
    const number = Number(value); return Number.isFinite(number) ? number : 0;
}

function add(left: Vec3, right: Vec3): Vec3 { return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }; }

function scale(value: Vec3, amount: number): Vec3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }

function cross(left: Vec3, right: Vec3): Vec3 {
    return { x: left.y * right.z - left.z * right.y, y: left.z * right.x - left.x * right.z, z: left.x * right.y - left.y * right.x };
}

function length(value: Vec3): number { return Math.hypot(value.x, value.y, value.z); }

function normalize(value: Vec3): Vec3 { const size = Math.max(0.001, length(value)); return { x: value.x / size, y: value.y / size, z: value.z / size }; }

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
