import type { GalaxyEdge, GalaxyHopfRibbon, GalaxyNode, Rgb } from './graph-galaxy-engine';

const PRODUCT_CONTEXT_SAMPLE_LIMIT = 384;
const PRODUCT_FIBER_GUIDE_LIMIT = 48;
const TAU = Math.PI * 2;

interface HopfBaseInfo extends Rgb {
    key: string;
    phases: number[];
    nodeIds: string[];
    fiberKinds: Set<string>;
    importance: number;
}

interface ProductFiberOwnerPlan {
    ownerIds: Set<string>;
    ownerByNodeId: Map<string, string>;
}

export function productHopfProjectionNodes(nodes: GalaxyNode[], links: GalaxyEdge[]): GalaxyNode[] {
    const plan = productFiberOwnerPlan(nodes, links);
    const clones: GalaxyNode[] = [];
    for (const node of nodes) {
        const ownerId = plan.ownerByNodeId.get(node.entity.id);
        if (!ownerId) continue;
        if (ownerId !== node.entity.id && weakCooccurrenceNode(node)) continue;
        clones.push(productHopfClone(node, ownerId, plan.ownerIds.has(node.entity.id)));
    }

    const samples: GalaxyNode[] = [];
    const seen = new Set<string>();
    const addSample = (ownerId: string | undefined, context: GalaxyNode | undefined, link: GalaxyEdge, side: string) => {
        if (!ownerId || !context || ownerId === context.entity.id || samples.length >= PRODUCT_CONTEXT_SAMPLE_LIMIT) return;
        if (weakCooccurrence(link) && !promotedContextLink(link)) return;
        const base = nodes.find((node) => node.entity.id === ownerId);
        if (!base) return;
        const fiberKind = productContextFiberKind(context, link);
        const key = `${ownerId}|${context.entity.id}|${link.id}|${fiberKind}|${side}`;
        if (seen.has(key)) return;
        seen.add(key);
        samples.push(productContextSampleNode(base, context, link, fiberKind, side, samples.length));
    };

    for (const link of links) {
        const source = nodes[link.source];
        const target = nodes[link.target];
        if (!source || !target) continue;
        addSample(plan.ownerByNodeId.get(source.entity.id), source, link, 'source');
        addSample(plan.ownerByNodeId.get(target.entity.id), target, link, 'target');
        if (plan.ownerByNodeId.get(source.entity.id) !== plan.ownerByNodeId.get(target.entity.id) && promotedContextLink(link)) {
            addSample(plan.ownerByNodeId.get(source.entity.id), target, link, 'bridge-target');
            addSample(plan.ownerByNodeId.get(target.entity.id), source, link, 'bridge-source');
        }
    }

    return [...clones, ...samples];
}

export function buildProductLocalHopfRibbons(productNodes: GalaxyNode[], hopfNodes: GalaxyNode[]): GalaxyHopfRibbon[] {
    const productById = new Map(productNodes.map((node) => [node.entity.id, node]));
    const baseInfos = new Map<string, HopfBaseInfo>();
    for (const node of hopfNodes) {
        const baseKey = hopfBaseKey(node);
        const base = baseKey ? productById.get(baseKey) : undefined;
        if (!baseKey || !base) continue;
        const existing = baseInfos.get(baseKey);
        const info = existing ?? {
            key: baseKey,
            phases: [],
            nodeIds: [],
            fiberKinds: new Set<string>(),
            importance: 0,
            r: base.r,
            g: base.g,
            b: base.b,
        };
        const fiber = hopfFiberKind(node);
        info.phases.push(normalizePhaseRadians(hopfPhase(node, baseKey)));
        info.nodeIds.push(node.entity.id);
        info.fiberKinds.add(fiber);
        info.importance += fiberImportance(node, fiber);
        baseInfos.set(baseKey, info);
    }

    return [...baseInfos.values()]
        .filter((info) => info.nodeIds.length > 1 || info.importance > 3)
        .sort((left, right) => right.importance - left.importance || left.key.localeCompare(right.key))
        .slice(0, PRODUCT_FIBER_GUIDE_LIMIT)
        .map((info) => {
            const base = productById.get(info.key)!;
            return {
                id: `product:local-fiber:${info.key}`,
                nodeIds: [...new Set(info.nodeIds)],
                positions3d: productLocalFiberSegments(base, info.phases, info.importance),
                importance: info.importance,
                guideKind: 'dataFiber' as const,
                guideWeight: 0.7 + Math.min(0.24, Math.log1p(info.importance) * 0.035),
                r: info.r,
                g: info.g,
                b: info.b,
            };
        });
}

