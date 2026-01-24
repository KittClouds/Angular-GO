// src/app/lib/folders/default-schemas.ts
// Default folder schemas for all entity kinds

import type { FolderSchema, AllowedSubfolderDef, AllowedNoteTypeDef } from '../dexie/db';

const now = Date.now();

// =============================================================================
// NARRATIVE FOLDER SCHEMA (Vault Root)
// =============================================================================

export const NARRATIVE_FOLDER_SCHEMA: FolderSchema = {
    id: 'NARRATIVE',
    entityKind: 'NARRATIVE',
    name: 'Narrative',
    description: 'A self-contained story world (vault root)',
    isVaultRoot: true,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'book-open',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'CHARACTER', label: 'Characters', icon: 'users', description: 'Character folder' },
        { entityKind: 'LOCATION', label: 'Locations', icon: 'map-pin', description: 'Location folder' },
        { entityKind: 'ITEM', label: 'Items', icon: 'package', description: 'Item folder' },
        { entityKind: 'CONCEPT', label: 'World Building', icon: 'lightbulb', description: 'Concept folder' },
        { entityKind: 'EVENT', label: 'Events', icon: 'calendar', description: 'Event folder' },
        { entityKind: 'TIMELINE', label: 'Timelines', icon: 'clock', description: 'Timeline folder' },
        { entityKind: 'ARC', label: 'Story Arcs', icon: 'git-branch', description: 'Arc folder' },
        { entityKind: 'ACT', label: 'Acts', icon: 'layers', description: 'Act folder' },
        { entityKind: 'CHAPTER', label: 'Chapters', icon: 'book', description: 'Chapter folder' },
        { entityKind: 'SCENE', label: 'Scenes', icon: 'film', description: 'Scene folder' },
    ],
    allowedNoteTypes: [
        { entityKind: 'NARRATIVE', label: 'Story Overview', icon: 'file-text' },
    ],
};

// =============================================================================
// CHARACTER FOLDER SCHEMA
// =============================================================================

export const CHARACTER_FOLDER_SCHEMA: FolderSchema = {
    id: 'CHARACTER',
    entityKind: 'CHARACTER',
    name: 'Characters',
    description: 'Character entities',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'users',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'CHARACTER', label: 'Character Subfolder', icon: 'users' },
        { entityKind: 'NPC', label: 'NPC Folder', icon: 'user' },
        { entityKind: 'FACTION', label: 'Faction', icon: 'shield', autoCreateNetwork: true, networkSchemaId: 'FACTION' },
    ],
    allowedNoteTypes: [
        { entityKind: 'CHARACTER', label: 'Character', icon: 'user' },
        { entityKind: 'NPC', label: 'NPC', icon: 'user-circle' },
    ],
};

// =============================================================================
// LOCATION FOLDER SCHEMA
// =============================================================================

export const LOCATION_FOLDER_SCHEMA: FolderSchema = {
    id: 'LOCATION',
    entityKind: 'LOCATION',
    name: 'Locations',
    description: 'Location entities',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'map-pin',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'LOCATION', label: 'Sub-location', icon: 'map-pin' },
    ],
    allowedNoteTypes: [
        { entityKind: 'LOCATION', label: 'Location', icon: 'map' },
    ],
};

// =============================================================================
// ARC FOLDER SCHEMA
// =============================================================================

export const ARC_FOLDER_SCHEMA: FolderSchema = {
    id: 'ARC',
    entityKind: 'ARC',
    name: 'Story Arcs',
    description: 'Major story arcs',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'git-branch',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'ACT', label: 'Act', icon: 'layers' },
        { entityKind: 'CHAPTER', label: 'Chapter', icon: 'book' },
    ],
    allowedNoteTypes: [
        { entityKind: 'ARC', label: 'Arc Overview', icon: 'file-text' },
    ],
};

// =============================================================================
// ACT FOLDER SCHEMA
// =============================================================================

export const ACT_FOLDER_SCHEMA: FolderSchema = {
    id: 'ACT',
    entityKind: 'ACT',
    name: 'Acts',
    description: 'Story acts',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'layers',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'CHAPTER', label: 'Chapter', icon: 'book' },
        { entityKind: 'SCENE', label: 'Scene', icon: 'film' },
    ],
    allowedNoteTypes: [
        { entityKind: 'ACT', label: 'Act Overview', icon: 'file-text' },
    ],
};

// =============================================================================
// CHAPTER FOLDER SCHEMA
// =============================================================================

export const CHAPTER_FOLDER_SCHEMA: FolderSchema = {
    id: 'CHAPTER',
    entityKind: 'CHAPTER',
    name: 'Chapters',
    description: 'Story chapters',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'book',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'SCENE', label: 'Scene', icon: 'film' },
        { entityKind: 'BEAT', label: 'Beat', icon: 'zap' },
    ],
    allowedNoteTypes: [
        { entityKind: 'CHAPTER', label: 'Chapter', icon: 'file-text' },
    ],
};

// =============================================================================
// SCENE FOLDER SCHEMA
// =============================================================================

