// Package store provides SQLite-backed persistence for GoKitt.
// Uses ncruces/go-sqlite3/driver which provides a database/sql interface.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	_ "github.com/asg017/sqlite-vec-go-bindings/ncruces"
	_ "github.com/ncruces/go-sqlite3/driver"
)

// SQLiteStore is the SQLite-backed data store.
// Thread-safe for concurrent WASM callbacks.
type SQLiteStore struct {
	mu sync.RWMutex
	db *sql.DB
}

// schema defines all tables for the unified data layer with temporal versioning.
const schema = `
-- Notes (Temporal versioning pattern)
-- Composite primary key (id, version) enables full version history
CREATE TABLE IF NOT EXISTS notes (
    id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    world_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    markdown_content TEXT,
    folder_id TEXT,
    entity_kind TEXT,
    entity_subtype TEXT,
    is_entity INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    favorite INTEGER DEFAULT 0,
    owner_id TEXT,
    narrative_id TEXT,
    "order" REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    valid_from INTEGER NOT NULL,
    valid_to INTEGER,
    is_current INTEGER DEFAULT 1,
    change_reason TEXT,
    PRIMARY KEY (id, version)
);

-- Partial indexes for current versions (fast queries)
CREATE INDEX IF NOT EXISTS idx_notes_current ON notes(id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_notes_narrative ON notes(narrative_id) WHERE is_current = 1;
-- Index for history queries
CREATE INDEX IF NOT EXISTS idx_notes_history ON notes(id, valid_from);

-- Entities (Registry)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    subtype TEXT,
    aliases TEXT,
    first_note TEXT,
    total_mentions INTEGER DEFAULT 0,
    narrative_id TEXT,
    created_by TEXT DEFAULT 'user',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_label ON entities(label);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);

-- Edges (Graph)
-- Note: No foreign keys - referential integrity managed at application level
CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rel_type TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    bidirectional INTEGER DEFAULT 0,
    source_note TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

-- Folders (Document hierarchy)
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    world_id TEXT NOT NULL,
    narrative_id TEXT,
    folder_order REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_world ON folders(world_id);

-- =============================================================================
-- Observational Memory Tables (Phase B)
-- =============================================================================

-- Threads: LLM conversation threads
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    world_id TEXT,
    narrative_id TEXT,
    title TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_world ON threads(world_id);
CREATE INDEX IF NOT EXISTS idx_threads_narrative ON threads(narrative_id);

-- ThreadMessages: Conversation history
CREATE TABLE IF NOT EXISTS thread_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    narrative_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    is_streaming INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_messages_narrative ON thread_messages(narrative_id);

-- Memories: Extracted observations
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    source_role TEXT,
    entity_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_entity ON memories(entity_id);

-- MemoryThreads: Many-to-many junction table
CREATE TABLE IF NOT EXISTS memory_threads (
    memory_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (memory_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_threads_thread ON memory_threads(thread_id);
CREATE INDEX IF NOT EXISTS idx_memory_threads_message ON memory_threads(message_id);

-- =============================================================================
-- Observational Memory Tables (Phase 8) — Three-agent pipeline
-- =============================================================================

-- OMRecords: Per-thread observation state for Observer → Reflector → Actor pipeline
CREATE TABLE IF NOT EXISTS om_records (
    thread_id TEXT PRIMARY KEY,
    observations TEXT NOT NULL DEFAULT '',
    current_task TEXT NOT NULL DEFAULT '',
    last_observed_at INTEGER NOT NULL DEFAULT 0,
    obs_token_count INTEGER NOT NULL DEFAULT 0,
    generation_num INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- OMGenerations: Reflection compression history
CREATE TABLE IF NOT EXISTS om_generations (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    input_text TEXT NOT NULL,
    output_text TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_om_gen_thread ON om_generations(thread_id, generation);

-- =============================================================================
-- RLM Workspace Artifacts
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspace_artifacts (
    key TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    narrative_id TEXT NOT NULL DEFAULT '',
    folder_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    pinned INTEGER NOT NULL DEFAULT 0,
    produced_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key, thread_id, narrative_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_ws_scope
    ON workspace_artifacts(thread_id, narrative_id, folder_id);
`

// NewSQLiteStore creates a new in-memory SQLite store.
func NewSQLiteStore() (*SQLiteStore, error) {
	return NewSQLiteStoreWithDSN(":memory:")
}

// NewSQLiteStoreWithDSN creates a store with a specific data source name.
// Use ":memory:" for in-memory or a file path for persistent storage.
func NewSQLiteStoreWithDSN(dsn string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Create schema
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	return &SQLiteStore{db: db}, nil
}