function productFiberOwnerPlan(nodes: GalaxyNode[], links: GalaxyEdge[]): ProductFiberOwnerPlan {
    const nodeById = new Map(nodes.map((node) => [node.entity.id, node]));
    const refToId = productRefMap(nodes);
    const contextMass = new Map<string, number>();
    const clusterNodes = new Map<string, GalaxyNode[]>();
    const ownerIds = new Set<string>();

    for (const link of links) {
        addMass(contextMass, nodes[link.source]?.entity.id, link.confidence);
        addMass(contextMass, nodes[link.target]?.entity.id, link.confidence);
    }
    for (const node of nodes) {
        const clusterId = productClusterId(node);
        const cluster = clusterNodes.get(clusterId) ?? [];
        cluster.push(node);
        clusterNodes.set(clusterId, cluster);
        const medoidId = productMedoidId(node);
        if (medoidId && nodeById.has(medoidId)) ownerIds.add(medoidId);
        if (isExplicitProductAnchor(node) || qualifiedEntityOwner(node, contextMass.get(node.entity.id) || 0)) ownerIds.add(node.entity.id);
    }
    for (const cluster of clusterNodes.values()) {
        if (cluster.some((node) => ownerIds.has(node.entity.id))) continue;
        const best = cluster.slice().sort((left, right) =>
            productOwnerScore(right, contextMass) - productOwnerScore(left, contextMass)
            || left.entity.id.localeCompare(right.entity.id),
        )[0];
        if (best) ownerIds.add(best.entity.id);
    }

    const ownerByNodeId = new Map<string, string>();
    for (const node of nodes) {
        if (ownerIds.has(node.entity.id)) {
            ownerByNodeId.set(node.entity.id, node.entity.id);
            continue;
        }
        const medoidId = productMedoidId(node);
        const sourceEntityId = stringMetadata(node, 'sourceEntityId');
        const sourceId = stringMetadata(node, 'sourceId');
        const owner = ownerIds.has(medoidId) ? medoidId
            : ownerIds.has(refToId.get(sourceEntityId) || '') ? refToId.get(sourceEntityId)!
            : ownerIds.has(refToId.get(sourceId) || '') ? refToId.get(sourceId)!
            : clusterNodes.get(productClusterId(node))?.find((candidate) => ownerIds.has(candidate.entity.id))?.entity.id;
        if (owner) ownerByNodeId.set(node.entity.id, owner);
    }
    return { ownerIds, ownerByNodeId };
}

function productHopfClone(node: GalaxyNode, ownerId: string, owner: boolean): GalaxyNode {
    const metadata = node.entity.metadata || {};
    const existingHopf = hopfMetadata(node) || {};
    const fiberKind = String(existingHopf['fiberKind'] || productContextFiberKind(node, null));
    const phase = Number.isFinite(Number(existingHopf['phase'])) ? Number(existingHopf['phase']) : productPhase(`${ownerId}:${node.entity.id}:${fiberKind}`);
    return {
        ...node,
        entity: {
            ...node.entity,
            metadata: {
                ...metadata,
                hopf: { ...existingHopf, role: owner ? 'anchor' : 'fiber', baseId: ownerId, fiberKind, phase },
            },
        },
    };
}

function productContextSampleNode(base: GalaxyNode, context: GalaxyNode, link: GalaxyEdge, fiberKind: string, side: string, ordinal: number): GalaxyNode {
    const weak = weakCooccurrence(link);
    const phase = productPhase(`${base.entity.id}:${context.entity.id}:${link.id}:${fiberKind}:${ordinal}`);
    const metadata = context.entity.metadata || {};
    return {
        ...context,
        entity: {
            ...context.entity,
            id: `product:context:${base.entity.id}:${context.entity.id}:${link.id}:${side}`,
            label: `${base.entity.label} / ${fiberKind.replace(/_/g, ' ')}`,
            kind: `PRODUCT_CONTEXT:${fiberKind}`,
            totalMentions: Math.max(1, Math.round((context.entity.totalMentions || 1) * Math.max(0.45, link.confidence || 0.65))),
            colorHsl: base.entity.colorHsl || context.entity.colorHsl,
            metadata: {
                ...metadata,
                sourceType: 'product_context_sample',
                product: { role: 'contextSample', baseId: base.entity.id, sourceNodeId: context.entity.id, linkId: link.id, linkType: link.type, fiberKind },
                hopf: { role: 'fiber', baseId: base.entity.id, fiberKind, phase },
            },
        },
        r: base.r,
        g: base.g,
        b: base.b,
        radius: Math.max(0.95, context.radius * (weak ? 0.42 : 0.68)),
        galaxyOpacity: 0,
    };
}

