package graphstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type RuleEngine[T any] struct {
	store *SQLiteStore[T]
}

func NewRuleEngine[T any](store *SQLiteStore[T]) *RuleEngine[T] {
	return &RuleEngine[T]{store: store}
}

// Define registers a named rule.
func (r *RuleEngine[T]) Define(name string, q Query, materialize bool) error {
	qJSON, err := json.Marshal(q)
	if err != nil {
		return fmt.Errorf("marshal query: %w", err)
	}

	// Insert or Replace rule definition
	query := `INSERT INTO graph_named_rules (name, query_json, materialized, invalidated) 
	          VALUES (?, ?, ?, 1) 
	          ON CONFLICT(name) DO UPDATE SET 
	            query_json=excluded.query_json, 
	            materialized=excluded.materialized,
	            invalidated=1`

	// qJSON is []byte, cast to string for TEXT column
	_, err = r.store.db.Exec(query, name, string(qJSON), materialize)
	return err
}

// Run executes the named rule. If materialized and valid, returns cached results.
func (r *RuleEngine[T]) Run(ctx context.Context, name string) (*ResultSet, error) {
	// 1. Fetch Rule Definition
	var qJSON string
	var materialized bool
	var invalidated bool

	err := r.store.db.QueryRow("SELECT query_json, materialized, invalidated FROM graph_named_rules WHERE name = ?", name).
		Scan(&qJSON, &materialized, &invalidated)
	if err != nil {
		return nil, fmt.Errorf("rule not found: %w", err)
	}

	var q Query
	if err := json.Unmarshal([]byte(qJSON), &q); err != nil {
		return nil, fmt.Errorf("unmarshal query: %w", err)
	}

	// 2. Check Cache
	if materialized && !invalidated {
		// Return cached results
		rows, err := r.store.db.Query("SELECT row_json FROM graph_rule_results WHERE rule_name = ?", name)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var bindings []map[string]uuid.UUID
		for rows.Next() {
			var rJSON []byte
			if err := rows.Scan(&rJSON); err != nil {
				return nil, err
			}
			var row map[string]uuid.UUID
			if err := json.Unmarshal(rJSON, &row); err != nil {
				return nil, err
			}
			bindings = append(bindings, row)
		}
		return &ResultSet{Bindings: bindings}, nil
	}

	// 3. Compute
	rs, err := r.store.Execute(q)
	if err != nil {
		return nil, err
	}

	// 4. Materialize if needed
	if materialized {
		tx, err := r.store.db.Begin()
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()

		// Clear old results
		_, err = tx.Exec("DELETE FROM graph_rule_results WHERE rule_name = ?", name)
		if err != nil {
			return nil, err
		}

		// Insert new results
		stmt, err := tx.Prepare("INSERT INTO graph_rule_results (rule_name, row_json, created_at) VALUES (?, ?, ?)")
		if err != nil {
			return nil, err
		}
		defer stmt.Close()

		now := time.Now().UnixMilli()
		for _, row := range rs.Bindings {
			rowJSON, _ := json.Marshal(row)
			if _, err := stmt.Exec(name, string(rowJSON), now); err != nil {
				return nil, err
			}
		}

		// Mark Valid
		_, err = tx.Exec("UPDATE graph_named_rules SET invalidated = 0, last_run = ? WHERE name = ?", now, name)
		if err != nil {
			return nil, err
		}

		if err := tx.Commit(); err != nil {
			return nil, err
		}
	}

	return rs, nil
}

// Invalidate marks a rule as invalid.
func (r *RuleEngine[T]) Invalidate(name string) error {
	_, err := r.store.db.Exec("UPDATE graph_named_rules SET invalidated = 1 WHERE name = ?", name)
	return err
}

// CheckInvalidation checks if any rules need invalidation based on labels modified.
// This is a naive implementation; optimized version would map labels -> rules.
func (r *RuleEngine[T]) InvalidateByLabel(label string) error {
	// For now, invalidate ALL rules? Or try to parse query to find label dependency?
	// Parsing is hard. Simplest: Invalidate all.
	// User prompt: "wired into your AddVertex/AddEdge write path."
	// Let's assume user wants broad invalidation or we assume rules depend on labels.
	// Let's just invalidate all for safety in this scope.
	_, err := r.store.db.Exec("UPDATE graph_named_rules SET invalidated = 1")
	return err
}
