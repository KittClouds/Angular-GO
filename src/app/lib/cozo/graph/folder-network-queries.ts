import { cozoDb } from '../db';
import { FOLDER_HIERARCHY_QUERIES } from '../schema/layer2-folder-hierarchy';
import { NETWORK_INSTANCE_QUERIES } from '../schema/layer2-network-instance';
import { NETWORK_MEMBERSHIP_QUERIES } from '../schema/layer2-network-membership';
import { NETWORK_RELATIONSHIP_QUERIES } from '../schema/layer2-network-relationship';
import { UNIFIED_EDGE_QUERIES } from '../schema/layer2-unified-edges';
import type {
    CozoFolderHierarchyEdge,
    CozoNetworkInstance,
    CozoNetworkMembership,
    CozoNetworkRelationship,
    CozoUnifiedEdge,
    UnifiedEdgeSource,
    GraphScope,
} from '../types';

function safeQuery<T>(query: string, fallback: T): T {
    try {
        if (!cozoDb.isReady()) return fallback;

        // Check if query is safe (read-only)
        // In strict mode we might want to enforce this, but for now we trust the queries

        const result = cozoDb.runQuery(query);
        if (result.ok === false) {
            const msg = result.message || '';
            if (msg.includes('not found')) return fallback;
            console.warn('[folder-network-queries] Query warning:', msg);
            return fallback;
        }
        return (result.rows || fallback) as T;
    } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes('not found')) return fallback;
        console.error('[folder-network-queries] Query error:', err);
        return fallback;
    }
}

function escape(str: string): string {
    if (typeof str !== 'string') return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function getFolderChildren(folderId: string): CozoFolderHierarchyEdge[] {
    const query = FOLDER_HIERARCHY_QUERIES.getByParentId
        .replace('$parent_id', `"${escape(folderId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        parentId: row[1] as string,
        childId: row[2] as string,
        edgeType: row[3] as string,
        inverseType: row[4] as string,
        childEntityKind: row[5] as string | undefined,
        confidence: row[6] as number,
        extractionMethods: row[7] as string[],
        createdAt: new Date(),
        validAt: new Date(),
        groupId: '',
        scopeType: 'folder' as GraphScope,
        narrativeId: '',
    }));
}

export function getFolderParent(folderId: string): CozoFolderHierarchyEdge | null {
    const query = FOLDER_HIERARCHY_QUERIES.getByChildId
        .replace('$child_id', `"${escape(folderId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
        id: row[0] as string,
        parentId: row[1] as string,
        childId: row[2] as string,
        edgeType: row[3] as string,
        inverseType: row[4] as string,
        parentEntityKind: row[5] as string | undefined,
        confidence: row[6] as number,
        extractionMethods: row[7] as string[],
        createdAt: new Date(),
        validAt: new Date(),
        groupId: '',
        scopeType: 'folder' as GraphScope,
        narrativeId: '',
    };
}

export function getFolderAncestors(folderId: string): Array<{ ancestorId: string; depth: number }> {
    const query = FOLDER_HIERARCHY_QUERIES.getAncestors
        .replace(/\$folder_id/g, `"${escape(folderId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        ancestorId: row[0] as string,
        depth: row[1] as number,
    }));
}

export function getFolderDescendants(folderId: string): Array<{ descendantId: string; depth: number }> {
    const query = FOLDER_HIERARCHY_QUERIES.getDescendants
        .replace(/\$folder_id/g, `"${escape(folderId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        descendantId: row[0] as string,
        depth: row[1] as number,
    }));
}

export function getNetworkById(networkId: string): CozoNetworkInstance | null {
    const query = NETWORK_INSTANCE_QUERIES.getById
        .replace('$id', `"${escape(networkId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
        id: row[0] as string,
        name: row[1] as string,
        schemaId: row[2] as string,
        networkKind: row[3] as string,
        networkSubtype: row[4] as string | undefined,
        rootFolderId: row[5] as string,
        rootEntityId: row[6] as string | undefined,
        namespace: row[7] as string,
        description: row[8] as string | undefined,
        tags: row[9] as string[],
        memberCount: row[10] as number,
        relationshipCount: row[11] as number,
        maxDepth: row[12] as number,
        createdAt: new Date(row[13] as number),
        updatedAt: new Date(row[14] as number),
        groupId: row[15] as string,
        scopeType: row[16] as GraphScope,
        narrativeId: '',
    };
}

export function getNetworksByKind(kind: string): CozoNetworkInstance[] {
    const query = NETWORK_INSTANCE_QUERIES.getByKind
        .replace('$kind', `"${escape(kind)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        name: row[1] as string,
        schemaId: row[2] as string,
        networkKind: row[3] as string,
        networkSubtype: row[4] as string | undefined,
        rootFolderId: row[5] as string,
        namespace: row[6] as string,
        memberCount: row[7] as number,
        relationshipCount: row[8] as number,
        rootEntityId: undefined,
        description: undefined,
        tags: [],
        maxDepth: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        groupId: '',
        scopeType: 'network' as GraphScope,
        narrativeId: '',
    }));
}