function productLocalFiberSegments(base: GalaxyNode, phases: number[], importance: number): Float32Array {
    const frame = productLocalFrame(base);
    const phaseSet = new Set<number>();
    for (let index = 0; index < 40; index++) phaseSet.add(roundPhase((index / 40) * TAU));
    for (const phase of phases) phaseSet.add(roundPhase(phase));
    const samples = [...phaseSet].sort((left, right) => left - right);
    const radius = clamp(0.095 + Math.log1p(Math.max(1, importance)) * 0.018, 0.11, 0.26);
    const positions = new Float32Array(samples.length * 2 * 3);
    for (let index = 0; index < samples.length; index++) {
        const current = productLocalFiberPoint(base, frame, samples[index], radius);
        const next = productLocalFiberPoint(base, frame, samples[(index + 1) % samples.length], radius);
        const offset = index * 6;
        positions[offset] = current.x; positions[offset + 1] = current.y; positions[offset + 2] = current.z;
        positions[offset + 3] = next.x; positions[offset + 4] = next.y; positions[offset + 5] = next.z;
    }
    return positions;
}

function productLocalFiberPoint(base: GalaxyNode, frame: { a: Vec3; b: Vec3; radial: Vec3 }, phase: number, radius: number): Vec3 {
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    const wobble = Math.sin(phase * 2 + stableUnit(`${base.entity.id}:fiber-wobble`) * TAU) * radius * 0.18;
    return {
        x: base.x + (frame.a.x * c + frame.b.x * s) * radius + frame.radial.x * wobble,
        y: base.y + (frame.a.y * c + frame.b.y * s) * radius + frame.radial.y * wobble,
        z: base.z + (frame.a.z * c + frame.b.z * s) * radius + frame.radial.z * wobble,
    };
}

function productLocalFrame(base: GalaxyNode): { radial: Vec3; a: Vec3; b: Vec3 } {
    const radial = normalizeVector({ x: base.x, y: base.y, z: base.z }, stableVector(`${base.entity.id}:product-fiber`));
    const pole = Math.abs(radial.y) > 0.82 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const a = normalizeVector(cross(radial, pole), stableVector(`${base.entity.id}:product-fiber-a`));
    return { radial, a, b: normalizeVector(cross(radial, a), stableVector(`${base.entity.id}:product-fiber-b`)) };
}

function productRefMap(nodes: GalaxyNode[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const node of nodes) for (const ref of productEntityRefs(node)) out.set(ref, node.entity.id);
    return out;
}

function productEntityRefs(node: GalaxyNode): string[] {
    const refs = new Set<string>([node.entity.id, stringMetadata(node, 'sourceId'), stringMetadata(node, 'sourceEntityId')]);
    for (const prefix of ['embed:entity:', 'entity::']) {
        if (node.entity.id.startsWith(prefix)) refs.add(node.entity.id.slice(prefix.length));
    }
    return [...refs].filter(Boolean);
}

function qualifiedEntityOwner(node: GalaxyNode, mass: number): boolean {
    const metadata = node.entity.metadata || {};
    const role = String(metadata['productRegionRole'] || record(record(metadata['product'])['region'])['role'] || '').toLowerCase();
    const mentions = Number(node.entity.totalMentions || 0);
    if (!isEntityLike(node)) return false;
    return role === 'core' || role === 'backbone' || mass >= 1.4 || mentions >= 3;
}

function productOwnerScore(node: GalaxyNode, mass: Map<string, number>): number {
    const metadata = node.entity.metadata || {};
    const role = String(metadata['productRegionRole'] || '').toLowerCase();
    const roleScore = role === 'core' ? 3 : role === 'backbone' ? 2.4 : role === 'bridge' ? 1.4 : 1;
    return roleScore + Number(metadata['embeddingHubScore'] || 0) + (mass.get(node.entity.id) || 0) + (isEntityLike(node) ? 0.35 : 0);
}

function productContextFiberKind(context: GalaxyNode, link: GalaxyEdge | null): string {
    const text = [link?.type || '', context.entity.kind || '', context.entity.label || '', context.entity.metadata?.sourceType || '', context.entity.metadata?.['preview'] || ''].join(' ').toLowerCase();
    if (/co.?occurs/.test(text)) return 'cooccurrence';
    if (/observ/.test(text)) return 'observation';
    if (/communicat|comment|says|tells/.test(text)) return 'communication';
    if (/caus|because|therefore|effect/.test(text)) return 'causal';
    if (/time|temporal|before|after|timeline/.test(text)) return 'temporal';
    if (/event|scene|episode/.test(text)) return 'event';
    if (/anchor|evidence|source|span|provenance|memory|state/.test(text)) return 'evidence';
    if (/relationship|relation|graph-fact|fact/.test(text)) return 'relationship';
    if (/chunk|note|document|doc|leaf/.test(text)) return 'document_structure';
    if (/location|place|city|tower|realm/.test(text)) return 'location';
    return 'identity';
}

