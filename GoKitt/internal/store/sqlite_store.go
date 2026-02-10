// Package store provides SQLite-backed persistence for GoKitt.
// Uses ncruces/go-sqlite3/driver which provides a database/sql interface.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

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

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes WHERE id = ? AND is_current = 1
	`, id).Scan(
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
		&note.FolderID, &note.EntityKind, &note.EntitySubtype,
		&isEntity, &isPinned, &favorite,
		&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &note.ChangeReason,
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

	return &note, nil
}

// GetNoteVersion retrieves a specific version of a note.
func (s *SQLiteStore) GetNoteVersion(id string, version int) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var note Note
	var isEntity, isPinned, favorite, isCurrent int
	var validTo sql.NullInt64

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to, is_current, change_reason
		FROM notes WHERE id = ? AND version = ?
	`, id, version).Scan(
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
		&note.FolderID, &note.EntityKind, &note.EntitySubtype,
		&isEntity, &isPinned, &favorite,
		&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &note.ChangeReason,
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

		if err := rows.Scan(
			&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
			&note.FolderID, &note.EntityKind, &note.EntitySubtype,
			&isEntity, &isPinned, &favorite,
			&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
			&note.ValidFrom, &validTo, &isCurrent, &note.ChangeReason,
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
		&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
		&note.FolderID, &note.EntityKind, &note.EntitySubtype,
		&isEntity, &isPinned, &favorite,
		&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		&note.ValidFrom, &validTo, &isCurrent, &note.ChangeReason,
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

	err := s.db.QueryRow(`
		SELECT id, version, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at, valid_from, valid_to
		FROM notes WHERE id = ? AND version = ?
	`, id, version).Scan(
		&oldNote.ID, &oldNote.Version, &oldNote.WorldID, &oldNote.Title, &oldNote.Content, &oldNote.MarkdownContent,
		&oldNote.FolderID, &oldNote.EntityKind, &oldNote.EntitySubtype,
		&isEntity, &isPinned, &favorite,
		&oldNote.OwnerID, &oldNote.NarrativeID, &oldNote.Order, &oldNote.CreatedAt, &oldNote.UpdatedAt,
		&oldNote.ValidFrom, &validTo,
	)
	if err != nil {
		return err
	}

	oldNote.IsEntity = isEntity != 0
	oldNote.IsPinned = isPinned != 0
	oldNote.Favorite = favorite != 0

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

		if err := rows.Scan(
			&note.ID, &note.Version, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
			&note.FolderID, &note.EntityKind, &note.EntitySubtype,
			&isEntity, &isPinned, &favorite,
			&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
			&note.ValidFrom, &validTo, &isCurrent, &note.ChangeReason,
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

// Compile-time interface check
var _ Storer = (*SQLiteStore)(nil)
