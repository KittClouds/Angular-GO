// Package gldr provides Graph-based Lexical Document Retrieval.
// It fuses qgram BM25 lexical scoring with graph proximity scoring
// from entity relationships, providing embedding-free retrieval for Graptor.
package gldr

import "github.com/kittclouds/gokitt/pkg/qgram"

// EntityMention records an entity occurrence in a chunk.
type EntityMention struct {
	EntityID   string  // Canonical entity ID
	Confidence float64 // Discovery confidence (1.0 for known entities)
	Start      int     // Character offset in chunk
	End        int     // End offset
}

// GraphEdge is a lightweight edge descriptor used by GLDR's public API.
// Internally, edges are stored in the GraphStore.
type GraphEdge struct {
	TargetID   string  // Target entity ID
	RelType    string  // Relationship type (e.g., "cooccurs", "fights")
	Confidence float64 // Edge confidence
	Source     string  // "explicit" | "inferred" | "cooccurrence"

	// Temporal tracking (optional)
	ValidFrom  *TemporalMarker `json:"validFrom,omitempty"`  // When edge becomes valid
	ValidUntil *TemporalMarker `json:"validUntil,omitempty"` // When edge expires (nil = still valid)
}

// IsValidAt checks if the edge was valid at a given temporal marker.
// Returns true if the edge has no temporal bounds or if the marker falls within bounds.
func (e *GraphEdge) IsValidAt(marker *TemporalMarker) (bool, error) {
	// No temporal bounds = always valid
	if e.ValidFrom == nil && e.ValidUntil == nil {
		return true, nil
	}

	// Check valid from
	if e.ValidFrom != nil && !e.ValidFrom.IsZero() {
		cmp, err := e.ValidFrom.Compare(marker)
		if err != nil {
			return false, err
		}
		if cmp > 0 {
			return false, nil // Edge starts after marker
		}
	}

	// Check valid until
	if e.ValidUntil != nil && !e.ValidUntil.IsZero() {
		cmp, err := e.ValidUntil.Compare(marker)
		if err != nil {
			return false, err
		}
		if cmp < 0 {
			return false, nil // Edge ended before marker
		}
	}

	return true, nil
}

// IsTimeless returns true if the edge has no temporal bounds.
func (e *GraphEdge) IsTimeless() bool {
	return (e.ValidFrom == nil || e.ValidFrom.IsZero()) &&
		(e.ValidUntil == nil || e.ValidUntil.IsZero())
}

// EntityAnchor represents an anchored entity for graph traversal.
type EntityAnchor struct {
	EntityID   string  // Canonical entity ID
	Confidence float64 // 1.0 for direct, <1.0 for soft
	Source     string  // "direct" | "soft"
}

// GLDRQuery represents a parsed query with entity anchors.
type GLDRQuery struct {
	RawText       string
	DirectAnchors []EntityAnchor // Entities found via canonicalization
	SoftAnchors   []EntityAnchor // Entities from chunk-based lookup
	Clauses       []qgram.Clause // Parsed lexical clauses
}

// AllAnchors returns direct + soft anchors merged.
func (q *GLDRQuery) AllAnchors() []EntityAnchor {
	if len(q.DirectAnchors) > 0 {
		return q.DirectAnchors
	}
	return q.SoftAnchors
}

// HasDirectAnchors returns true if any direct anchors were found.
func (q *GLDRQuery) HasDirectAnchors() bool {
	return len(q.DirectAnchors) > 0
}

// GLDRResult represents a scored chunk result.
type GLDRResult struct {
	ChunkID         string        // Chunk document ID
	ChunkScore      float64       // Fused score (for ranking)
	LexScore        float64       // Raw lexical BM25 score
	GraphScore      float64       // Raw graph proximity score
	MatchedEntities []EntityMatch // Entity attribution
}

// EntityMatch records why an entity matched.
type EntityMatch struct {
	EntityID     string  // Canonical entity ID
	Proximity    float64 // Graph proximity from anchor
	MentionCount int     // Times mentioned in chunk
}

// NodeResult represents a ranked entity/node.
type NodeResult struct {
	EntityID           string   // Canonical entity ID
	NodeScore          float64  // Combined score
	TopChunks          []string // Top supporting chunk IDs
	ProximityFromQuery float64  // Graph distance from anchors
}
