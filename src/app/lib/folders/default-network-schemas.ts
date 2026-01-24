// src/app/lib/folders/default-network-schemas.ts
// Default network schemas for relationship types

import type { NetworkSchema, NetworkRelationshipDef } from '../dexie/db';

const now = Date.now();

// =============================================================================
// FAMILY NETWORK SCHEMA
// =============================================================================

const FAMILY_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'family-parent',
        code: 'PARENT_OF',
        label: 'Parent of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'OUTBOUND',
        inverseCode: 'CHILD_OF',
        icon: 'arrow-down',
    },
    {
        id: 'family-child',
        code: 'CHILD_OF',
        label: 'Child of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'OUTBOUND',
        inverseCode: 'PARENT_OF',
        icon: 'arrow-up',
    },
    {
        id: 'family-spouse',
        code: 'SPOUSE_OF',
        label: 'Spouse of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'heart',
    },
    {
        id: 'family-sibling',
        code: 'SIBLING_OF',
        label: 'Sibling of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'users',
    },
];

export const FAMILY_NETWORK_SCHEMA: NetworkSchema = {
    id: 'FAMILY',
    name: 'Family Tree',
    kind: 'FAMILY',
    description: 'Family relationships (parent, child, spouse, sibling)',
    allowedEntityKinds: ['CHARACTER', 'NPC'],
    relationships: FAMILY_RELATIONSHIPS,
    isHierarchical: true,
    allowCycles: false,
    autoCreateInverse: true,
    icon: 'users',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// ORGANIZATION NETWORK SCHEMA
// =============================================================================

const ORG_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'org-manages',
        code: 'MANAGES',
        label: 'Manages',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'OUTBOUND',
        inverseCode: 'REPORTS_TO',
        icon: 'arrow-down',
    },
    {
        id: 'org-reports-to',
        code: 'REPORTS_TO',
        label: 'Reports to',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'OUTBOUND',
        inverseCode: 'MANAGES',
        icon: 'arrow-up',
    },
    {
        id: 'org-colleague',
        code: 'COLLEAGUE_OF',
        label: 'Colleague of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'users',
    },
];

export const ORGANIZATION_NETWORK_SCHEMA: NetworkSchema = {
    id: 'ORGANIZATION',
    name: 'Organization',
    kind: 'ORGANIZATION',
    description: 'Organizational hierarchy (manages, reports to)',
    allowedEntityKinds: ['CHARACTER', 'NPC'],
    relationships: ORG_RELATIONSHIPS,
    isHierarchical: true,
    allowCycles: false,
    autoCreateInverse: true,
    icon: 'building',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// FACTION NETWORK SCHEMA
// =============================================================================

const FACTION_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'faction-leads',
        code: 'LEADS',
        label: 'Leads',
        sourceKind: 'CHARACTER',
        targetKind: 'FACTION',
        direction: 'OUTBOUND',
        icon: 'crown',
    },
    {
        id: 'faction-member',
        code: 'MEMBER_OF',
        label: 'Member of',
        sourceKind: 'CHARACTER',
        targetKind: 'FACTION',
        direction: 'OUTBOUND',
        icon: 'user-plus',
    },
    {
        id: 'faction-ally',
        code: 'ALLY_OF',
        label: 'Ally of',
        sourceKind: 'FACTION',
        targetKind: 'FACTION',
        direction: 'BIDIRECTIONAL',
        icon: 'handshake',
    },
    {
        id: 'faction-enemy',
        code: 'ENEMY_OF',
        label: 'Enemy of',
        sourceKind: 'FACTION',
        targetKind: 'FACTION',
        direction: 'BIDIRECTIONAL',
        icon: 'swords',
    },
];

export const FACTION_NETWORK_SCHEMA: NetworkSchema = {
    id: 'FACTION',
    name: 'Faction',
    kind: 'FACTION',
    description: 'Faction relationships (leads, member, ally, enemy)',
    allowedEntityKinds: ['CHARACTER', 'NPC', 'FACTION'],
    relationships: FACTION_RELATIONSHIPS,
    isHierarchical: false,
    allowCycles: true,
    autoCreateInverse: true,
    icon: 'shield',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// ALLIANCE NETWORK SCHEMA
// =============================================================================

const ALLIANCE_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'alliance-partner',
        code: 'PARTNER_WITH',
        label: 'Partner with',
        sourceKind: 'FACTION',
        targetKind: 'FACTION',
        direction: 'BIDIRECTIONAL',
        icon: 'link',
    },
];

export const ALLIANCE_NETWORK_SCHEMA: NetworkSchema = {
    id: 'ALLIANCE',
    name: 'Alliance',
    kind: 'ALLIANCE',
    description: 'Alliance between factions',
    allowedEntityKinds: ['FACTION', 'ORGANIZATION'],
    relationships: ALLIANCE_RELATIONSHIPS,
    isHierarchical: false,
    allowCycles: true,
    autoCreateInverse: true,
    icon: 'link',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// FRIENDSHIP NETWORK SCHEMA
// =============================================================================

const FRIENDSHIP_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'friend-of',
        code: 'FRIEND_OF',
        label: 'Friend of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'smile',
    },
    {
        id: 'best-friend',
        code: 'BEST_FRIEND_OF',
        label: 'Best friend of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'heart',
    },
];

export const FRIENDSHIP_NETWORK_SCHEMA: NetworkSchema = {
    id: 'FRIENDSHIP',
    name: 'Friendship',
    kind: 'FRIENDSHIP',
    description: 'Friendship relationships',
    allowedEntityKinds: ['CHARACTER', 'NPC'],
    relationships: FRIENDSHIP_RELATIONSHIPS,
    isHierarchical: false,
    allowCycles: true,
    autoCreateInverse: true,
    icon: 'smile',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// RIVALRY NETWORK SCHEMA
// =============================================================================

const RIVALRY_RELATIONSHIPS: NetworkRelationshipDef[] = [
    {
        id: 'rival-of',
        code: 'RIVAL_OF',
        label: 'Rival of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'zap',
    },
    {
        id: 'nemesis-of',
        code: 'NEMESIS_OF',
        label: 'Nemesis of',
        sourceKind: 'CHARACTER',
        targetKind: 'CHARACTER',
        direction: 'BIDIRECTIONAL',
        icon: 'skull',
    },
];

export const RIVALRY_NETWORK_SCHEMA: NetworkSchema = {
    id: 'RIVALRY',
    name: 'Rivalry',
    kind: 'RIVALRY',
    description: 'Rivalry and nemesis relationships',
    allowedEntityKinds: ['CHARACTER', 'NPC', 'FACTION'],
    relationships: RIVALRY_RELATIONSHIPS,
    isHierarchical: false,
    allowCycles: true,
    autoCreateInverse: true,
    icon: 'zap',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
};

// =============================================================================
// ALL DEFAULT NETWORK SCHEMAS
// =============================================================================

export const DEFAULT_NETWORK_SCHEMAS: NetworkSchema[] = [
    FAMILY_NETWORK_SCHEMA,
    ORGANIZATION_NETWORK_SCHEMA,
    FACTION_NETWORK_SCHEMA,
    ALLIANCE_NETWORK_SCHEMA,
    FRIENDSHIP_NETWORK_SCHEMA,
    RIVALRY_NETWORK_SCHEMA,
];
