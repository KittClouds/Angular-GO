// Package store provides SQLite-backed persistence for GoKitt.
// Uses ncruces/go-sqlite3/driver which provides a database/sql interface.
package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
)

// SQLiteStore is the SQLite-backed data store.
// Thread-safe for concurrent WASM callbacks.
type SQLiteStore struct {
	mu sync.RWMutex
	db *sql.DB
}

// schema defines all tables for the unified data layer.
const schema = `
-- Notes (JSON doc store pattern)
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
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
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_narrative ON notes(narrative_id);

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

// UpsertNote inserts or updates a note.
func (s *SQLiteStore) UpsertNote(note *Note) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(`
		INSERT INTO notes (id, world_id, title, content, markdown_content, folder_id, 
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id, 
			narrative_id, "order", created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			world_id = excluded.world_id,
			title = excluded.title,
			content = excluded.content,
			markdown_content = excluded.markdown_content,
			folder_id = excluded.folder_id,
			entity_kind = excluded.entity_kind,
			entity_subtype = excluded.entity_subtype,
			is_entity = excluded.is_entity,
			is_pinned = excluded.is_pinned,
			favorite = excluded.favorite,
			owner_id = excluded.owner_id,
			narrative_id = excluded.narrative_id,
			"order" = excluded."order",
			updated_at = excluded.updated_at
	`, note.ID, note.WorldID, note.Title, note.Content, note.MarkdownContent,
		note.FolderID, note.EntityKind, note.EntitySubtype,
		boolToInt(note.IsEntity), boolToInt(note.IsPinned), boolToInt(note.Favorite),
		note.OwnerID, note.NarrativeID, note.Order, note.CreatedAt, note.UpdatedAt)

	return err
}

// GetNote retrieves a note by ID.
func (s *SQLiteStore) GetNote(id string) (*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var note Note
	var isEntity, isPinned, favorite int

	err := s.db.QueryRow(`
		SELECT id, world_id, title, content, markdown_content, folder_id,
			entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
			narrative_id, "order", created_at, updated_at
		FROM notes WHERE id = ?
	`, id).Scan(
		&note.ID, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
		&note.FolderID, &note.EntityKind, &note.EntitySubtype,
		&isEntity, &isPinned, &favorite,
		&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
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

	return &note, nil
}

// DeleteNote removes a note by ID.
func (s *SQLiteStore) DeleteNote(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM notes WHERE id = ?", id)
	return err
}

// ListNotes returns all notes, optionally filtered by folder.
func (s *SQLiteStore) ListNotes(folderID string) ([]*Note, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var rows *sql.Rows
	var err error

	if folderID != "" {
		rows, err = s.db.Query(`
			SELECT id, world_id, title, content, markdown_content, folder_id,
				entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
				narrative_id, "order", created_at, updated_at
			FROM notes WHERE folder_id = ? ORDER BY "order"
		`, folderID)
	} else {
		rows, err = s.db.Query(`
			SELECT id, world_id, title, content, markdown_content, folder_id,
				entity_kind, entity_subtype, is_entity, is_pinned, favorite, owner_id,
				narrative_id, "order", created_at, updated_at
			FROM notes ORDER BY "order"
		`)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notes []*Note
	for rows.Next() {
		var note Note
		var isEntity, isPinned, favorite int

		if err := rows.Scan(
			&note.ID, &note.WorldID, &note.Title, &note.Content, &note.MarkdownContent,
			&note.FolderID, &note.EntityKind, &note.EntitySubtype,
			&isEntity, &isPinned, &favorite,
			&note.OwnerID, &note.NarrativeID, &note.Order, &note.CreatedAt, &note.UpdatedAt,
		); err != nil {
			return nil, err
		}

		note.IsEntity = isEntity != 0
		note.IsPinned = isPinned != 0
		note.Favorite = favorite != 0
		notes = append(notes, &note)
	}

	return notes, rows.Err()
}

// CountNotes returns the total number of notes.
func (s *SQLiteStore) CountNotes() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var count int
	err := s.db.QueryRow("SELECT COUNT(*) FROM notes").Scan(&count)
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
