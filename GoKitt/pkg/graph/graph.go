// Package graph provides a lightweight semantic graph for narrative analysis.
// Custom implementation optimized for TinyGo WASM binary size.
package graph

import "strings"

// ConceptNode represents an entity in the graph
type ConceptNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

// ConceptEdge represents a relationship between concepts
type ConceptEdge struct {
	Relation   string  `json:"relation"`
	Weight     float64 `json:"weight"`
	SourceDoc  string  `json:"sourceDoc"`
	SourceSpan [2]int  `json:"sourceSpan"`
}

// ConceptGraph is a directed semantic graph
type ConceptGraph struct {
	// Node storage: ID -> Node
	Nodes map[string]*ConceptNode `json:"nodes"`

	// Adjacency lists: SourceID -> TargetID -> Edge
	Outbound map[string]map[string]*ConceptEdge `json:"outbound"`
	Inbound  map[string]map[string]*ConceptEdge `json:"inbound"`
}

// NewGraph creates an empty graph
func NewGraph() *ConceptGraph {
	return &ConceptGraph{
		Nodes:    make(map[string]*ConceptNode),
		Outbound: make(map[string]map[string]*ConceptEdge),
		Inbound:  make(map[string]map[string]*ConceptEdge),
	}
}

// EnsureNode adds a node if it doesn't exist, returns existing node otherwise
func (g *ConceptGraph) EnsureNode(id, label, kind string) *ConceptNode {
	if existing, exists := g.Nodes[id]; exists {
		return existing
	}

	node := &ConceptNode{
		ID:    id,
		Label: label,
		Kind:  kind,
	}
	g.Nodes[id] = node
	return node
}

// AddEdge creates a directed edge from source to target
func (g *ConceptGraph) AddEdge(sourceID, targetID string, edge *ConceptEdge) {
	// Ensure outbound map exists
	if g.Outbound[sourceID] == nil {
		g.Outbound[sourceID] = make(map[string]*ConceptEdge)
	}
	g.Outbound[sourceID][targetID] = edge

	// Maintain reverse index
	if g.Inbound[targetID] == nil {
		g.Inbound[targetID] = make(map[string]*ConceptEdge)
	}
	g.Inbound[targetID][sourceID] = edge
}

// AddEdgeWithNodes creates nodes if needed, then adds edge
func (g *ConceptGraph) AddEdgeWithNodes(
	sourceID, sourceLabel, sourceKind string,
	targetID, targetLabel, targetKind string,
	relation string,
	weight float64,
) {
	g.EnsureNode(sourceID, sourceLabel, sourceKind)
	g.EnsureNode(targetID, targetLabel, targetKind)

	edge := &ConceptEdge{
		Relation: strings.ToUpper(relation),
		Weight:   weight,
	}
	g.AddEdge(sourceID, targetID, edge)
}

// GetNode retrieves a node by ID
func (g *ConceptGraph) GetNode(id string) *ConceptNode {
	return g.Nodes[id]
}

// OutgoingEdges returns all edges originating from a node
func (g *ConceptGraph) OutgoingEdges(id string) []struct {
	Target *ConceptNode
	Edge   *ConceptEdge
} {
	edges := g.Outbound[id]
	if edges == nil {
		return nil
	}

	result := make([]struct {
		Target *ConceptNode
		Edge   *ConceptEdge
	}, 0, len(edges))

	for targetID, edge := range edges {
		if target := g.Nodes[targetID]; target != nil {
			result = append(result, struct {
				Target *ConceptNode
				Edge   *ConceptEdge
			}{target, edge})
		}
	}
	return result
}

// IncomingEdges returns all edges pointing to a node
func (g *ConceptGraph) IncomingEdges(id string) []struct {
	Source *ConceptNode
	Edge   *ConceptEdge
} {
	edges := g.Inbound[id]
	if edges == nil {
		return nil
	}

	result := make([]struct {
		Source *ConceptNode
		Edge   *ConceptEdge
	}, 0, len(edges))

	for sourceID, edge := range edges {
		if source := g.Nodes[sourceID]; source != nil {
			result = append(result, struct {
				Source *ConceptNode
				Edge   *ConceptEdge
			}{source, edge})
		}
	}
	return result
}

// Neighbors returns all nodes connected to the given node (both directions)
func (g *ConceptGraph) Neighbors(id string) []*ConceptNode {
	seen := make(map[string]bool)
	var result []*ConceptNode

	// Outbound neighbors
	for targetID := range g.Outbound[id] {
		if !seen[targetID] {
			seen[targetID] = true
			if node := g.Nodes[targetID]; node != nil {
				result = append(result, node)
			}
		}
	}

	// Inbound neighbors
	for sourceID := range g.Inbound[id] {
		if !seen[sourceID] {
			seen[sourceID] = true
			if node := g.Nodes[sourceID]; node != nil {
				result = append(result, node)
			}
		}
	}

	return result
}

// NodeCount returns the number of nodes
func (g *ConceptGraph) NodeCount() int {
	return len(g.Nodes)
}

// EdgeCount returns the number of edges
func (g *ConceptGraph) EdgeCount() int {
	count := 0
	for _, targets := range g.Outbound {
		count += len(targets)
	}
	return count
}

// AllNodes returns an iterator-style slice of all nodes
func (g *ConceptGraph) AllNodes() []*ConceptNode {
	result := make([]*ConceptNode, 0, len(g.Nodes))
	for _, node := range g.Nodes {
		result = append(result, node)
	}
	return result
}

// AllEdges returns all edges as (source, target, edge) tuples
func (g *ConceptGraph) AllEdges() []struct {
	Source *ConceptNode
	Target *ConceptNode
	Edge   *ConceptEdge
} {
	var result []struct {
		Source *ConceptNode
		Target *ConceptNode
		Edge   *ConceptEdge
	}

	for sourceID, targets := range g.Outbound {
		source := g.Nodes[sourceID]
		if source == nil {
			continue
		}
		for targetID, edge := range targets {
			target := g.Nodes[targetID]
			if target == nil {
				continue
			}
			result = append(result, struct {
				Source *ConceptNode
				Target *ConceptNode
				Edge   *ConceptEdge
			}{source, target, edge})
		}
	}
	return result
}

// Clear removes all nodes and edges
func (g *ConceptGraph) Clear() {
	g.Nodes = make(map[string]*ConceptNode)
	g.Outbound = make(map[string]map[string]*ConceptEdge)
	g.Inbound = make(map[string]map[string]*ConceptEdge)
}

// DegreeCentrality computes (in+out)/(2*(n-1)) for each node
func (g *ConceptGraph) DegreeCentrality() map[string]float64 {
	n := len(g.Nodes)
	if n <= 1 {
		result := make(map[string]float64)
		for id := range g.Nodes {
			result[id] = 0.0
		}
		return result
	}

	normalizer := 2.0 * float64(n-1)
	result := make(map[string]float64, n)

	for id := range g.Nodes {
		outDegree := len(g.Outbound[id])
		inDegree := len(g.Inbound[id])
		result[id] = float64(outDegree+inDegree) / normalizer
	}

	return result
}

// OrphanNodes returns nodes with no connections
func (g *ConceptGraph) OrphanNodes() []*ConceptNode {
	var orphans []*ConceptNode
	for id, node := range g.Nodes {
		if len(g.Outbound[id]) == 0 && len(g.Inbound[id]) == 0 {
			orphans = append(orphans, node)
		}
	}
	return orphans
}
