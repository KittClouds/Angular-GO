/**
 * Content Repository - CozoDB CRUD operations for notes, folders, tags
 * 
 * Mirrors native Rust content_repos.rs pattern.
 * Single source of truth for all content operations.
 */

import { cozoDb } from '../db';
import { ftsService } from '../fts/FtsService';
import { createContentSchemas } from './ContentSchema';
import type {
    Note, NoteInput, NoteUpdate, NoteSummary,
    Folder, FolderInput, FolderUpdate, FolderTreeNode,
    Tag, TagInput,
    DEFAULT_WORLD_ID, DEFAULT_OWNER_ID, DEFAULT_NOTE_CONTENT
} from './ContentTypes';

// Re-export types
export * from './ContentTypes';

// =============================================================================
// HELPERS
// =============================================================================

function now(): number {
    return Date.now();
}

function generateId(): string {
    return crypto.randomUUID();
}

function emptyToNull(s: string | null | undefined): string | null {
    if (!s || s === '') return null;
    return s;
}

function nullToEmpty(s: string | null | undefined): string {
    return s ?? '';
}

// =============================================================================
// NOTE REPOSITORY
// =============================================================================

export class NoteRepo {
    /**
     * Create a new note
     */
    static create(input: NoteInput): Note {
        const id = generateId();
        const timestamp = now();
        const content = input.content ?? '';
        const markdownContent = input.markdownContent ?? content;

        const script = `
            ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
              is_entity, is_pinned, favorite, owner_id, created_at, updated_at] <- [[
                $id, $world_id, $title, $content, $markdown_content, $folder_id, $entity_kind, $entity_subtype,
                $is_entity, false, false, $owner_id, $now, $now
            ]]
            :put notes {
                id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
                is_entity, is_pinned, favorite, owner_id, created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: input.worldId,
            title: input.title,
            content,
            markdown_content: markdownContent,
            folder_id: nullToEmpty(input.folderId),
            entity_kind: nullToEmpty(input.entityKind),
            entity_subtype: nullToEmpty(input.entitySubtype),
            is_entity: input.isEntity ?? false,
            owner_id: 'local-user',
            now: timestamp
        });

        const created = this.get(id);
        if (!created) throw new Error(`Note created but not found: ${id}`);
        return created;
    }

    /**
     * Get a note by ID
     */
    static get(id: string): Note | null {
        const script = `
            ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
              is_entity, is_pinned, favorite, owner_id, created_at, updated_at] :=
                *notes{id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
                       is_entity, is_pinned, favorite, owner_id, created_at, updated_at},
                id == $id
        `;

        const result = cozoDb.runQuery(script, { id });
        if (!result.rows?.length) return null;

        return this.rowToNote(result.rows[0]);
    }

    /**
     * List all notes (optionally filtered by world)
     */
    static listAll(worldId: string = 'default'): Note[] {
        const script = `
            ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
              is_entity, is_pinned, favorite, owner_id, created_at, updated_at] :=
                *notes{id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
                       is_entity, is_pinned, favorite, owner_id, created_at, updated_at},
                world_id == $world_id
            :order -updated_at
        `;

        const result = cozoDb.runQuery(script, { world_id: worldId });
        return (result.rows || []).map((row: any[]) => this.rowToNote(row));
    }

    /**
     * List notes in a specific folder
     */
    static listByFolder(folderId: string | null): Note[] {
        const targetFolderId = folderId ?? '';
        const script = `
            ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
              is_entity, is_pinned, favorite, owner_id, created_at, updated_at] :=
                *notes{id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
                       is_entity, is_pinned, favorite, owner_id, created_at, updated_at},
                folder_id == $folder_id
            :order -updated_at
        `;

        const result = cozoDb.runQuery(script, { folder_id: targetFolderId });
        return (result.rows || []).map((row: any[]) => this.rowToNote(row));
    }

    /**
     * Update a note
     */
    static update(id: string, updates: NoteUpdate): Note | null {
        const existing = this.get(id);
        if (!existing) return null;

        const script = `
            ?[id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
              is_entity, is_pinned, favorite, owner_id, created_at, updated_at] <- [[
                $id, $world_id, $title, $content, $markdown_content, $folder_id, $entity_kind, $entity_subtype,
                $is_entity, $is_pinned, $favorite, $owner_id, $created_at, $updated_at
            ]]
            :put notes {
                id, world_id, title, content, markdown_content, folder_id, entity_kind, entity_subtype,
                is_entity, is_pinned, favorite, owner_id, created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: existing.worldId,
            title: updates.title ?? existing.title,
            content: updates.content ?? existing.content,
            markdown_content: updates.markdownContent ?? existing.markdownContent,
            folder_id: updates.folderId !== undefined ? nullToEmpty(updates.folderId) : nullToEmpty(existing.folderId),
            entity_kind: updates.entityKind !== undefined ? nullToEmpty(updates.entityKind) : nullToEmpty(existing.entityKind),
            entity_subtype: updates.entitySubtype !== undefined ? nullToEmpty(updates.entitySubtype) : nullToEmpty(existing.entitySubtype),
            is_entity: updates.isEntity ?? existing.isEntity,
            is_pinned: updates.isPinned ?? existing.isPinned,
            favorite: updates.favorite ?? existing.favorite,
            owner_id: existing.ownerId,
            created_at: existing.createdAt.getTime(),
            updated_at: now()
        });

        return this.get(id);
    }

    /**
     * Delete a note
     */
    static delete(id: string): boolean {
        // Also delete note_tags associations
        cozoDb.runMutation(`?[note_id, tag_id] := *note_tags{note_id, tag_id}, note_id == $id :rm note_tags {note_id, tag_id}`, { id });
        cozoDb.runMutation(`?[id] <- [[$id]] :rm notes {id}`, { id });
        return this.get(id) === null;
    }

    /**
     * Search notes by title or content using FTS
     */
    static search(query: string, worldId: string = 'default'): Note[] {
        // Use FTS service (limit 100 to allow for world filtering)
        const matches = ftsService.searchNotes({ query, limit: 100 });

        if (matches.length === 0) return [];

        // Fetch full notes and filter by worldId
        return matches
            .map(m => this.get(m.id))
            .filter((n): n is Note => n !== null && n.worldId === worldId);
    }

    /**
     * Find note by title (for wikilink resolution)
     */
    static findByTitle(title: string, worldId: string = 'default'): Note | null {
        const lowerTitle = title.toLowerCase();
        const all = this.listAll(worldId);

        // Exact match first
        const exact = all.find(n => n.title.toLowerCase() === lowerTitle);
        if (exact) return exact;

        // Partial match
        const partial = all.find(n => n.title.toLowerCase().includes(lowerTitle));
        return partial ?? null;
    }

    private static rowToNote(row: any[]): Note {
        return {
            id: row[0],
            worldId: row[1],
            title: row[2],
            content: row[3],
            markdownContent: row[4],
            folderId: emptyToNull(row[5]),
            entityKind: emptyToNull(row[6]),
            entitySubtype: emptyToNull(row[7]),
            isEntity: row[8],
            isPinned: row[9],
            favorite: row[10],
            ownerId: row[11],
            createdAt: new Date(row[12]),
            updatedAt: new Date(row[13]),
        };
    }
}

