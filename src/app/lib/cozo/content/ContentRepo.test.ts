import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock cozo-lib-wasm package entirely
vi.mock('cozo-lib-wasm', () => ({
    default: vi.fn().mockResolvedValue(undefined),
    CozoDb: {
        new: vi.fn(() => ({
            run: vi.fn(() => '{"rows": []}'),
            export_relations: vi.fn(() => '{}'),
            import_relations: vi.fn(() => '{}'),
        })),
    },
}));

// Create a mock store that persists across tests
const mockStore: Record<string, any[]> = {
    notes: [],
    folders: [],
    tags: [],
    note_tags: [],
};

// Reset store between tests
function resetMockStore() {
    mockStore.notes = [];
    mockStore.folders = [];
    mockStore.tags = [];
    mockStore.note_tags = [];
}

// Mock the cozoDb module
vi.mock('../db', () => ({
    cozoDb: {
        run: vi.fn((script: string) => '{}'),
        runQuery: vi.fn((script: string, params: Record<string, any>) => {
            // Mock queries based on script content
            if (script.includes('*notes')) {
                const id = params?.id;
                if (id) {
                    const note = mockStore.notes.find(n => n[0] === id);
                    return { rows: note ? [note] : [] };
                }
                return { rows: mockStore.notes };
            }
            if (script.includes('*folders')) {
                const id = params?.id;
                if (id) {
                    const folder = mockStore.folders.find(f => f[0] === id);
                    return { rows: folder ? [folder] : [] };
                }
                return { rows: mockStore.folders };
            }
            if (script.includes('*tags')) {
                const id = params?.id;
                if (id) {
                    const tag = mockStore.tags.find(t => t[0] === id);
                    return { rows: tag ? [tag] : [] };
                }
                return { rows: mockStore.tags };
            }
            return { rows: [] };
        }),
        runMutation: vi.fn((script: string, params: Record<string, any>) => {
            // Mock mutations
            if (script.includes(':put notes')) {
                const row = [
                    params.id,
                    params.world_id,
                    params.title,
                    params.content,
                    params.markdown_content,
                    params.folder_id,
                    params.entity_kind,
                    params.entity_subtype,
                    params.is_entity ?? false,
                    params.is_pinned ?? false,
                    params.favorite ?? false,
                    params.owner_id,
                    params.now ?? params.created_at ?? Date.now(),
                    params.updated_at ?? params.now ?? Date.now(),
                ];
                const idx = mockStore.notes.findIndex(n => n[0] === params.id);
                if (idx >= 0) {
                    mockStore.notes[idx] = row;
                } else {
                    mockStore.notes.push(row);
                }
                return { rows: [] };
            }
            if (script.includes(':rm notes')) {
                mockStore.notes = mockStore.notes.filter(n => n[0] !== params.id);
                return { rows: [] };
            }
            if (script.includes(':put folders')) {
                const row = [
                    params.id,
                    params.world_id,
                    params.name,
                    params.parent_id,
                    params.entity_kind,
                    params.entity_subtype,
                    params.entity_label,
                    params.color,
                    params.is_typed_root ?? false,
                    params.is_subtype_root ?? false,
                    params.collapsed ?? false,
                    params.owner_id,
                    params.now ?? params.created_at ?? Date.now(),
                    params.updated_at ?? params.now ?? Date.now(),
                ];
                const idx = mockStore.folders.findIndex(f => f[0] === params.id);
                if (idx >= 0) {
                    mockStore.folders[idx] = row;
                } else {
                    mockStore.folders.push(row);
                }
                return { rows: [] };
            }
            if (script.includes(':rm folders')) {
                mockStore.folders = mockStore.folders.filter(f => f[0] !== params.id);
                return { rows: [] };
            }
            if (script.includes(':put tags')) {
                const row = [params.id, params.world_id, params.name, params.color, params.owner_id];
                const idx = mockStore.tags.findIndex(t => t[0] === params.id);
                if (idx >= 0) {
                    mockStore.tags[idx] = row;
                } else {
                    mockStore.tags.push(row);
                }
                return { rows: [] };
            }
            if (script.includes(':rm tags')) {
                mockStore.tags = mockStore.tags.filter(t => t[0] !== params.id);
                return { rows: [] };
            }
            return { rows: [] };
        }),
    },
}));
// Mock FtsService
vi.mock('../fts/FtsService', () => ({
    ftsService: {
        initialize: vi.fn(),
        searchNotes: vi.fn(({ query }) => {
            const lowerQuery = query.toLowerCase();
            return mockStore.notes
                .map(row => ({
                    id: row[0],
                    title: row[2],
                    content: row[3],
                    markdownContent: row[4],
                }))
                .filter(n => n.title.toLowerCase().includes(lowerQuery))
                .map(n => ({
                    id: n.id,
                    title: n.title,
                    score: 1.0
                }));
        }),
    }
}));