export function getAllNetworks(): CozoNetworkInstance[] {
    const rows = safeQuery<unknown[][]>(NETWORK_INSTANCE_QUERIES.getAll, []);
    return rows.map(row => ({
        id: row[0] as string,
        name: row[1] as string,
        schemaId: row[2] as string,
        networkKind: row[3] as string,
        networkSubtype: row[4] as string | undefined,
        rootFolderId: row[5] as string,
        rootEntityId: row[6] as string | undefined,
        namespace: row[7] as string,
        memberCount: row[8] as number,
        relationshipCount: row[9] as number,
        maxDepth: row[10] as number,
        createdAt: new Date(row[11] as number),
        description: undefined,
        tags: [],
        updatedAt: new Date(),
        groupId: '',
        scopeType: 'network' as GraphScope,
        narrativeId: '',
    }));
}

export function getNetworkMembers(networkId: string): CozoNetworkMembership[] {
    const query = NETWORK_MEMBERSHIP_QUERIES.getByNetworkId
        .replace('$network_id', `"${escape(networkId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        networkId: row[1] as string,
        entityId: row[2] as string,
        role: row[3] as string | undefined,
        joinedAt: new Date(row[4] as number),
        leftAt: row[5] ? new Date(row[5] as number) : undefined,
        isRoot: row[6] as boolean,
        depthLevel: row[7] as number,
        createdAt: new Date(row[8] as number),
        updatedAt: new Date(),
        groupId: '',
        extractionMethods: [],
        narrativeId: '',
    }));
}

export function getEntityNetworks(entityId: string): CozoNetworkMembership[] {
    const query = NETWORK_MEMBERSHIP_QUERIES.getByEntityId
        .replace('$entity_id', `"${escape(entityId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        networkId: row[1] as string,
        entityId: row[2] as string,
        role: row[3] as string | undefined,
        isRoot: row[4] as boolean,
        depthLevel: row[5] as number,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        groupId: '',
        extractionMethods: [],
        narrativeId: '',
    }));
}

export function getNetworkRelationships(networkId: string): CozoNetworkRelationship[] {
    const query = NETWORK_RELATIONSHIP_QUERIES.getByNetworkId
        .replace('$network_id', `"${escape(networkId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        networkId: row[1] as string,
        sourceId: row[2] as string,
        targetId: row[3] as string,
        relationshipCode: row[4] as string,
        inverseCode: row[5] as string | undefined,
        startDate: row[6] ? new Date(row[6] as number) : undefined,
        endDate: row[7] ? new Date(row[7] as number) : undefined,
        strength: row[8] as number,
        notes: row[9] as string | undefined,
        confidence: row[10] as number,
        attributes: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        groupId: '',
        scopeType: 'network' as GraphScope,
        extractionMethods: [],
        narrativeId: '',
    }));
}

export function getRelationshipsBetweenEntities(
    entityA: string,
    entityB: string
): CozoNetworkRelationship[] {
    const query = NETWORK_RELATIONSHIP_QUERIES.getBetweenEntities
        .replace('$entity_a', `"${escape(entityA)}"`)
        .replace('$entity_b', `"${escape(entityB)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        networkId: row[1] as string,
        relationshipCode: row[2] as string,
        inverseCode: row[3] as string | undefined,
        strength: row[4] as number,
        confidence: row[5] as number,
        notes: row[6] as string | undefined,
        sourceId: '',
        targetId: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        groupId: '',
        scopeType: 'network' as GraphScope,
        extractionMethods: [],
        narrativeId: '',
    }));
}

export function getAllEdgesForEntity(entityId: string): CozoUnifiedEdge[] {
    const query = UNIFIED_EDGE_QUERIES.getEdgesByEntity
        .replace(/\$entity_id/g, `"${escape(entityId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        sourceId: entityId,
        targetId: row[1] as string,
        edgeType: row[2] as string,
        confidence: row[3] as number,
        sources: row[4] as string[],
        direction: row[5] as 'outgoing' | 'incoming',
        edgeSource: row[6] as UnifiedEdgeSource,
        groupId: '',
    }));
}

export function getAllUnifiedEdges(): CozoUnifiedEdge[] {
    const rows = safeQuery<unknown[][]>(UNIFIED_EDGE_QUERIES.getAllEdges, []);
    return rows.map(row => ({
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        edgeType: row[3] as string,
        confidence: row[4] as number,
        sources: row[5] as string[],
        groupId: row[6] as string,
        edgeSource: row[7] as UnifiedEdgeSource,
    }));
}

export function getUnifiedEdgesByGroupId(groupId: string): CozoUnifiedEdge[] {
    const query = UNIFIED_EDGE_QUERIES.getEdgesByGroupId
        .replace('$group_id', `"${escape(groupId)}"`);

    const rows = safeQuery<unknown[][]>(query, []);
    return rows.map(row => ({
        id: row[0] as string,
        sourceId: row[1] as string,
        targetId: row[2] as string,
        edgeType: row[3] as string,
        confidence: row[4] as number,
        sources: row[5] as string[],
        edgeSource: row[6] as UnifiedEdgeSource,
        groupId,
    }));
}

export function getEdgeCountBySource(): Record<UnifiedEdgeSource, number> {
    const rows = safeQuery<unknown[][]>(UNIFIED_EDGE_QUERIES.countBySource, []);
    const counts: Record<UnifiedEdgeSource, number> = {
        entity_edge: 0,
        folder_hierarchy: 0,
        network_relationship: 0,
    };

    for (const row of rows) {
        const source = row[0] as UnifiedEdgeSource;
        const count = row[1] as number;
        counts[source] = count;
    }

    return counts;
}