// =============================================================================
// FOLDER REPOSITORY
// =============================================================================

export class FolderRepo {
    /**
     * Create a new folder
     */
    static create(input: FolderInput): Folder {
        const id = generateId();
        const timestamp = now();

        const script = `
            ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
              is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at] <- [[
                $id, $world_id, $name, $parent_id, $entity_kind, $entity_subtype, $entity_label, $color,
                $is_typed_root, $is_subtype_root, false, $owner_id, $now, $now
            ]]
            :put folders {
                id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
                is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: input.worldId,
            name: input.name,
            parent_id: nullToEmpty(input.parentId),
            entity_kind: nullToEmpty(input.entityKind),
            entity_subtype: nullToEmpty(input.entitySubtype),
            entity_label: nullToEmpty(input.entityLabel),
            color: nullToEmpty(input.color),
            is_typed_root: input.isTypedRoot ?? false,
            is_subtype_root: input.isSubtypeRoot ?? false,
            owner_id: 'local-user',
            now: timestamp
        });

        const created = this.get(id);
        if (!created) throw new Error(`Folder created but not found: ${id}`);
        return created;
    }

    /**
     * Get a folder by ID
     */
    static get(id: string): Folder | null {
        const script = `
            ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
              is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at] :=
                *folders{id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
                         is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at},
                id == $id
        `;

        const result = cozoDb.runQuery(script, { id });
        if (!result.rows?.length) return null;

        return this.rowToFolder(result.rows[0]);
    }

    /**
     * List all folders
     */
    static listAll(worldId: string = 'default'): Folder[] {
        const script = `
            ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
              is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at] :=
                *folders{id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
                         is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at},
                world_id == $world_id
            :order name
        `;

        const result = cozoDb.runQuery(script, { world_id: worldId });
        return (result.rows || []).map((row: any[]) => this.rowToFolder(row));
    }

    /**
     * Update a folder
     */
    static update(id: string, updates: FolderUpdate): Folder | null {
        const existing = this.get(id);
        if (!existing) return null;

        const script = `
            ?[id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
              is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at] <- [[
                $id, $world_id, $name, $parent_id, $entity_kind, $entity_subtype, $entity_label, $color,
                $is_typed_root, $is_subtype_root, $collapsed, $owner_id, $created_at, $updated_at
            ]]
            :put folders {
                id, world_id, name, parent_id, entity_kind, entity_subtype, entity_label, color,
                is_typed_root, is_subtype_root, collapsed, owner_id, created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: existing.worldId,
            name: updates.name ?? existing.name,
            parent_id: updates.parentId !== undefined ? nullToEmpty(updates.parentId) : nullToEmpty(existing.parentId),
            entity_kind: updates.entityKind !== undefined ? nullToEmpty(updates.entityKind) : nullToEmpty(existing.entityKind),
            entity_subtype: updates.entitySubtype !== undefined ? nullToEmpty(updates.entitySubtype) : nullToEmpty(existing.entitySubtype),
            entity_label: updates.entityLabel !== undefined ? nullToEmpty(updates.entityLabel) : nullToEmpty(existing.entityLabel),
            color: updates.color !== undefined ? nullToEmpty(updates.color) : nullToEmpty(existing.color),
            is_typed_root: existing.isTypedRoot,
            is_subtype_root: existing.isSubtypeRoot,
            collapsed: updates.collapsed ?? existing.collapsed,
            owner_id: existing.ownerId,
            created_at: existing.createdAt.getTime(),
            updated_at: now()
        });

        return this.get(id);
    }

    /**
     * Delete a folder
     */
    static delete(id: string): boolean {
        cozoDb.runMutation(`?[id] <- [[$id]] :rm folders {id}`, { id });
        return this.get(id) === null;
    }

    /**
     * Get folder tree (recursive structure)
     */
    static getTree(worldId: string = 'default'): FolderTreeNode[] {
        const folders = this.listAll(worldId);
        const notes = NoteRepo.listAll(worldId);

        // Index by ID
        const folderMap = new Map<string, Folder>();
        const childrenMap = new Map<string | null, string[]>();

        for (const folder of folders) {
            folderMap.set(folder.id, folder);
            const parentKey = folder.parentId;
            if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
            childrenMap.get(parentKey)!.push(folder.id);
        }

        // Index notes by folder
        const notesByFolder = new Map<string, NoteSummary[]>();
        for (const note of notes) {
            const folderId = note.folderId ?? '';
            if (!notesByFolder.has(folderId)) notesByFolder.set(folderId, []);
            notesByFolder.get(folderId)!.push({
                id: note.id,
                title: note.title,
                isPinned: note.isPinned,
                favorite: note.favorite,
                entityKind: note.entityKind,
                updatedAt: note.updatedAt,
            });
        }

        // Build tree recursively
        const buildNode = (folderId: string): FolderTreeNode | null => {
            const folder = folderMap.get(folderId);
            if (!folder) return null;

            const childIds = childrenMap.get(folderId) || [];
            const children = childIds
                .map(id => buildNode(id))
                .filter((n): n is FolderTreeNode => n !== null);

            const folderNotes = notesByFolder.get(folderId) || [];

            return { folder, children, notes: folderNotes };
        };

        // Find roots (no parent)
        const rootIds = childrenMap.get(null) || [];
        return rootIds
            .map(id => buildNode(id))
            .filter((n): n is FolderTreeNode => n !== null);
    }

    private static rowToFolder(row: any[]): Folder {
        return {
            id: row[0],
            worldId: row[1],
            name: row[2],
            parentId: emptyToNull(row[3]),
            entityKind: emptyToNull(row[4]),
            entitySubtype: emptyToNull(row[5]),
            entityLabel: emptyToNull(row[6]),
            color: emptyToNull(row[7]),
            isTypedRoot: row[8],
            isSubtypeRoot: row[9],
            collapsed: row[10],
            ownerId: row[11],
            createdAt: new Date(row[12]),
            updatedAt: new Date(row[13]),
            narrativeId: '',
            isNarrativeRoot: false,
        };
    }
}

