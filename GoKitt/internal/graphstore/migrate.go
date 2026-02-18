package graphstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/embed"
)

// OpenDB opens a connection to the SQLite database with optimal settings for WAL mode and strict consistency.
func OpenDB(path string) (*sql.DB, error) {
	// Construct DSN ensuring "file:" prefix and correct query parameter joining.
	var dsn string
	if strings.HasPrefix(path, "file:") {
		dsn = path
	} else {
		dsn = "file:" + path
	}

	if strings.Contains(dsn, "?") {
		dsn += "&"
	} else {
		dsn += "?"
	}

	// WAL mode allows concurrent readers.
	// synchronous=NORMAL is safe for WAL mode and faster.
	// foreign_keys=ON is crucial for graph integrity.
	// busy_timeout=5000 waits up to 5s if the DB is locked.
	dsn += "_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)"

	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}

	// ncruces Wasm runtime is single-threaded for writes in this configuration.
	// Preventing concurrent writes avoids "database is locked" errors and simplifies logic.
	db.SetMaxOpenConns(1)

	return db, nil
}

// Migrate ensures the schema exists.
func Migrate(ctx context.Context, db *sql.DB) error {
	// 1. Define Queries for NEW tables or idempotent creation
	queries := []string{
		`CREATE TABLE IF NOT EXISTS graph_vertices (
			id         TEXT PRIMARY KEY,          -- uuid.UUID.String()
			value      BLOB    NOT NULL,          -- JSON-encoded T
			weight     INTEGER NOT NULL DEFAULT 0,
			attributes TEXT    NOT NULL DEFAULT '{}'  -- JSON map[string]string
		) STRICT;`,
		`CREATE TABLE IF NOT EXISTS graph_edges (
			source_id  TEXT NOT NULL REFERENCES graph_vertices(id),
			target_id  TEXT NOT NULL REFERENCES graph_vertices(id),
			weight     INTEGER NOT NULL DEFAULT 0,
			attributes TEXT    NOT NULL DEFAULT '{}',
			data       BLOB,                          -- graph.EdgeProperties.Data (any → JSON)
			edge_type  TEXT NOT NULL DEFAULT 'default',
			PRIMARY KEY (source_id, target_id)
		) STRICT;`,
		`CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);`,
		`CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);`,
		`CREATE INDEX IF NOT EXISTS idx_graph_edge_type ON graph_edges(edge_type);`,
		`CREATE TABLE IF NOT EXISTS graph_node_index (
			id  TEXT PRIMARY KEY,
			idx INTEGER NOT NULL UNIQUE
		) STRICT;`,
		// Properties table updated to include temporal columns and Composite PK with valid_from
		`CREATE TABLE IF NOT EXISTS graph_properties (
			owner_id   TEXT NOT NULL,
			owner_type TEXT NOT NULL CHECK(owner_type IN ('vertex','edge')),
			key        TEXT NOT NULL,
			value_type TEXT NOT NULL CHECK(value_type IN ('string','int','float','bool','json','uuid','timestamp')),
			value_blob BLOB NOT NULL,
			valid_from INTEGER NOT NULL, -- Unix ms
			valid_until INTEGER,         -- Unix ms, NULL = valid
			txn_id     INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (owner_id, owner_type, key, valid_from)
		) STRICT;`,
		`CREATE INDEX IF NOT EXISTS idx_graph_props_key_value ON graph_properties(key, value_blob);`,
		`CREATE INDEX IF NOT EXISTS idx_graph_props_temporal ON graph_properties(owner_id, key, valid_from, valid_until);`,
		`CREATE TABLE IF NOT EXISTS graph_vertex_labels (
			vertex_id    TEXT NOT NULL,
			label        TEXT NOT NULL,
			PRIMARY KEY (vertex_id, label)
		) STRICT;`,
		`CREATE INDEX IF NOT EXISTS idx_graph_label_vertex ON graph_vertex_labels(label, vertex_id);`,
		// Named Rules
		`CREATE TABLE IF NOT EXISTS graph_named_rules (
			name        TEXT PRIMARY KEY,
			query_json  TEXT NOT NULL,
			materialized INTEGER NOT NULL DEFAULT 0,
			last_run    INTEGER,
			invalidated INTEGER NOT NULL DEFAULT 1
		) STRICT;`,
		// Rule Results
		`CREATE TABLE IF NOT EXISTS graph_rule_results (
			rule_name   TEXT NOT NULL REFERENCES graph_named_rules(name) ON DELETE CASCADE,
			row_json    TEXT NOT NULL,
			created_at  INTEGER NOT NULL
		) STRICT;`,
		`CREATE INDEX IF NOT EXISTS idx_graph_rule_results_name ON graph_rule_results(rule_name);`,
	}

	for _, query := range queries {
		if _, err := db.ExecContext(ctx, query); err != nil {
			// Special handling for properties table migration (PK change)
			// If table exists but has old schema, duplication error or missing column info might occur depending on query.
			// Since we use IF NOT EXISTS, it skips if table exists.
			// We need to Detect if properties table is OLD version.
			if strings.Contains(query, "CREATE TABLE IF NOT EXISTS graph_properties") {
				// Check if valid_from exists
				_, colErr := db.Exec("SELECT valid_from FROM graph_properties LIMIT 1")
				if colErr != nil {
					// Column missing, implying old schema. REBUILD.
					// Rename old
					if _, err := db.Exec("ALTER TABLE graph_properties RENAME TO graph_properties_old"); err != nil {
						return fmt.Errorf("failed to rename old graph_properties: %w", err)
					}
					// Create new (retry the query)
					if _, err := db.Exec(query); err != nil {
						return fmt.Errorf("failed to create new graph_properties: %w", err)
					}
					// Copy data (Set valid_from = 0, valid_until = NULL)
					// Warning: old table PK was (owner_id, owner_type, key), new includes valid_from.
					// Since valid_from is constant 0 here, it maps 1:1.
					// But we need to handle potential dupes if any? No, old PK guarantees unique (owner, type, key).
					copySQL := `INSERT INTO graph_properties (owner_id, owner_type, key, value_type, value_blob, valid_from, valid_until, txn_id)
						        SELECT owner_id, owner_type, key, value_type, value_blob, 0, NULL, 0 FROM graph_properties_old`
					if _, err := db.Exec(copySQL); err != nil {
						return fmt.Errorf("failed to migrate attributes: %w", err)
					}
					// Drop old
					db.Exec("DROP TABLE graph_properties_old")
				}
			} else {
				return err
			}
		}
	}

	return nil
}
