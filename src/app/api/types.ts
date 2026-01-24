// src/api/types.ts
// TypeScript types matching Rust content_types.rs
// These are the canonical types for frontend ↔ backend communication

// =============================================================================
// NOTE
// =============================================================================

export interface Note {
    id: string;
    worldId?: string;
    title: string;
    content?: string;
    markdownContent?: string;
    folderId?: string | null;
    parent_id?: string | null;
    entityKind?: string;
    entitySubtype?: string;
    isEntity?: boolean | number;
    isPinned?: boolean | number;
    favorite?: boolean | number;
    createdAt?: number | Date;
    updatedAt?: number | Date;
    updated_at?: number;
    tags?: string[];
    ownerId?: string;
}

export interface NoteCreateParams {
    worldId: string;
    title: string;
    content?: string;
    folderId?: string;
    entityKind?: string;
    entitySubtype?: string;
    isEntity?: boolean;
}

export interface NoteUpdateParams {
    worldId: string;
    id: string;
    title?: string;
    content?: string;
    markdownContent?: string;
    folderId?: string;
    entityKind?: string;
    entitySubtype?: string;
    isEntity?: boolean;
    isPinned?: boolean;
    favorite?: boolean;
}

// =============================================================================
// FOLDER
// =============================================================================

export interface Folder {
    id: string;
    worldId: string;
    name: string;
    parentId?: string;
    entityKind?: string;
    entitySubtype?: string;
    color?: string;
    isTypedRoot: boolean;
    networkId?: string;
    collapsed: boolean;
    fantasyYear?: number;
    fantasyMonth?: number;
    fantasyDay?: number;
    createdAt: number;
    updatedAt: number;
}

export interface FolderTreeNode {
    folder: Folder;
    children: FolderTreeNode[];
    notes: NoteSummary[];
}

export interface NoteSummary {
    id: string;
    title: string;
    isPinned: boolean;
    favorite: boolean;
    entityKind?: string;
    updatedAt: number;
}

// =============================================================================
// ENTITY
// =============================================================================

export interface Entity {
    id: string;
    worldId: string;
    label: string;
    entityKind: string;
    entitySubtype?: string;
    noteId?: string;
    folderId?: string;
    isActive: boolean;
    aliases: string[];
    attributes: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
}

// =============================================================================
// SAVE STATUS (UI state)
// =============================================================================

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

// =============================================================================
// API INTERFACES
// =============================================================================

export interface EditorApi {
    getNote(worldId: string, noteId: string): Promise<Note | null>;
    createNote(params: NoteCreateParams): Promise<Note>;
    updateNote(params: NoteUpdateParams): Promise<Note>;
    deleteNote(worldId: string, noteId: string): Promise<boolean>;
    listNotes(worldId: string): Promise<Note[]>;
    searchNotes(worldId: string, query: string): Promise<Note[]>;
}