// Close closes the database connection.
func (s *SQLiteStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// =============================================================================
// Note CRUD
// =============================================================================

// CreateNote creates a new note with version 1.
func (s *SQLiteStore) CreateNote(note *Note) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Set version defaults
	if note.Version == 0 {
		note.Version = 1
	}
	if note.ValidFrom == 0 {
		note.ValidFrom = note.CreatedAt
	}
	note.IsCurrent = true

	_, err := s.db.Exec(`
		INSERT INTO notes (id, version, world_id, title, content, markdown_content, folder_id, 
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, 
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, note.ID, note.Version, note.WorldID, note.Title, note.Content, note.MarkdownContent,
		note.FolderID, note.EntityKind, note.EntitySubtype,
		boolToInt(note.IsEntity), boolToInt(note.IsPinned), boolToInt(note.Favorite),
		note.OwnerID, note.NarrativeID, note.Order, note.CreatedAt, note.UpdatedAt,
		note.ValidFrom, note.ValidTo, boolToInt(note.IsCurrent), note.ChangeReason)

	return err
}

// UpdateNote creates a new version of an existing note.
func (s *SQLiteStore) UpdateNote(note *Note, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get current version info
	var currentVersion int
	var createdAt int64
	err := s.db.QueryRow(`
		SELECT version, created_at FROM notes 
		WHERE id = ? AND is_current = 1
	`, note.ID).Scan(&currentVersion, &createdAt)
	if err == sql.ErrNoRows {
		// Note doesn't exist, fall back to create
		s.mu.Unlock()
		return s.CreateNote(note)
	}
	if err != nil {
		return err
	}

	// Close old current version
	_, err = s.db.Exec(`
		UPDATE notes SET valid_to = ?, is_current = 0 
		WHERE id = ? AND is_current = 1
	`, note.UpdatedAt, note.ID)
	if err != nil {
		return err
	}

	// Insert new version
	newVersion := currentVersion + 1
	note.Version = newVersion
	note.CreatedAt = createdAt // Preserve original creation time
	note.ValidFrom = note.UpdatedAt
	note.ValidTo = nil
	note.IsCurrent = true
	note.ChangeReason = reason

	_, err = s.db.Exec(`
		INSERT INTO notes (id, version, world_id, title, content, markdown_content, folder_id, 
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, 
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, note.ID, note.Version, note.WorldID, note.Title, note.Content, note.MarkdownContent,
		note.FolderID, note.EntityKind, note.EntitySubtype,
		boolToInt(note.IsEntity), boolToInt(note.IsPinned), boolToInt(note.Favorite),
		note.OwnerID, note.NarrativeID, note.Order, note.CreatedAt, note.UpdatedAt,
		note.ValidFrom, note.ValidTo, boolToInt(note.IsCurrent), note.ChangeReason)

	return err
}

// UpsertNote is a convenience method that creates or updates.
func (s *SQLiteStore) UpsertNote(note *Note) error {
	s.mu.RLock()
	var exists int
	err := s.db.QueryRow(`SELECT 1 FROM notes WHERE id = ? AND is_current = 1 LIMIT 1`, note.ID).Scan(&exists)
	s.mu.RUnlock()

	if err == sql.ErrNoRows {
		return s.CreateNote(note)
	}
	if err != nil {
		return err
	}
	return s.UpdateNote(note, "upsert")
}

// GetNote retrieves the current version of a note by ID.
func (s *SQLiteStore) GetNote(id string) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var note Note
	var isEntity, isPinned, favorite, isCurrent int
	var validTo sql.NullInt64
	var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes WHERE id = ? AND is_current = 1
	`, id).Scan(
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &markdownContent,
		&folderID, &entityKind, &entitySubtype,
		&isEntity, &isPinned, &favorite,
		&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &changeReason,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	note.IsEntity = isEntity != 0
	note.IsPinned = isPinned != 0
	note.Favorite = favorite != 0
	note.IsCurrent = isCurrent != 0
	if validTo.Valid {
		note.ValidTo = &validTo.Int64
	}
	if markdownContent.Valid {
		note.MarkdownContent = markdownContent.String
	}
	if folderID.Valid {
		note.FolderID = folderID.String
	}
	if entityKind.Valid {
		note.EntityKind = entityKind.String
	}
	if entitySubtype.Valid {
		note.EntitySubtype = entitySubtype.String
	}
	if ownerID.Valid {
		note.OwnerID = ownerID.String
	}
	if narrativeID.Valid {
		note.NarrativeID = narrativeID.String
	}
	if changeReason.Valid {
		note.ChangeReason = changeReason.String
	}

	return &note, nil
}

// GetNoteVersion retrieves a specific version of a note.
func (s *SQLiteStore) GetNoteVersion(id string, version int) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var note Note
	var isEntity, isPinned, favorite, isCurrent int
	var validTo sql.NullInt64
	var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes WHERE id = ? AND version = ?
	`, id, version).Scan(
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &markdownContent,
		&folderID, &entityKind, &entitySubtype,
		&isEntity, &isPinned, &favorite,
		&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &changeReason,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	note.IsEntity = isEntity != 0
	note.IsPinned = isPinned != 0
	note.Favorite = favorite != 0
	note.IsCurrent = isCurrent != 0
	if validTo.Valid {
		note.ValidTo = &validTo.Int64
	}
	if markdownContent.Valid {
		note.MarkdownContent = markdownContent.String
	}
	if folderID.Valid {
		note.FolderID = folderID.String
	}
	if entityKind.Valid {
		note.EntityKind = entityKind.String
	}
	if entitySubtype.Valid {
		note.EntitySubtype = entitySubtype.String
	}
	if ownerID.Valid {
		note.OwnerID = ownerID.String
	}
	if narrativeID.Valid {
		note.NarrativeID = narrativeID.String
	}
	if changeReason.Valid {
		note.ChangeReason = changeReason.String
	}

	return &note, nil
}

// ListNoteVersions returns all versions of a note.
func (s *SQLiteStore) ListNoteVersions(id string) ([]*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes WHERE id = ? ORDER BY version DESC
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []*Note
	for rows.Next() {
		var note Note
		var isEntity, isPinned, favorite, isCurrent int
		var validTo sql.NullInt64
		var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

		if err := rows.Scan(
			&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &markdownContent,
			&folderID, &entityKind, &entitySubtype,
			&isEntity, &isPinned, &favorite,
			&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
			&note.ValidFrom, &validTo, &isCurrent, &changeReason,
		); err != nil {
			return nil, err
		}

		note.IsEntity = isEntity != 0
		note.IsPinned = isPinned != 0
		note.Favorite = favorite != 0
		note.IsCurrent = isCurrent != 0
		if validTo.Valid {
			note.ValidTo = &validTo.Int64
		}
		if markdownContent.Valid {
			note.MarkdownContent = markdownContent.String
		}
		if folderID.Valid {
			note.FolderID = folderID.String
		}
		if entityKind.Valid {
			note.EntityKind = entityKind.String
		}
		if entitySubtype.Valid {
			note.EntitySubtype = entitySubtype.String
		}
		if ownerID.Valid {
			note.OwnerID = ownerID.String
		}
		if narrativeID.Valid {
			note.NarrativeID = narrativeID.String
		}
		if changeReason.Valid {
			note.ChangeReason = changeReason.String
		}
		notes = append(notes, &note)
	}

	return notes, rows.Err()
}

