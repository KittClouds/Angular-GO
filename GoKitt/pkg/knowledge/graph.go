package knowledge

import (
	"encoding/json"
	"fmt"
	"sync"
)

// Node Kinds
const (
	KindUniverse    = "Universe"
	KindGalaxy      = "Galaxy"
	KindSolarSystem = "SolarSystem"
	KindWorld       = "World"
	KindConcept     = "Concept"
	KindChunk       = "Chunk" // For RAG/Raptor
)

// Edge Relations
const (
	RelContains = "CONTAINS"
	RelRelated  = "RELATED_TO"
	RelNext     = "NEXT"
	RelEmbeds   = "EMBEDS" // e.g. World embeds Chunk
)

// KnowledgeNode represents a node in the persistent knowledge graph.
// Unlike the lightweight ConceptNode in pkg/graph, this supports arbitrary properties.
type KnowledgeNode struct {
	ID        string                 `json:"id"`
	Kind      string                 `json:"kind"`
	Label     string                 `json:"label"`
	Embedding []float32              `json:"embedding,omitempty"`
	Props     map[string]interface{} `json:"props,omitempty"`
}

// KnowledgeEdge represents a directed relationship with properties.
type KnowledgeEdge struct {
	SourceID string                 `json:"source"`
	TargetID string                 `json:"target"`
	Relation string                 `json:"relation"`
	Weight   float64                `json:"weight"`
	Props    map[string]interface{} `json:"props,omitempty"`
}

// KnowledgeGraph is the in-memory representation of the persistent graph.
// It uses pointer-based adjacency lists for fast traversal.
type KnowledgeGraph struct {
	mu    sync.RWMutex
	Nodes map[string]*KnowledgeNode
	// Adjacency lists: SourceID -> []Edge
	OutboundEdges map[string][]*KnowledgeEdge
	InboundEdges  map[string][]*KnowledgeEdge
}

// NewGraph creates an empty knowledge graph.
func NewGraph() *KnowledgeGraph {
	return &KnowledgeGraph{
		Nodes:         make(map[string]*KnowledgeNode),
		OutboundEdges: make(map[string][]*KnowledgeEdge),
		InboundEdges:  make(map[string][]*KnowledgeEdge),
	}
}

// -----------------------------------------------------------------------------
// Node Operations
// -----------------------------------------------------------------------------

// AddNode adds or updates a node in the graph.
func (g *KnowledgeGraph) AddNode(node *KnowledgeNode) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.Nodes[node.ID] = node
}

// GetNode retrieves a node by ID.
func (g *KnowledgeGraph) GetNode(id string) (*KnowledgeNode, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	n, ok := g.Nodes[id]
	return n, ok
}

// DeleteNode removes a node and all its connected edges.
func (g *KnowledgeGraph) DeleteNode(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Remove external references first (edges pointing to/from this node)
	// This is O(E) in worst case if we don't have inbound index, but we do.

	// Remove outbound edges
	delete(g.OutboundEdges, id)

	// Remove inbound edges (requires scanning inbound index for edges pointing to id)
	// Optimization: Iterate inbound edges of known neighbors if we tracked them,
	// but here we just use the InboundEdges map.
	if edges, ok := g.InboundEdges[id]; ok {
		for _, e := range edges {
			// e.SourceID points to id. Remove e from e.SourceID's outbound list.
			g.removeOutboundEdge(e.SourceID, e)
		}
		delete(g.InboundEdges, id)
	}

	delete(g.Nodes, id)
}

// FilterNodes returns all nodes matching the predicate function.
func (g *KnowledgeGraph) FilterNodes(predicate func(*KnowledgeNode) bool) []*KnowledgeNode {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var results []*KnowledgeNode
	for _, n := range g.Nodes {
		if predicate(n) {
			results = append(results, n)
		}
	}
	return results
}

// -----------------------------------------------------------------------------
// Edge Operations
// -----------------------------------------------------------------------------

