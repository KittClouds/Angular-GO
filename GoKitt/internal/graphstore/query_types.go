package graphstore

import (
	"github.com/google/uuid"
)

type NodePattern struct {
	Var         string               // binding variable name, e.g. "a"
	IDFilter    *uuid.UUID           // nil = wildcard
	PropFilter  map[string]PropValue // must match all
	LabelFilter []string
}

type EdgePattern struct {
	Var        string
	SourceVar  string // references NodePattern.Var
	TargetVar  string
	PropFilter map[string]PropValue
	MinHops    int // 1 = single, 2+ = multi-hop
	MaxHops    int // -1 = unbounded (recursive)
}

// FilterExpr is a placeholder for post-match filters.
type FilterExpr interface {
	// Eval(binding map[string]uuid.UUID, store *SQLiteStore[T]) bool
}

type Query struct {
	Patterns []NodePattern
	Edges    []EdgePattern
	Filters  []FilterExpr // post-match predicates
	Limit    int
	OrderBy  string
}

type ResultSet struct {
	Bindings []map[string]uuid.UUID // var name → resolved ID (Array of results)
	Props    map[string]PropValue   // projected properties (Wait, ResultSet structure is usually rows)
}

// Simplified ResultSet for now:
// List of rows, each row is a map from Var -> UUID.
// We can attach properties later or fetch on demand.