// GetNoteAtTime retrieves the version of a note that was current at a given timestamp.
func (s *SQLiteStore) GetNoteAtTime(id string, timestamp int64) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var note Note
	var isEntity, isPinned, favorite, isCurrent int
	var validTo sql.NullInt64
	var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes
		WHERE id = ?
		  AND valid_from <= ?
		  AND (valid_to IS NULL OR valid_to > ?)
		ORDER BY version DESC LIMIT 1
	`, id, timestamp, timestamp).Scan(
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &markdownContent,
		&folderID, &entityKind, &entitySubtype,
		&isEntity, &isPinned, &favorite,
		&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &changeReason,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	note.IsEntity = isEntity != 0
	note.IsPinned = isPinned != 0
	note.Favorite = favorite != 0
	note.IsCurrent = isCurrent != 0
	if validTo.Valid {
		note.ValidTo = &validTo.Int64
	}
	if markdownContent.Valid {
		note.MarkdownContent = markdownContent.String
	}
	if folderID.Valid {
		note.FolderID = folderID.String
	}
	if entityKind.Valid {
		note.EntityKind = entityKind.String
	}
	if entitySubtype.Valid {
		note.EntitySubtype = entitySubtype.String
	}
	if ownerID.Valid {
		note.OwnerID = ownerID.String
	}
	if narrativeID.Valid {
		note.NarrativeID = narrativeID.String
	}
	if changeReason.Valid {
		note.ChangeReason = changeReason.String
	}

	return &note, nil
}

// RestoreNoteVersion restores a previous version by creating a new version with the old content.
func (s *SQLiteStore) RestoreNoteVersion(id string, version int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Get the version to restore
	var oldNote Note
	var isEntity, isPinned, favorite int
	var validTo sql.NullInt64
	var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to
		FROM notes WHERE id = ? AND version = ?
	`, id, version).Scan(
		&oldNote.ID, &oldNote.Version, &oldNote.WorldID, &oldNote.Title, &oldNote.Content, &markdownContent,
		&folderID, &entityKind, &entitySubtype,
		&isEntity, &isPinned, &favorite,
		&ownerID, &narrativeID, &oldNote.Order, &oldNote.CreatedAt, &oldNote.UpdatedAt,
		&oldNote.ValidFrom, &validTo,
	)
	if err != nil {
		return err
	}

	oldNote.IsEntity = isEntity != 0
	oldNote.IsPinned = isPinned != 0
	oldNote.Favorite = favorite != 0
	if markdownContent.Valid {
		oldNote.MarkdownContent = markdownContent.String
	}
	if folderID.Valid {
		oldNote.FolderID = folderID.String
	}
	if entityKind.Valid {
		oldNote.EntityKind = entityKind.String
	}
	if entitySubtype.Valid {
		oldNote.EntitySubtype = entitySubtype.String
	}
	if ownerID.Valid {
		oldNote.OwnerID = ownerID.String
	}
	if narrativeID.Valid {
		oldNote.NarrativeID = narrativeID.String
	}

	// Get current max version
	var maxVersion int
	err = s.db.QueryRow(`SELECT MAX(version) FROM notes WHERE id = ?`, id).Scan(&maxVersion)
	if err != nil {
		return err
	}

	// Get current timestamp for valid_from
	var now int64
	err = s.db.QueryRow(`SELECT strftime('%s', 'now') * 1000`).Scan(&now)
	if err != nil {
		now = oldNote.UpdatedAt // Fallback
	}

	// Close current version
	_, err = s.db.Exec(`
		UPDATE notes SET valid_to = ?, is_current = 0 
		WHERE id = ? AND is_current = 1
	`, now, id)
	if err != nil {
		return err
	}

	// Insert restored version
	newVersion := maxVersion + 1
	_, err = s.db.Exec(`
		INSERT INTO notes (id, version, world_id, title, content, markdown_content, folder_id, 
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, 
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, oldNote.ID, newVersion, oldNote.WorldID, oldNote.Title, oldNote.Content, oldNote.MarkdownContent,
		oldNote.FolderID, oldNote.EntityKind, oldNote.EntitySubtype,
		boolToInt(oldNote.IsEntity), boolToInt(oldNote.IsPinned), boolToInt(oldNote.Favorite),
		oldNote.OwnerID, oldNote.NarrativeID, oldNote.Order, oldNote.CreatedAt, now,
		now, nil, 1, "restore")

	return err
}

// DeleteNote removes all versions of a note.
func (s *SQLiteStore) DeleteNote(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM notes WHERE id = ?", id)
	return err
}

// ListNotes returns current versions of all notes, optionally filtered by folder.
func (s *SQLiteStore) ListNotes(folderID string) ([]*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if folderID != "" {
		rows, err = s.db.Query(`
			SELECT id, version, world_id, title, content, markdown_content, folder_id,
				entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
				narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
			FROM notes WHERE folder_id = ? AND is_current = 1 ORDER BY "order"
		`, folderID)
	} else {
		rows, err = s.db.Query(`
			SELECT id, version, world_id, title, content, markdown_content, folder_id,
				entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
				narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
			FROM notes WHERE is_current = 1 ORDER BY "order"
		`)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []*Note
	for rows.Next() {
		var note Note
		var isEntity, isPinned, favorite, isCurrent int
		var validTo sql.NullInt64
		var markdownContent, folderID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

		if err := rows.Scan(
			&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &markdownContent,
			&folderID, &entityKind, &entitySubtype,
			&isEntity, &isPinned, &favorite,
			&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
			&note.ValidFrom, &validTo, &isCurrent, &changeReason,
		); err != nil {
			return nil, err
		}

		note.IsEntity = isEntity != 0
		note.IsPinned = isPinned != 0
		note.Favorite = favorite != 0
		note.IsCurrent = isCurrent != 0
		if validTo.Valid {
			note.ValidTo = &validTo.Int64
		}
		if markdownContent.Valid {
			note.MarkdownContent = markdownContent.String
		}
		if folderID.Valid {
			note.FolderID = folderID.String
		}
		if entityKind.Valid {
			note.EntityKind = entityKind.String
		}
		if entitySubtype.Valid {
			note.EntitySubtype = entitySubtype.String
		}
		if ownerID.Valid {
			note.OwnerID = ownerID.String
		}
		if narrativeID.Valid {
			note.NarrativeID = narrativeID.String
		}
		if changeReason.Valid {
			note.ChangeReason = changeReason.String
		}
		notes = append(notes, &note)
	}

	return notes, rows.Err()
}

// CountNotes returns the total number of notes (current versions only).
func (s *SQLiteStore) CountNotes() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM notes WHERE is_current = 1").Scan(&count)
	return count, err
}

// =============================================================================
// Entity CRUD
// =============================================================================

// UpsertEntity inserts or updates an entity.
func (s *SQLiteStore) UpsertEntity(entity *Entity) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	aliasesJSON, err := json.Marshal(entity.Aliases)
	if err != nil {
		return fmt.Errorf("failed to marshal aliases: %w", err)
	}

	_, err = s.db.Exec(`
		INSERT INTO entities (id, label, kind, subtype, aliases, first_note, 
			total_mentions, narrative_id, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			label = excluded.label,
			kind = excluded.kind,
			subtype = excluded.subtype,
			aliases = excluded.aliases,
			first_note = excluded.first_note,
			total_mentions = excluded.total_mentions,
			narrative_id = excluded.narrative_id,
			updated_at = excluded.updated_at
	`, entity.ID, entity.Label, entity.Kind, entity.Subtype, string(aliasesJSON),
		entity.FirstNote, entity.TotalMentions, entity.NarrativeID,
		entity.CreatedBy, entity.CreatedAt, entity.UpdatedAt)

	return err
}

// GetEntity retrieves an entity by ID.
func (s *SQLiteStore) GetEntity(id string) (*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var entity Entity
	var aliasesJSON string

	err := s.db.QueryRow(`
		SELECT id, label, kind, subtype, aliases, first_note, total_mentions,
			narrative_id, created_by, created_at, updated_at
		FROM entities WHERE id = ?
	`, id).Scan(
		&entity.ID, &entity.Label, &entity.Kind, &entity.Subtype, &aliasesJSON,
		&entity.FirstNote, &entity.TotalMentions, &entity.NarrativeID,
		&entity.CreatedBy, &entity.CreatedAt, &entity.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Parse aliases JSON
	if aliasesJSON != "" {
		if err := json.Unmarshal([]byte(aliasesJSON), &entity.Aliases); err != nil {
			entity.Aliases = []string{}
		}
	} else {
		entity.Aliases = []string{}
	}

	return &entity, nil
}

// GetEntityByLabel finds an entity by its label (case-insensitive).
func (s *SQLiteStore) GetEntityByLabel(label string) (*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var entity Entity
	var aliasesJSON string

	err := s.db.QueryRow(`
		SELECT id, label, kind, subtype, aliases, first_note, total_mentions,
			narrative_id, created_by, created_at, updated_at
		FROM entities WHERE LOWER(label) = LOWER(?)
	`, label).Scan(
		&entity.ID, &entity.Label, &entity.Kind, &entity.Subtype, &aliasesJSON,
		&entity.FirstNote, &entity.TotalMentions, &entity.NarrativeID,
		&entity.CreatedBy, &entity.CreatedAt, &entity.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if aliasesJSON != "" {
		if err := json.Unmarshal([]byte(aliasesJSON), &entity.Aliases); err != nil {
			entity.Aliases = []string{}
		}
	} else {
		entity.Aliases = []string{}
	}

	return &entity, nil
}

// DeleteEntity removes an entity by ID.
func (s *SQLiteStore) DeleteEntity(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM entities WHERE id = ?", id)
	return err
}

// ListEntities returns all entities, optionally filtered by kind.
func (s *SQLiteStore) ListEntities(kind string) ([]*Entity, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if kind != "" {
		rows, err = s.db.Query(`
			SELECT id, label, kind, subtype, aliases, first_note, total_mentions,
				narrative_id, created_by, created_at, updated_at
			FROM entities WHERE kind = ? ORDER BY label
		`, kind)
	} else {
		rows, err = s.db.Query(`
			SELECT id, label, kind, subtype, aliases, first_note, total_mentions,
				narrative_id, created_by, created_at, updated_at
			FROM entities ORDER BY label
		`)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entities []*Entity
	for rows.Next() {
		var entity Entity
		var aliasesJSON string

		if err := rows.Scan(
			&entity.ID, &entity.Label, &entity.Kind, &entity.Subtype, &aliasesJSON,
			&entity.FirstNote, &entity.TotalMentions, &entity.NarrativeID,
			&entity.CreatedBy, &entity.CreatedAt, &entity.UpdatedAt,
		); err != nil {
			return nil, err
		}

		if aliasesJSON != "" {
			if err := json.Unmarshal([]byte(aliasesJSON), &entity.Aliases); err != nil {
				entity.Aliases = []string{}
			}
		} else {
			entity.Aliases = []string{}
		}

		entities = append(entities, &entity)
	}

	return entities, rows.Err()
}

// CountEntities returns the total number of entities.
func (s *SQLiteStore) CountEntities() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM entities").Scan(&count)
	return count, err
}

// =============================================================================
// Edge CRUD
// =============================================================================

// UpsertEdge inserts or updates an edge.
func (s *SQLiteStore) UpsertEdge(edge *Edge) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO edges (id, source_id, target_id, rel_type, confidence, 
			bidirectional, source_note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			source_id = excluded.source_id,
			target_id = excluded.target_id,
			rel_type = excluded.rel_type,
			confidence = excluded.confidence,
			bidirectional = excluded.bidirectional,
			source_note = excluded.source_note
	`, edge.ID, edge.SourceID, edge.TargetID, edge.RelType, edge.Confidence,
		boolToInt(edge.Bidirectional), edge.SourceNote, edge.CreatedAt)

	return err
}