// Import AFTER mock is set up
import { NoteRepo, FolderRepo, TagRepo } from './ContentRepo';

describe('ContentRepo', () => {
    beforeEach(() => {
        resetMockStore();
    });

    describe('NoteRepo', () => {
        it('should create a note', () => {
            const note = NoteRepo.create({
                worldId: 'default',
                title: 'Test Note',
                content: '# Test Content',
                markdownContent: '# Test Content',
            });

            expect(note.id).toBeDefined();
            expect(note.title).toBe('Test Note');
            expect(note.content).toBe('# Test Content');
            expect(note.worldId).toBe('default');
        });

        it('should get a note by ID', () => {
            const created = NoteRepo.create({
                worldId: 'default',
                title: 'Get Test Note',
            });

            const retrieved = NoteRepo.get(created.id);
            expect(retrieved).toBeDefined();
            expect(retrieved?.title).toBe('Get Test Note');
        });

        it('should list all notes', () => {
            NoteRepo.create({ worldId: 'default', title: 'Note 1' });
            NoteRepo.create({ worldId: 'default', title: 'Note 2' });

            const notes = NoteRepo.listAll('default');
            expect(notes.length).toBe(2);
        });

        it('should update a note', () => {
            const note = NoteRepo.create({
                worldId: 'default',
                title: 'Original Title',
            });

            const updated = NoteRepo.update(note.id, {
                title: 'Updated Title',
            });

            expect(updated?.title).toBe('Updated Title');
        });

        it('should delete a note', () => {
            const note = NoteRepo.create({
                worldId: 'default',
                title: 'To Delete',
            });

            const deleted = NoteRepo.delete(note.id);
            expect(deleted).toBe(true);
            expect(NoteRepo.get(note.id)).toBeNull();
        });

        it('should search notes by title', () => {
            NoteRepo.create({ worldId: 'default', title: 'Alice in Wonderland' });
            NoteRepo.create({ worldId: 'default', title: 'Bob the Builder' });

            const results = NoteRepo.search('alice', 'default');
            expect(results.length).toBe(1);
            expect(results[0].title).toBe('Alice in Wonderland');
        });
    });

    describe('FolderRepo', () => {
        it('should create a folder', () => {
            const folder = FolderRepo.create({
                worldId: 'default',
                name: 'Test Folder',
            });

            expect(folder.id).toBeDefined();
            expect(folder.name).toBe('Test Folder');
        });

        it('should create nested folders', () => {
            const parent = FolderRepo.create({
                worldId: 'default',
                name: 'Parent Folder',
            });

            const child = FolderRepo.create({
                worldId: 'default',
                name: 'Child Folder',
                parentId: parent.id,
            });

            expect(child.parentId).toBe(parent.id);
        });

        it('should list all folders', () => {
            FolderRepo.create({ worldId: 'default', name: 'Folder A' });
            FolderRepo.create({ worldId: 'default', name: 'Folder B' });

            const folders = FolderRepo.listAll('default');
            expect(folders.length).toBe(2);
        });

        it('should get folder tree', () => {
            const tree = FolderRepo.getTree('default');
            expect(Array.isArray(tree)).toBe(true);
        });
    });

    describe('TagRepo', () => {
        it('should create a tag', () => {
            const tag = TagRepo.create({
                worldId: 'default',
                name: 'Test Tag',
                color: '#ff0000',
            });

            expect(tag.id).toBeDefined();
            expect(tag.name).toBe('Test Tag');
            expect(tag.color).toBe('#ff0000');
        });

        it('should list all tags', () => {
            TagRepo.create({ worldId: 'default', name: 'Tag 1' });
            TagRepo.create({ worldId: 'default', name: 'Tag 2' });

            const tags = TagRepo.listAll('default');
            expect(tags.length).toBe(2);
        });

        it('should delete a tag', () => {
            const tag = TagRepo.create({ worldId: 'default', name: 'To Delete' });
            const deleted = TagRepo.delete(tag.id);
            expect(deleted).toBe(true);
        });
    });
});