// =============================================================================
// TAG REPOSITORY
// =============================================================================

export class TagRepo {
    /**
     * Create a new tag
     */
    static create(input: TagInput): Tag {
        const id = generateId();

        const script = `
            ?[id, world_id, name, color, owner_id] <- [[
                $id, $world_id, $name, $color, $owner_id
            ]]
            :put tags {id, world_id, name, color, owner_id}
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: input.worldId,
            name: input.name,
            color: input.color ?? '#3b82f6',
            owner_id: 'local-user'
        });

        return this.get(id)!;
    }

    /**
     * Get a tag by ID
     */
    static get(id: string): Tag | null {
        const script = `?[id, world_id, name, color, owner_id] := *tags{id, world_id, name, color, owner_id}, id == $id`;
        const result = cozoDb.runQuery(script, { id });
        if (!result.rows?.length) return null;

        const row = result.rows[0];
        return { id: row[0], worldId: row[1], name: row[2], color: row[3], ownerId: row[4] };
    }

    /**
     * List all tags
     */
    static listAll(worldId: string = 'default'): Tag[] {
        const script = `?[id, world_id, name, color, owner_id] := *tags{id, world_id, name, color, owner_id}, world_id == $world_id :order name`;
        const result = cozoDb.runQuery(script, { world_id: worldId });
        return (result.rows || []).map((row: any[]) => ({
            id: row[0], worldId: row[1], name: row[2], color: row[3], ownerId: row[4]
        }));
    }

    /**
     * Delete a tag
     */
    static delete(id: string): boolean {
        // Remove from note_tags first
        cozoDb.runMutation(`?[note_id, tag_id] := *note_tags{note_id, tag_id}, tag_id == $id :rm note_tags {note_id, tag_id}`, { id });
        cozoDb.runMutation(`?[id] <- [[$id]] :rm tags {id}`, { id });
        return true;
    }

    /**
     * Add tag to note
     */
    static addToNote(noteId: string, tagId: string): void {
        cozoDb.runMutation(`?[note_id, tag_id] <- [[$note_id, $tag_id]] :put note_tags {note_id, tag_id}`, {
            note_id: noteId,
            tag_id: tagId
        });
    }

    /**
     * Remove tag from note
     */
    static removeFromNote(noteId: string, tagId: string): void {
        cozoDb.runMutation(`?[note_id, tag_id] <- [[$note_id, $tag_id]] :rm note_tags {note_id, tag_id}`, {
            note_id: noteId,
            tag_id: tagId
        });
    }

    /**
     * Get tags for a note
     */
    static getForNote(noteId: string): Tag[] {
        const script = `
            ?[id, world_id, name, color, owner_id] :=
                *note_tags{note_id, tag_id},
                note_id == $note_id,
                *tags{id: tag_id, world_id, name, color, owner_id}
        `;
        const result = cozoDb.runQuery(script, { note_id: noteId });
        return (result.rows || []).map((row: any[]) => ({
            id: row[0], worldId: row[1], name: row[2], color: row[3], ownerId: row[4]
        }));
    }
}

// =============================================================================
// CONTENT REPO INITIALIZATION
// =============================================================================

let contentInitialized = false;

/**
 * Initialize content repository (creates schemas)
 * Should be called after cozoDb.init()
 */
export function initContentRepo(): void {
    if (contentInitialized) return;

    const created = createContentSchemas((script) => {
        try {
            cozoDb.run(script);
        } catch (err: any) {
            if (!err.message?.includes('already exists')) throw err;
        }
    });

    console.log(`[ContentRepo] ✅ Initialized (${created.length} schemas)`);

    // Initialize FTS indexes
    ftsService.initialize();

    contentInitialized = true;
}

/**
 * Check if content repo is initialized
 */
export function isContentRepoInitialized(): boolean {
    return contentInitialized;
}