export const SCENE_FOLDER_SCHEMA: FolderSchema = {
    id: 'SCENE',
    entityKind: 'SCENE',
    name: 'Scenes',
    description: 'Story scenes',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'film',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'BEAT', label: 'Beat', icon: 'zap' },
    ],
    allowedNoteTypes: [
        { entityKind: 'SCENE', label: 'Scene', icon: 'film' },
    ],
};

// =============================================================================
// BEAT FOLDER SCHEMA
// =============================================================================

export const BEAT_FOLDER_SCHEMA: FolderSchema = {
    id: 'BEAT',
    entityKind: 'BEAT',
    name: 'Beats',
    description: 'Story beats (smallest narrative unit)',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'zap',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [],
    allowedNoteTypes: [
        { entityKind: 'BEAT', label: 'Beat', icon: 'zap' },
    ],
};

// =============================================================================
// EVENT FOLDER SCHEMA
// =============================================================================

export const EVENT_FOLDER_SCHEMA: FolderSchema = {
    id: 'EVENT',
    entityKind: 'EVENT',
    name: 'Events',
    description: 'Story events',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'calendar',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'EVENT', label: 'Sub-event', icon: 'calendar' },
    ],
    allowedNoteTypes: [
        { entityKind: 'EVENT', label: 'Event', icon: 'calendar' },
    ],
};

// =============================================================================
// TIMELINE FOLDER SCHEMA
// =============================================================================

export const TIMELINE_FOLDER_SCHEMA: FolderSchema = {
    id: 'TIMELINE',
    entityKind: 'TIMELINE',
    name: 'Timelines',
    description: 'Story timelines',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: false,
    icon: 'clock',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'EVENT', label: 'Event', icon: 'calendar' },
    ],
    allowedNoteTypes: [
        { entityKind: 'TIMELINE', label: 'Timeline', icon: 'clock' },
    ],
};

// =============================================================================
// ITEM FOLDER SCHEMA
// =============================================================================

export const ITEM_FOLDER_SCHEMA: FolderSchema = {
    id: 'ITEM',
    entityKind: 'ITEM',
    name: 'Items',
    description: 'Item entities',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'package',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'ITEM', label: 'Item Subfolder', icon: 'package' },
    ],
    allowedNoteTypes: [
        { entityKind: 'ITEM', label: 'Item', icon: 'box' },
    ],
};

// =============================================================================
// CONCEPT FOLDER SCHEMA
// =============================================================================

export const CONCEPT_FOLDER_SCHEMA: FolderSchema = {
    id: 'CONCEPT',
    entityKind: 'CONCEPT',
    name: 'Concepts',
    description: 'World building concepts',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'lightbulb',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'CONCEPT', label: 'Concept Subfolder', icon: 'lightbulb' },
    ],
    allowedNoteTypes: [
        { entityKind: 'CONCEPT', label: 'Concept', icon: 'lightbulb' },
    ],
};

// =============================================================================
// FACTION FOLDER SCHEMA
// =============================================================================

export const FACTION_FOLDER_SCHEMA: FolderSchema = {
    id: 'FACTION',
    entityKind: 'FACTION',
    name: 'Factions',
    description: 'Faction/organization entities',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'shield',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [
        { entityKind: 'CHARACTER', label: 'Members', icon: 'users' },
        { entityKind: 'FACTION', label: 'Sub-faction', icon: 'shield' },
    ],
    allowedNoteTypes: [
        { entityKind: 'FACTION', label: 'Faction', icon: 'shield' },
        { entityKind: 'CHARACTER', label: 'Member', icon: 'user' },
    ],
};

// =============================================================================
// NPC FOLDER SCHEMA
// =============================================================================

export const NPC_FOLDER_SCHEMA: FolderSchema = {
    id: 'NPC',
    entityKind: 'NPC',
    name: 'NPCs',
    description: 'Non-player characters',
    isVaultRoot: false,
    containerOnly: false,
    propagateKindToChildren: true,
    icon: 'user',
    isSystem: true,
    createdAt: now,
    updatedAt: now,
    allowedSubfolders: [],
    allowedNoteTypes: [
        { entityKind: 'NPC', label: 'NPC', icon: 'user' },
    ],
};

// =============================================================================
// ALL DEFAULT FOLDER SCHEMAS
// =============================================================================

export const DEFAULT_FOLDER_SCHEMAS: FolderSchema[] = [
    NARRATIVE_FOLDER_SCHEMA,
    CHARACTER_FOLDER_SCHEMA,
    LOCATION_FOLDER_SCHEMA,
    ARC_FOLDER_SCHEMA,
    ACT_FOLDER_SCHEMA,
    CHAPTER_FOLDER_SCHEMA,
    SCENE_FOLDER_SCHEMA,
    BEAT_FOLDER_SCHEMA,
    EVENT_FOLDER_SCHEMA,
    TIMELINE_FOLDER_SCHEMA,
    ITEM_FOLDER_SCHEMA,
    CONCEPT_FOLDER_SCHEMA,
    FACTION_FOLDER_SCHEMA,
    NPC_FOLDER_SCHEMA,
];
