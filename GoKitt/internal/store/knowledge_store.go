package store

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/kittclouds/gokitt/pkg/knowledge"
)

const knowledgeSchema = `
-- Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS kg_nodes_v1 (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT,
    props TEXT, -- JSON properties
    embedding BLOB, 
    created_at INTEGER
);

-- Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS kg_edges_v1 (
    source_id TEXT NOT NULL, 
    target_id TEXT NOT NULL, 
    relation TEXT NOT NULL, 
    weight REAL DEFAULT 1.0,
    props TEXT, -- JSON properties
    created_at INTEGER,
    PRIMARY KEY (source_id, target_id, relation)
);

-- Indices for fast traversal/filtering
CREATE INDEX IF NOT EXISTS idx_kg_nodes_kind ON kg_nodes_v1(kind);
CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges_v1(source_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges_v1(target_id);
`

// EnsureKnowledgeSchema creates the tables for the knowledge graph.
// This should be called during store initialization.
func (s *SQLiteStore) EnsureKnowledgeSchema() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(knowledgeSchema)
	return err
}

// -----------------------------------------------------------------------------
// Persistence Operations
// -----------------------------------------------------------------------------

// SaveKnowledgeGraph persists the entire graph state in a transaction.
// It deletes existing data and replaces it (Dump & Load pattern).
// For incremental updates, use SaveNode/SaveEdge (not implemented yet).
func (s *SQLiteStore) SaveKnowledgeGraph(g *knowledge.KnowledgeGraph) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Clear existing tables
	if _, err := tx.Exec("DELETE FROM kg_nodes_v1; DELETE FROM kg_edges_v1;"); err != nil {
		return err
	}

	// 2. Insert Nodes
	nodesStmt, err := tx.Prepare(`INSERT INTO kg_nodes_v1 (id, kind, label, props, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer nodesStmt.Close()

	now := time.Now().UnixMilli()

	// Use safe visitor pattern to iterate nodes while holding graph lock
	var visitorErr error
	g.VisitNodes(func(n *knowledge.KnowledgeNode) {
		if visitorErr != nil {
			return
		}
		propsJSON, _ := json.Marshal(n.Props)
		embedBytes, _ := json.Marshal(n.Embedding)

		_, err := nodesStmt.Exec(n.ID, n.Kind, n.Label, string(propsJSON), embedBytes, now)
		if err != nil {
			visitorErr = err
		}
	})
	if visitorErr != nil {
		return visitorErr
	}

	// 3. Insert Edges
	edgesStmt, err := tx.Prepare(`INSERT INTO kg_edges_v1 (source_id, target_id, relation, weight, props, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer edgesStmt.Close()

	g.VisitEdges(func(e *knowledge.KnowledgeEdge) {
		if visitorErr != nil {
			return
		}
		propsJSON, _ := json.Marshal(e.Props)
		_, err := edgesStmt.Exec(e.SourceID, e.TargetID, e.Relation, e.Weight, string(propsJSON), now)
		if err != nil {
			visitorErr = err
		}
	})
	if visitorErr != nil {
		return visitorErr
	}

	return tx.Commit()
}

// LoadKnowledgeGraph loads the entire graph from SQLite into memory.
func (s *SQLiteStore) LoadKnowledgeGraph() (*knowledge.KnowledgeGraph, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	g := knowledge.NewGraph()

	// 1. Load Nodes
	rows, err := s.db.Query(`SELECT id, kind, label, props, embedding FROM kg_nodes_v1`)
	if err != nil {
		// If table doesn't exist, return empty graph (first run)
		// Or should we error? Best to assume empty if new.
		// But EnsureKnowledgeSchema should have run.
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var n knowledge.KnowledgeNode
		var propsJSON, embedBytes []byte

		if err := rows.Scan(&n.ID, &n.Kind, &n.Label, &propsJSON, &embedBytes); err != nil {
			return nil, err
		}

		if len(propsJSON) > 0 {
			if err := json.Unmarshal(propsJSON, &n.Props); err != nil {
				// Log error but continue? or fail?
				// For robustness, maybe log and continue with empty props
				fmt.Printf("Error unmarshaling props for node %s: %v\n", n.ID, err)
			}
		}
		if len(embedBytes) > 0 {
			if err := json.Unmarshal(embedBytes, &n.Embedding); err != nil {
				fmt.Printf("Error unmarshaling embedding for node %s: %v\n", n.ID, err)
			}
		}
		g.AddNode(&n)
	}

	// 2. Load Edges
	eRows, err := s.db.Query(`SELECT source_id, target_id, relation, weight, props FROM kg_edges_v1`)
	if err != nil {
		return nil, err
	}
	defer eRows.Close()

	for eRows.Next() {
		var e knowledge.KnowledgeEdge
		var propsJSON []byte

		if err := eRows.Scan(&e.SourceID, &e.TargetID, &e.Relation, &e.Weight, &propsJSON); err != nil {
			return nil, err
		}

		if len(propsJSON) > 0 {
			if err := json.Unmarshal(propsJSON, &e.Props); err != nil {
				fmt.Printf("Error unmarshaling props for edge %s->%s: %v\n", e.SourceID, e.TargetID, err)
			}
		}
		g.AddEdge(&e)
	}

	return g, nil
}