// GetEdge retrieves an edge by ID.
func (s *SQLiteStore) GetEdge(id string) (*Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var edge Edge
	var bidirectional int

	err := s.db.QueryRow(`
		SELECT id, source_id, target_id, rel_type, confidence, bidirectional, 
			source_note, created_at
		FROM edges WHERE id = ?
	`, id).Scan(
		&edge.ID, &edge.SourceID, &edge.TargetID, &edge.RelType, &edge.Confidence,
		&bidirectional, &edge.SourceNote, &edge.CreatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	edge.Bidirectional = bidirectional != 0
	return &edge, nil
}

// DeleteEdge removes an edge by ID.
func (s *SQLiteStore) DeleteEdge(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM edges WHERE id = ?", id)
	return err
}

// ListEdgesForEntity returns all edges connected to an entity.
func (s *SQLiteStore) ListEdgesForEntity(entityID string) ([]*Edge, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, source_id, target_id, rel_type, confidence, bidirectional, 
			source_note, created_at
		FROM edges WHERE source_id = ? OR target_id = ?
	`, entityID, entityID)

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []*Edge
	for rows.Next() {
		var edge Edge
		var bidirectional int

		if err := rows.Scan(
			&edge.ID, &edge.SourceID, &edge.TargetID, &edge.RelType, &edge.Confidence,
			&bidirectional, &edge.SourceNote, &edge.CreatedAt,
		); err != nil {
			return nil, err
		}

		edge.Bidirectional = bidirectional != 0
		edges = append(edges, &edge)
	}

	return edges, rows.Err()
}

// CountEdges returns the total number of edges.
func (s *SQLiteStore) CountEdges() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM edges").Scan(&count)
	return count, err
}

// =============================================================================
// Helpers
// =============================================================================

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// =============================================================================
// Folder CRUD
// =============================================================================

// UpsertFolder inserts or updates a folder.
func (s *SQLiteStore) UpsertFolder(folder *Folder) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO folders (id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			parent_id = excluded.parent_id,
			world_id = excluded.world_id,
			narrative_id = excluded.narrative_id,
			folder_order = excluded.folder_order,
			updated_at = excluded.updated_at
	`, folder.ID, folder.Name, folder.ParentID, folder.WorldID,
		folder.NarrativeID, folder.FolderOrder, folder.CreatedAt, folder.UpdatedAt)

	return err
}