function fiberImportance(node: GalaxyNode, fiberKind: string): number {
    const base = Math.max(1, Number(node.entity.totalMentions || 1));
    const role = String(hopfMetadata(node)?.['role'] || '');
    const kindWeight = fiberKind === 'cooccurrence' ? 0.25 : fiberKind === 'identity' ? 0.72 : 1.08;
    return base * kindWeight * (role === 'fiber' ? 1.18 : 0.65);
}

function productClusterId(node: GalaxyNode): string {
    const metadata = node.entity.metadata || {};
    const region = record(record(metadata['product'])['region']);
    const medoid = productMedoidId(node);
    return stringValue(metadata['embeddingClusterId']) || stringValue(region['clusterId']) || (medoid ? `medoid:${medoid}` : `lane:${productContextFiberKind(node, null)}`);
}

function productMedoidId(node: GalaxyNode): string {
    const metadata = node.entity.metadata || {};
    return stringValue(metadata['embeddingMedoidTargetId']) || stringValue(record(record(metadata['product'])['region'])['medoidTargetId']);
}

function hopfBaseKey(node: GalaxyNode): string | null {
    const metadata = hopfMetadata(node);
    const baseId = String(metadata?.['baseId'] || '');
    if (baseId) return baseId;
    return null;
}

function hopfFiberKind(node: GalaxyNode): string {
    return String(hopfMetadata(node)?.['fiberKind'] || productContextFiberKind(node, null)).toLowerCase();
}

function hopfPhase(node: GalaxyNode, baseKey: string): number {
    const metadataPhase = Number(hopfMetadata(node)?.['phase']);
    return Number.isFinite(metadataPhase) ? (metadataPhase >= 0 && metadataPhase <= 1 ? metadataPhase * TAU : metadataPhase) : productPhase(`${baseKey}:${node.entity.id}`);
}

function isExplicitProductAnchor(node: GalaxyNode): boolean {
    const hopf = hopfMetadata(node);
    return hopf?.['role'] === 'anchor' && (!hopf['baseId'] || hopf['baseId'] === node.entity.id);
}

function isEntityLike(node: GalaxyNode): boolean {
    const sourceType = String(node.entity.metadata?.sourceType || '').toLowerCase();
    const kind = String(node.entity.kind || '').toLowerCase();
    const id = node.entity.id.toLowerCase();
    return sourceType === 'entity' || id.startsWith('embed:entity:') || id.startsWith('entity::') || /character|entity|location|network|item|concept/.test(kind);
}

function weakCooccurrence(link: GalaxyEdge): boolean { return /co.?occurs/.test(String(link.type || '').toLowerCase()); }
function weakCooccurrenceNode(node: GalaxyNode): boolean {
    const text = `${node.entity.kind || ''} ${node.entity.label || ''} ${node.entity.metadata?.['preview'] || ''}`.toLowerCase();
    return /co.?occurs/.test(text) && !/backbone|bridge|promot/.test(text);
}
function promotedContextLink(link: GalaxyEdge): boolean { return /^embedding-(backbone|bridge)$/.test(link.type) || link.confidence >= 0.82; }
function addMass(mass: Map<string, number>, id: string | undefined, value: number): void { if (id) mass.set(id, (mass.get(id) || 0) + Math.max(0.1, value || 0.1)); }
function productPhase(value: string): number { return Math.round(stableUnit(value) * 1000000) / 1000000; }
function normalizePhaseRadians(value: number): number { return ((value % TAU) + TAU) % TAU; }
function roundPhase(value: number): number { return Math.round(normalizePhaseRadians(value) * 1000000) / 1000000; }
function hopfMetadata(node: GalaxyNode): Record<string, unknown> | null { const value = node.entity.metadata?.['hopf']; return value && typeof value === 'object' ? value as Record<string, unknown> : null; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === 'string' && value.trim() ? value.trim() : ''; }
function stringMetadata(node: GalaxyNode, key: string): string { return stringValue(node.entity.metadata?.[key]); }

interface Vec3 { x: number; y: number; z: number }
function cross(left: Vec3, right: Vec3): Vec3 { return { x: left.y * right.z - left.z * right.y, y: left.z * right.x - left.x * right.z, z: left.x * right.y - left.y * right.x }; }
function normalizeVector(value: Vec3, fallback: Vec3): Vec3 { const norm = Math.hypot(value.x, value.y, value.z); return norm > 0.0001 ? { x: value.x / norm, y: value.y / norm, z: value.z / norm } : fallback; }
function stableVector(id: string): Vec3 { const a = stableUnit(`${id}:a`) * TAU; const y = stableUnit(`${id}:y`) * 2 - 1; const radial = Math.sqrt(Math.max(0, 1 - y * y)); return { x: Math.cos(a) * radial, y, z: Math.sin(a) * radial }; }
function stableUnit(value: string): number { let hash = 2166136261; for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0) / 4294967295; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