// AddEdge adds a directed edge. It creates nodes if they don't exist (with minimal info).
func (g *KnowledgeGraph) AddEdge(edge *KnowledgeEdge) {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Ensure nodes exist
	if _, ok := g.Nodes[edge.SourceID]; !ok {
		g.Nodes[edge.SourceID] = &KnowledgeNode{ID: edge.SourceID, Kind: KindConcept}
	}
	if _, ok := g.Nodes[edge.TargetID]; !ok {
		g.Nodes[edge.TargetID] = &KnowledgeNode{ID: edge.TargetID, Kind: KindConcept}
	}

	g.OutboundEdges[edge.SourceID] = append(g.OutboundEdges[edge.SourceID], edge)
	g.InboundEdges[edge.TargetID] = append(g.InboundEdges[edge.TargetID], edge)
}

// GetEdges returns pointers to edges matching the criteria.
// relation can be empty to match all.
func (g *KnowledgeGraph) GetEdges(sourceID, targetID, relation string) []*KnowledgeEdge {
	g.mu.RLock()
	defer g.mu.RUnlock()

	var matched []*KnowledgeEdge
	// Use outbound index for speed
	if edges, ok := g.OutboundEdges[sourceID]; ok {
		for _, e := range edges {
			if (targetID == "" || e.TargetID == targetID) &&
				(relation == "" || e.Relation == relation) {
				matched = append(matched, e)
			}
		}
	}
	return matched
}

// VisitNodes iterates over all nodes in a thread-safe manner.
func (g *KnowledgeGraph) VisitNodes(visitor func(*KnowledgeNode)) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	for _, n := range g.Nodes {
		visitor(n)
	}
}

// VisitEdges iterates over all edges in a thread-safe manner.
func (g *KnowledgeGraph) VisitEdges(visitor func(*KnowledgeEdge)) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	for _, edges := range g.OutboundEdges {
		for _, e := range edges {
			visitor(e)
		}
	}
}

// helper to remove edge from list
func (g *KnowledgeGraph) removeOutboundEdge(sourceID string, edgeToRemove *KnowledgeEdge) {
	edges := g.OutboundEdges[sourceID]
	for i, e := range edges {
		if e == edgeToRemove {
			// Fast delete (swap with last)
			lastIdx := len(edges) - 1
			edges[i] = edges[lastIdx]
			g.OutboundEdges[sourceID] = edges[:lastIdx]
			return
		}
	}
}

// -----------------------------------------------------------------------------
// Serialization
// -----------------------------------------------------------------------------

// ToJSON serializes the entire graph for persistence.
func (g *KnowledgeGraph) ToJSON() ([]byte, error) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	// Flatten edges
	var allEdges []*KnowledgeEdge
	for _, edges := range g.OutboundEdges {
		allEdges = append(allEdges, edges...)
	}

	data := struct {
		Nodes map[string]*KnowledgeNode `json:"nodes"`
		Edges []*KnowledgeEdge          `json:"edges"`
	}{
		Nodes: g.Nodes,
		Edges: allEdges,
	}

	return json.Marshal(data)
}

// FromJSON loads graph from JSON.
// WARNING: This replaces the current graph content.
func (g *KnowledgeGraph) FromJSON(data []byte) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	var loaded struct {
		Nodes map[string]*KnowledgeNode `json:"nodes"`
		Edges []*KnowledgeEdge          `json:"edges"`
	}

	if err := json.Unmarshal(data, &loaded); err != nil {
		return fmt.Errorf("failed to unmarshal graph: %w", err)
	}

	g.Nodes = loaded.Nodes
	g.OutboundEdges = make(map[string][]*KnowledgeEdge)
	g.InboundEdges = make(map[string][]*KnowledgeEdge)

	// Rebuild indices
	for _, edge := range loaded.Edges {
		g.OutboundEdges[edge.SourceID] = append(g.OutboundEdges[edge.SourceID], edge)
		g.InboundEdges[edge.TargetID] = append(g.InboundEdges[edge.TargetID], edge)
	}

	return nil
}