// GetFolder retrieves a folder by ID.
func (s *SQLiteStore) GetFolder(id string) (*Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var folder Folder
	err := s.db.QueryRow(`
		SELECT id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at
		FROM folders WHERE id = ?
	`, id).Scan(
		&folder.ID, &folder.Name, &folder.ParentID, &folder.WorldID,
		&folder.NarrativeID, &folder.FolderOrder, &folder.CreatedAt, &folder.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &folder, nil
}

// DeleteFolder removes a folder by ID.
func (s *SQLiteStore) DeleteFolder(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM folders WHERE id = ?", id)
	return err
}

// ListFolders returns folders, optionally filtered by parent.
func (s *SQLiteStore) ListFolders(parentID string) ([]*Folder, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if parentID != "" {
		rows, err = s.db.Query(`
			SELECT id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at
			FROM folders WHERE parent_id = ? ORDER BY folder_order
		`, parentID)
	} else {
		rows, err = s.db.Query(`
			SELECT id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at
			FROM folders ORDER BY folder_order
		`)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []*Folder
	for rows.Next() {
		var folder Folder
		if err := rows.Scan(
			&folder.ID, &folder.Name, &folder.ParentID, &folder.WorldID,
			&folder.NarrativeID, &folder.FolderOrder, &folder.CreatedAt, &folder.UpdatedAt,
		); err != nil {
			return nil, err
		}
		folders = append(folders, &folder)
	}

	return folders, rows.Err()
}

// =============================================================================
// Thread CRUD (Observational Memory)
// =============================================================================

// CreateThread creates a new conversation thread.
func (s *SQLiteStore) CreateThread(thread *Thread) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO threads (id, world_id, narrative_id, title, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, thread.ID, thread.WorldID, thread.NarrativeID, thread.Title, thread.CreatedAt, thread.UpdatedAt)

	return err
}

// GetThread retrieves a thread by ID.
func (s *SQLiteStore) GetThread(id string) (*Thread, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var thread Thread
	err := s.db.QueryRow(`
		SELECT id, world_id, narrative_id, title, created_at, updated_at
		FROM threads WHERE id = ?
	`, id).Scan(&thread.ID, &thread.WorldID, &thread.NarrativeID, &thread.Title,
		&thread.CreatedAt, &thread.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &thread, nil
}

// DeleteThread removes a thread and all its messages.
func (s *SQLiteStore) DeleteThread(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Delete memory associations first
	if _, err := s.db.Exec("DELETE FROM memory_threads WHERE thread_id = ?", id); err != nil {
		return err
	}

	// Delete messages
	if _, err := s.db.Exec("DELETE FROM thread_messages WHERE thread_id = ?", id); err != nil {
		return err
	}

	// Delete thread
	_, err := s.db.Exec("DELETE FROM threads WHERE id = ?", id)
	return err
}

// ListThreads returns all threads, optionally filtered by worldID.
func (s *SQLiteStore) ListThreads(worldID string) ([]*Thread, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if worldID != "" {
		rows, err = s.db.Query(`
			SELECT id, world_id, narrative_id, title, created_at, updated_at
			FROM threads WHERE world_id = ? ORDER BY updated_at DESC
		`, worldID)
	} else {
		rows, err = s.db.Query(`
			SELECT id, world_id, narrative_id, title, created_at, updated_at
			FROM threads ORDER BY updated_at DESC
		`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var threads []*Thread
	for rows.Next() {
		var t Thread
		if err := rows.Scan(&t.ID, &t.WorldID, &t.NarrativeID, &t.Title,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		threads = append(threads, &t)
	}

	return threads, rows.Err()
}

// =============================================================================
// ThreadMessage CRUD
// =============================================================================

// AddMessage adds a message to a thread.
func (s *SQLiteStore) AddMessage(msg *ThreadMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO thread_messages (id, thread_id, role, content, narrative_id, created_at, updated_at, is_streaming)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, msg.ID, msg.ThreadID, msg.Role, msg.Content, msg.NarrativeID, msg.CreatedAt, msg.UpdatedAt, boolToInt(msg.IsStreaming))

	if err != nil {
		return err
	}

	// Update thread's updated_at timestamp
	_, err = s.db.Exec("UPDATE threads SET updated_at = ? WHERE id = ?", msg.CreatedAt, msg.ThreadID)
	return err
}

// GetThreadMessages returns all messages for a thread in chronological order.
func (s *SQLiteStore) GetThreadMessages(threadID string) ([]*ThreadMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, thread_id, role, content, narrative_id, created_at, updated_at, is_streaming
		FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC
	`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*ThreadMessage
	for rows.Next() {
		var m ThreadMessage
		var isStreaming int
		var updatedAt sql.NullInt64
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.NarrativeID,
			&m.CreatedAt, &updatedAt, &isStreaming); err != nil {
			return nil, err
		}
		m.IsStreaming = isStreaming != 0
		if updatedAt.Valid {
			m.UpdatedAt = updatedAt.Int64
		}
		messages = append(messages, &m)
	}

	return messages, rows.Err()
}

// DeleteThreadMessages removes all messages from a thread.
func (s *SQLiteStore) DeleteThreadMessages(threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM thread_messages WHERE thread_id = ?", threadID)
	return err
}

// GetMessage retrieves a single message by ID.
func (s *SQLiteStore) GetMessage(id string) (*ThreadMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var m ThreadMessage
	var isStreaming int
	var updatedAt sql.NullInt64

	err := s.db.QueryRow(`
		SELECT id, thread_id, role, content, narrative_id, created_at, updated_at, is_streaming
		FROM thread_messages WHERE id = ?
	`, id).Scan(&m.ID, &m.ThreadID, &m.Role, &m.Content, &m.NarrativeID,
		&m.CreatedAt, &updatedAt, &isStreaming)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	m.IsStreaming = isStreaming != 0
	if updatedAt.Valid {
		m.UpdatedAt = updatedAt.Int64
	}

	return &m, nil
}

// UpdateMessage updates an existing message.
func (s *SQLiteStore) UpdateMessage(msg *ThreadMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		UPDATE thread_messages
		SET content = ?, updated_at = ?, is_streaming = ?
		WHERE id = ?
	`, msg.Content, msg.UpdatedAt, boolToInt(msg.IsStreaming), msg.ID)

	return err
}

// AppendMessageContent appends content to a message (for streaming).
func (s *SQLiteStore) AppendMessageContent(messageID string, chunk string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		UPDATE thread_messages
		SET content = content || ?, updated_at = ?
		WHERE id = ?
	`, chunk, time.Now().UnixMilli(), messageID)

	return err
}

// =============================================================================
// Memory CRUD
// =============================================================================

// CreateMemory creates a new memory and links it to a thread.
func (s *SQLiteStore) CreateMemory(memory *Memory, threadID, messageID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Insert memory
	_, err := s.db.Exec(`
		INSERT INTO memories (id, content, memory_type, confidence, source_role, entity_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, memory.ID, memory.Content, string(memory.MemoryType), memory.Confidence,
		memory.SourceRole, memory.EntityID, memory.CreatedAt, memory.UpdatedAt)
	if err != nil {
		return err
	}

	// Create thread association
	_, err = s.db.Exec(`
		INSERT INTO memory_threads (memory_id, thread_id, message_id, created_at)
		VALUES (?, ?, ?, ?)
	`, memory.ID, threadID, messageID, memory.CreatedAt)

	return err
}

// GetMemory retrieves a memory by ID.
func (s *SQLiteStore) GetMemory(id string) (*Memory, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var m Memory
	var memoryType string
	var entityID sql.NullString

	err := s.db.QueryRow(`
		SELECT id, content, memory_type, confidence, source_role, entity_id, created_at, updated_at
		FROM memories WHERE id = ?
	`, id).Scan(&m.ID, &m.Content, &memoryType, &m.Confidence, &m.SourceRole,
		&entityID, &m.CreatedAt, &m.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	m.MemoryType = MemoryType(memoryType)
	if entityID.Valid {
		m.EntityID = entityID.String
	}

	return &m, nil
}

// DeleteMemory removes a memory and its thread associations.
func (s *SQLiteStore) DeleteMemory(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Delete thread associations first
	if _, err := s.db.Exec("DELETE FROM memory_threads WHERE memory_id = ?", id); err != nil {
		return err
	}

	// Delete memory
	_, err := s.db.Exec("DELETE FROM memories WHERE id = ?", id)
	return err
}

// GetMemoriesForThread returns all memories associated with a thread.
func (s *SQLiteStore) GetMemoriesForThread(threadID string) ([]*Memory, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT m.id, m.content, m.memory_type, m.confidence, m.source_role, m.entity_id, m.created_at, m.updated_at
		FROM memories m
		INNER JOIN memory_threads mt ON m.id = mt.memory_id
		WHERE mt.thread_id = ?
		ORDER BY m.created_at DESC
	`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var memoryType string
		var entityID sql.NullString

		if err := rows.Scan(&m.ID, &m.Content, &memoryType, &m.Confidence, &m.SourceRole,
			&entityID, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}

		m.MemoryType = MemoryType(memoryType)
		if entityID.Valid {
			m.EntityID = entityID.String
		}
		memories = append(memories, &m)
	}

	return memories, rows.Err()
}

// ListMemoriesByType returns all memories of a specific type.
func (s *SQLiteStore) ListMemoriesByType(memoryType MemoryType) ([]*Memory, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, content, memory_type, confidence, source_role, entity_id, created_at, updated_at
		FROM memories WHERE memory_type = ?
		ORDER BY created_at DESC
	`, string(memoryType))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var m Memory
		var mt string
		var entityID sql.NullString

		if err := rows.Scan(&m.ID, &m.Content, &mt, &m.Confidence, &m.SourceRole,
			&entityID, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}

		m.MemoryType = MemoryType(mt)
		if entityID.Valid {
			m.EntityID = entityID.String
		}
		memories = append(memories, &m)
	}

	return memories, rows.Err()
}

// Export serializes all database tables to JSON bytes.
// This is a portable export that doesn't depend on sqlite3 serialization APIs.
func (s *SQLiteStore) Export() ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	type ExportData struct {
		Notes    []*Note   `json:"notes"`
		Entities []*Entity `json:"entities"`
		Edges    []*Edge   `json:"edges"`
		Folders  []*Folder `json:"folders"`
	}

	var data ExportData

	// Export notes - only current versions
	noteRows, err := s.db.Query(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id, entity_kind,
			   entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, updated_at,
			   narrative_id, "order"
		FROM notes WHERE is_current = 1
	`)
	if err != nil {
		return nil, fmt.Errorf("export notes: %w", err)
	}
	defer noteRows.Close()
	for noteRows.Next() {
		var n Note
		var isEntity, isPinned, favorite int
		if err := noteRows.Scan(
			&n.ID, &n.Version, &n.WorldID, &n.Title, &n.Content, &n.MarkdownContent, &n.FolderID,
			&n.EntityKind, &n.EntitySubtype, &isEntity, &isPinned, &favorite,
			&n.OwnerID, &n.CreatedAt, &n.UpdatedAt, &n.NarrativeID, &n.Order,
		); err != nil {
			return nil, fmt.Errorf("scan note: %w", err)
		}
		n.IsEntity = isEntity == 1
		n.IsPinned = isPinned == 1
		n.Favorite = favorite == 1
		n.IsCurrent = true
		n.ValidFrom = n.CreatedAt
		data.Notes = append(data.Notes, &n)
	}

	// Export entities
	entityRows, err := s.db.Query(`
		SELECT id, label, kind, subtype, aliases, first_note, total_mentions,
			   created_at, updated_at, created_by, narrative_id
		FROM entities
	`)
	if err != nil {
		return nil, fmt.Errorf("export entities: %w", err)
	}
	defer entityRows.Close()
	for entityRows.Next() {
		var e Entity
		var aliasesJSON string
		if err := entityRows.Scan(
			&e.ID, &e.Label, &e.Kind, &e.Subtype, &aliasesJSON,
			&e.FirstNote, &e.TotalMentions, &e.CreatedAt, &e.UpdatedAt,
			&e.CreatedBy, &e.NarrativeID,
		); err != nil {
			return nil, fmt.Errorf("scan entity: %w", err)
		}
		json.Unmarshal([]byte(aliasesJSON), &e.Aliases)
		data.Entities = append(data.Entities, &e)
	}

	// Export edges
	edgeRows, err := s.db.Query(`
		SELECT id, source_id, target_id, rel_type, confidence, bidirectional, source_note, created_at
		FROM edges
	`)
	if err != nil {
		return nil, fmt.Errorf("export edges: %w", err)
	}
	defer edgeRows.Close()
	for edgeRows.Next() {
		var e Edge
		var bidir int
		if err := edgeRows.Scan(
			&e.ID, &e.SourceID, &e.TargetID, &e.RelType, &e.Confidence,
			&bidir, &e.SourceNote, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan edge: %w", err)
		}
		e.Bidirectional = bidir == 1
		data.Edges = append(data.Edges, &e)
	}

	// Export folders
	folderRows, err := s.db.Query(`
		SELECT id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at
		FROM folders
	`)
	if err != nil {
		return nil, fmt.Errorf("export folders: %w", err)
	}
	defer folderRows.Close()
	for folderRows.Next() {
		var f Folder
		if err := folderRows.Scan(
			&f.ID, &f.Name, &f.ParentID, &f.WorldID, &f.NarrativeID,
			&f.FolderOrder, &f.CreatedAt, &f.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan folder: %w", err)
		}
		data.Folders = append(data.Folders, &f)
	}

	return json.Marshal(data)
}

// Import restores the database state from an exported JSON byte slice.
// Clears all existing data and re-inserts from the export.
func (s *SQLiteStore) Import(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(data) == 0 {
		return nil
	}

	type ExportData struct {
		Notes    []*Note   `json:"notes"`
		Entities []*Entity `json:"entities"`
		Edges    []*Edge   `json:"edges"`
		Folders  []*Folder `json:"folders"`
	}

	var importData ExportData
	if err := json.Unmarshal(data, &importData); err != nil {
		return fmt.Errorf("import unmarshal: %w", err)
	}

	// Clear all tables
	for _, table := range []string{"edges", "entities", "folders", "notes"} {
		if _, err := s.db.Exec("DELETE FROM " + table); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}

	// Re-insert notes
	for _, n := range importData.Notes {
		version := n.Version
		if version == 0 {
			version = 1
		}
		validFrom := n.ValidFrom
		if validFrom == 0 {
			validFrom = n.CreatedAt
		}
		_, err := s.db.Exec(`
			INSERT INTO notes (id, version, world_id, title, content, markdown_content, folder_id, entity_kind,
				entity_subtype, is_entity, is_pinned, favorite, owner_id, created_at, updated_at,
				narrative_id, "order", valid_from, is_current)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		`, n.ID, version, n.WorldID, n.Title, n.Content, n.MarkdownContent, n.FolderID,
			n.EntityKind, n.EntitySubtype, boolToInt(n.IsEntity), boolToInt(n.IsPinned),
			boolToInt(n.Favorite), n.OwnerID, n.CreatedAt, n.UpdatedAt, n.NarrativeID, n.Order, validFrom)
		if err != nil {
			return fmt.Errorf("import note %s: %w", n.ID, err)
		}
	}

	// Re-insert entities
	for _, e := range importData.Entities {
		aliasesJSON, _ := json.Marshal(e.Aliases)
		_, err := s.db.Exec(`
			INSERT INTO entities (id, label, kind, subtype, aliases, first_note, total_mentions,
				created_at, updated_at, created_by, narrative_id)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, e.ID, e.Label, e.Kind, e.Subtype, string(aliasesJSON),
			e.FirstNote, e.TotalMentions, e.CreatedAt, e.UpdatedAt, e.CreatedBy, e.NarrativeID)
		if err != nil {
			return fmt.Errorf("import entity %s: %w", e.ID, err)
		}
	}

	// Re-insert edges
	for _, e := range importData.Edges {
		_, err := s.db.Exec(`
			INSERT INTO edges (id, source_id, target_id, rel_type, confidence, bidirectional, source_note, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, e.ID, e.SourceID, e.TargetID, e.RelType, e.Confidence,
			boolToInt(e.Bidirectional), e.SourceNote, e.CreatedAt)
		if err != nil {
			return fmt.Errorf("import edge %s: %w", e.ID, err)
		}
	}

	// Re-insert folders
	for _, f := range importData.Folders {
		_, err := s.db.Exec(`
			INSERT INTO folders (id, name, parent_id, world_id, narrative_id, folder_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, f.ID, f.Name, f.ParentID, f.WorldID, f.NarrativeID,
			f.FolderOrder, f.CreatedAt, f.UpdatedAt)
		if err != nil {
			return fmt.Errorf("import folder %s: %w", f.ID, err)
		}
	}

	return nil
}

// =============================================================================
// Episode Log CRUD (Stub implementations — temporal action stream)
// =============================================================================

// LogEpisode records a temporal action log entry.
// TODO: Implement full episode tracking for "what did LLM know at time T?" queries.
func (s *SQLiteStore) LogEpisode(episode *Episode) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO episodes (scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, episode.ScopeID, episode.NoteID, episode.Timestamp, episode.ActionType,
		episode.TargetID, episode.TargetKind, episode.Payload, episode.NarrativeID)

	return err
}

// GetEpisodes retrieves recent episodes for a scope.
func (s *SQLiteStore) GetEpisodes(scopeID string, limit int) ([]*Episode, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 100
	}

	rows, err := s.db.Query(`
		SELECT scope_id, note_id, ts, action_type, target_id, target_kind, payload, narrative_id
		FROM episodes WHERE scope_id = ? ORDER BY ts DESC LIMIT ?
	`, scopeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodes []*Episode
	for rows.Next() {
		var ep Episode
		var narrativeID sql.NullString
		if err := rows.Scan(
			&ep.ScopeID, &ep.NoteID, &ep.Timestamp, &ep.ActionType,
			&ep.TargetID, &ep.TargetKind, &ep.Payload, &narrativeID,
		); err != nil {
			return nil, err
		}
		if narrativeID.Valid {
			ep.NarrativeID = narrativeID.String
		}
		episodes = append(episodes, &ep)
	}

	return episodes, rows.Err()
}

// =============================================================================
// Blocks CRUD (Stub implementations — vector search not yet integrated)
// =============================================================================

// UpsertBlock inserts or updates a text block with vector embedding.
// TODO: Implement vector storage once sqlite-vec is fully integrated.
func (s *SQLiteStore) UpsertBlock(block *Block) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO blocks (id, note_id, ord, text, narrative_id, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			note_id = excluded.note_id,
			ord = excluded.ord,
			text = excluded.text,
			narrative_id = excluded.narrative_id
	`, block.ID, block.NoteID, block.Ordinal, block.Text, block.NarrativeID, block.CreatedAt)

	return err
}

// GetBlocksForNote retrieves all blocks for a note.
func (s *SQLiteStore) GetBlocksForNote(noteID string) ([]*Block, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, note_id, ord, text, narrative_id, created_at
		FROM blocks WHERE note_id = ? ORDER BY ord
	`, noteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []*Block
	for rows.Next() {
		var block Block
		if err := rows.Scan(
			&block.ID, &block.NoteID, &block.Ordinal, &block.Text,
			&block.NarrativeID, &block.CreatedAt,
		); err != nil {
			return nil, err
		}
		blocks = append(blocks, &block)
	}

	return blocks, rows.Err()
}

// SearchBlocks performs vector similarity search.
// TODO: Implement with sqlite-vec once integrated.
func (s *SQLiteStore) SearchBlocks(queryVec []float32, limit int, narrativeID string) ([]*Block, error) {
	// Stub: return empty slice until vector search is implemented
	// This avoids compilation errors while the feature is being developed
	return []*Block{}, nil
}

// =============================================================================
// Observational Memory CRUD (Phase 8)
// =============================================================================

// UpsertOMRecord inserts or updates an OM record for a thread.
func (s *SQLiteStore) UpsertOMRecord(record *OMRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO om_records (thread_id, observations, current_task, last_observed_at,
			obs_token_count, generation_num, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(thread_id) DO UPDATE SET
			observations = excluded.observations,
			current_task = excluded.current_task,
			last_observed_at = excluded.last_observed_at,
			obs_token_count = excluded.obs_token_count,
			generation_num = excluded.generation_num,
			updated_at = excluded.updated_at
	`, record.ThreadID, record.Observations, record.CurrentTask, record.LastObservedAt,
		record.ObsTokenCount, record.GenerationNum, record.CreatedAt, record.UpdatedAt)

	return err
}

// GetOMRecord retrieves the OM record for a thread.
// Returns nil (not error) if no record exists.
func (s *SQLiteStore) GetOMRecord(threadID string) (*OMRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var record OMRecord
	err := s.db.QueryRow(`
		SELECT thread_id, observations, current_task, last_observed_at,
			obs_token_count, generation_num, created_at, updated_at
		FROM om_records WHERE thread_id = ?
	`, threadID).Scan(
		&record.ThreadID, &record.Observations, &record.CurrentTask, &record.LastObservedAt,
		&record.ObsTokenCount, &record.GenerationNum, &record.CreatedAt, &record.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return &record, nil
}

// DeleteOMRecord removes the OM record for a thread.
func (s *SQLiteStore) DeleteOMRecord(threadID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM om_records WHERE thread_id = ?", threadID)
	return err
}

// AddOMGeneration records a reflection compression event.
func (s *SQLiteStore) AddOMGeneration(gen *OMGeneration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO om_generations (id, thread_id, generation, input_tokens, output_tokens,
			input_text, output_text, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, gen.ID, gen.ThreadID, gen.Generation, gen.InputTokens, gen.OutputTokens,
		gen.InputText, gen.OutputText, gen.CreatedAt)

	return err
}

// GetOMGenerations retrieves all generations for a thread, ordered by generation.
func (s *SQLiteStore) GetOMGenerations(threadID string) ([]*OMGeneration, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT id, thread_id, generation, input_tokens, output_tokens,
			input_text, output_text, created_at
		FROM om_generations
		WHERE thread_id = ?
		ORDER BY generation ASC
	`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var generations []*OMGeneration
	for rows.Next() {
		var gen OMGeneration
		if err := rows.Scan(
			&gen.ID, &gen.ThreadID, &gen.Generation, &gen.InputTokens, &gen.OutputTokens,
			&gen.InputText, &gen.OutputText, &gen.CreatedAt,
		); err != nil {
			return nil, err
		}
		generations = append(generations, &gen)
	}

	return generations, rows.Err()
}

// =============================================================================
// RLM Workspace CRUD
// =============================================================================

// PutArtifact inserts or updates a workspace artifact.
func (s *SQLiteStore) PutArtifact(art *WorkspaceArtifact) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO workspace_artifacts (key, thread_id, narrative_id, folder_id,
			kind, payload, pinned, produced_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(key, thread_id, narrative_id, folder_id) DO UPDATE SET
			kind = excluded.kind,
			payload = excluded.payload,
			pinned = excluded.pinned,
			produced_by = excluded.produced_by,
			updated_at = excluded.updated_at
	`, art.Key, art.ThreadID, art.NarrativeID, art.FolderID,
		art.Kind, art.Payload, boolToInt(art.Pinned), art.ProducedBy,
		art.CreatedAt, art.UpdatedAt)

	return err
}

// GetArtifact retrieves a single workspace artifact by scope + key.
func (s *SQLiteStore) GetArtifact(scope *ScopeKey, key string) (*WorkspaceArtifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var art WorkspaceArtifact
	var pinned int

	err := s.db.QueryRow(`
		SELECT key, thread_id, narrative_id, folder_id,
			kind, payload, pinned, produced_by, created_at, updated_at
		FROM workspace_artifacts
		WHERE key = ? AND thread_id = ? AND narrative_id = ? AND folder_id = ?
	`, key, scope.ThreadID, scope.NarrativeID, scope.FolderID).Scan(
		&art.Key, &art.ThreadID, &art.NarrativeID, &art.FolderID,
		&art.Kind, &art.Payload, &pinned, &art.ProducedBy,
		&art.CreatedAt, &art.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	art.Pinned = pinned != 0
	return &art, nil
}

// DeleteArtifact removes a workspace artifact by scope + key.
func (s *SQLiteStore) DeleteArtifact(scope *ScopeKey, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		DELETE FROM workspace_artifacts
		WHERE key = ? AND thread_id = ? AND narrative_id = ? AND folder_id = ?
	`, key, scope.ThreadID, scope.NarrativeID, scope.FolderID)

	return err
}

// ListArtifacts returns all workspace artifacts for the given scope.
func (s *SQLiteStore) ListArtifacts(scope *ScopeKey) ([]*WorkspaceArtifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query(`
		SELECT key, thread_id, narrative_id, folder_id,
			kind, payload, pinned, produced_by, created_at, updated_at
		FROM workspace_artifacts
		WHERE thread_id = ? AND narrative_id = ? AND folder_id = ?
		ORDER BY updated_at DESC
	`, scope.ThreadID, scope.NarrativeID, scope.FolderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var arts []*WorkspaceArtifact
	for rows.Next() {
		var art WorkspaceArtifact
		var pinned int

		if err := rows.Scan(
			&art.Key, &art.ThreadID, &art.NarrativeID, &art.FolderID,
			&art.Kind, &art.Payload, &pinned, &art.ProducedBy,
			&art.CreatedAt, &art.UpdatedAt,
		); err != nil {
			return nil, err
		}

		art.Pinned = pinned != 0
		arts = append(arts, &art)
	}

	return arts, rows.Err()
}

// SearchNotes searches current notes by markdown content using LIKE,
// scoped to a folder subtree (recursive CTE) and narrative.
func (s *SQLiteStore) SearchNotes(scope *ScopeKey, query string, limit int) ([]*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 20
	}

	likePattern := "%" + query + "%"

	var rows *sql.Rows
	var err error

	if scope.FolderID != "" {
		// Recursive CTE to get all folders in the subtree
		q := `
			WITH RECURSIVE folder_tree(id) AS (
				SELECT id FROM folders WHERE id = ?
				UNION ALL
				SELECT f.id FROM folders f
					INNER JOIN folder_tree ft ON f.parent_id = ft.id
			)
			SELECT n.id, n.version, n.world_id, n.title, n.content,
				n.markdown_content, n.folder_id, n.entity_kind, n.entity_subtype,
				n.is_entity, n.is_pinned, n.favorite, n.owner_id,
				n.narrative_id, n."order", n.created_at, n.updated_at,
				n.valid_from, n.valid_to, n.is_current, n.change_reason
			FROM notes n
			WHERE n.is_current = 1
			  AND n.folder_id IN (SELECT id FROM folder_tree)
			  AND (? = '' OR n.narrative_id = ?)
			  AND (n.markdown_content LIKE ? OR n.title LIKE ?)
			ORDER BY n.updated_at DESC
			LIMIT ?
		`
		rows, err = s.db.Query(q, scope.FolderID,
			scope.NarrativeID, scope.NarrativeID,
			likePattern, likePattern, limit)
	} else {
		q := `
			SELECT id, version, world_id, title, content,
				markdown_content, folder_id, entity_kind, entity_subtype,
				is_entity, is_pinned, favorite, owner_id,
				narrative_id, "order", created_at, updated_at,
				valid_from, valid_to, is_current, change_reason
			FROM notes
			WHERE is_current = 1
			  AND (? = '' OR narrative_id = ?)
			  AND (markdown_content LIKE ? OR title LIKE ?)
			ORDER BY updated_at DESC
			LIMIT ?
		`
		rows, err = s.db.Query(q,
			scope.NarrativeID, scope.NarrativeID,
			likePattern, likePattern, limit)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []*Note
	for rows.Next() {
		var note Note
		var isEntity, isPinned, favorite, isCurrent int
		var validTo sql.NullInt64
		var markdownContent, fID, entityKind, entitySubtype, ownerID, narrativeID, changeReason sql.NullString

		if err := rows.Scan(
			&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content,
			&markdownContent, &fID, &entityKind, &entitySubtype,
			&isEntity, &isPinned, &favorite,
			&ownerID, &narrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
			&note.ValidFrom, &validTo, &isCurrent, &changeReason,
		); err != nil {
			return nil, err
		}

		note.IsEntity = isEntity != 0
		note.IsPinned = isPinned != 0
		note.Favorite = favorite != 0
		note.IsCurrent = isCurrent != 0
		if validTo.Valid {
			note.ValidTo = &validTo.Int64
		}
		if markdownContent.Valid {
			note.MarkdownContent = markdownContent.String
		}
		if fID.Valid {
			note.FolderID = fID.String
		}
		if entityKind.Valid {
			note.EntityKind = entityKind.String
		}
		if entitySubtype.Valid {
			note.EntitySubtype = entitySubtype.String
		}
		if ownerID.Valid {
			note.OwnerID = ownerID.String
		}
		if narrativeID.Valid {
			note.NarrativeID = narrativeID.String
		}
		if changeReason.Valid {
			note.ChangeReason = changeReason.String
		}
		notes = append(notes, &note)
	}

	return notes, rows.Err()
}

// Compile-time interface check
var _ Storer = (*SQLiteStore)(nil)
