// Package graph provides a lightweight semantic graph for narrative analysis.
// Custom implementation optimized for TinyGo WASM binary size.
package graph

import "strings"

// ConceptNode represents an entity in the graph
type ConceptNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`

	// Adjacency lists (Pointer-based)
	Outbound []*ConceptEdge `json:"-"` // prevent recursion in JSON
	Inbound  []*ConceptEdge `json:"-"`
}

// ConceptEdge represents a relationship between concepts
type ConceptEdge struct {
	Relation   string  `json:"relation"`
	Weight     float64 `json:"weight"`
	SourceDoc  string  `json:"sourceDoc"`
	SourceSpan [2]int  `json:"sourceSpan"`

	// QuadPlus modifiers
	Manner    string `json:"manner,omitempty"`
	Location  string `json:"location,omitempty"`
	Time      string `json:"time,omitempty"`
	Recipient string `json:"recipient,omitempty"`

	// Pointers to nodes
	Source *ConceptNode `json:"-"`
	Target *ConceptNode `json:"-"`
}

// ConceptGraph is a directed semantic graph
type ConceptGraph struct {
	// Node storage: ID -> Node
	Nodes map[string]*ConceptNode `json:"nodes"`
	// Edge list for serialization (populated by ToSerializable)
	Edges []*SerializableEdge `json:"edges,omitempty"`
}

// SerializableEdge is a JSON-friendly edge representation
type SerializableEdge struct {
	Source    string  `json:"source"`
	Target    string  `json:"target"`
	Relation  string  `json:"relation"`
	Weight    float64 `json:"weight"`
	Manner    string  `json:"manner,omitempty"`
	Location  string  `json:"location,omitempty"`
	Time      string  `json:"time,omitempty"`
	Recipient string  `json:"recipient,omitempty"`
}

// NewGraph creates an empty graph
func NewGraph() *ConceptGraph {
	return &ConceptGraph{
		Nodes: make(map[string]*ConceptNode),
		Edges: make([]*SerializableEdge, 0),
	}
}

// ToSerializable populates the Edges slice from node adjacency lists
func (g *ConceptGraph) ToSerializable() {
	g.Edges = make([]*SerializableEdge, 0)
	for _, node := range g.Nodes {
		for _, edge := range node.Outbound {
			g.Edges = append(g.Edges, &SerializableEdge{
				Source:    edge.Source.ID,
				Target:    edge.Target.ID,
				Relation:  edge.Relation,
				Weight:    edge.Weight,
				Manner:    edge.Manner,
				Location:  edge.Location,
				Time:      edge.Time,
				Recipient: edge.Recipient,
			})
		}
	}
}

// EnsureNode adds a node if it doesn't exist, returns existing node otherwise
func (g *ConceptGraph) EnsureNode(id, label, kind string) *ConceptNode {
	if existing, exists := g.Nodes[id]; exists {
		return existing
	}

	node := &ConceptNode{
		ID:       id,
		Label:    label,
		Kind:     kind,
		Outbound: make([]*ConceptEdge, 0),
		Inbound:  make([]*ConceptEdge, 0),
	}
	g.Nodes[id] = node
	return node
}

// AddEdge creates a directed edge from source to target
func (g *ConceptGraph) AddEdge(source *ConceptNode, target *ConceptNode, edge *ConceptEdge) {
	edge.Source = source
	edge.Target = target

	source.Outbound = append(source.Outbound, edge)
	target.Inbound = append(target.Inbound, edge)
}

// AddEdgeWithNodes creates nodes if needed, then adds edge
func (g *ConceptGraph) AddEdgeWithNodes(
	sourceID, sourceLabel, sourceKind string,
	targetID, targetLabel, targetKind string,
	relation string,
	weight float64,
) {
	g.AddQuad(sourceID, sourceLabel, sourceKind, targetID, targetLabel, targetKind, relation, weight, "", "", "")
}

// AddQuad adds an edge with detailed modifiers (Manner, Location, Time)
func (g *ConceptGraph) AddQuad(
	sourceID, sourceLabel, sourceKind string,
	targetID, targetLabel, targetKind string,
	relation string,
	weight float64,
	manner, location, time string,
) {
	g.AddQuadPlus(sourceID, sourceLabel, sourceKind, targetID, targetLabel, targetKind, relation, weight, manner, location, time, "")
}

// AddQuadPlus adds an edge with all modifiers including Recipient
func (g *ConceptGraph) AddQuadPlus(
	sourceID, sourceLabel, sourceKind string,
	targetID, targetLabel, targetKind string,
	relation string,
	weight float64,
	manner, location, time, recipient string,
) {
	source := g.EnsureNode(sourceID, sourceLabel, sourceKind)
	target := g.EnsureNode(targetID, targetLabel, targetKind)

	edge := &ConceptEdge{
		Relation:  strings.ToUpper(relation),
		Weight:    weight,
		Manner:    manner,
		Location:  location,
		Time:      time,
		Recipient: recipient,
	}
	g.AddEdge(source, target, edge)
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
	node := g.Nodes[id]
	if node == nil {
		return nil
	}

	result := make([]struct {
		Target *ConceptNode
		Edge   *ConceptEdge
	}, len(node.Outbound))

	for i, edge := range node.Outbound {
		result[i] = struct {
			Target *ConceptNode
			Edge   *ConceptEdge
		}{edge.Target, edge}
	}
	return result
}

// IncomingEdges returns all edges pointing to a node
func (g *ConceptGraph) IncomingEdges(id string) []struct {
	Source *ConceptNode
	Edge   *ConceptEdge
} {
	node := g.Nodes[id]
	if node == nil {
		return nil
	}

	result := make([]struct {
		Source *ConceptNode
		Edge   *ConceptEdge
	}, len(node.Inbound))

	for i, edge := range node.Inbound {
		result[i] = struct {
			Source *ConceptNode
			Edge   *ConceptEdge
		}{edge.Source, edge}
	}
	return result
}

// Neighbors returns all nodes connected to the given node (both directions)
func (g *ConceptGraph) Neighbors(id string) []*ConceptNode {
	node := g.Nodes[id]
	if node == nil {
		return nil
	}

	seen := make(map[string]bool)
	var result []*ConceptNode

	// Outbound
	for _, edge := range node.Outbound {
		if !seen[edge.Target.ID] {
			seen[edge.Target.ID] = true
			result = append(result, edge.Target)
		}
	}
	// Inbound
	for _, edge := range node.Inbound {
		if !seen[edge.Source.ID] {
			seen[edge.Source.ID] = true
			result = append(result, edge.Source)
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
	for _, node := range g.Nodes {
		count += len(node.Outbound)
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

	// Iterate nodes to find all outbound edges
	for _, node := range g.Nodes {
		for _, edge := range node.Outbound {
			result = append(result, struct {
				Source *ConceptNode
				Target *ConceptNode
				Edge   *ConceptEdge
			}{node, edge.Target, edge})
		}
	}
	return result
}

// Clear removes all nodes and edges
func (g *ConceptGraph) Clear() {
	g.Nodes = make(map[string]*ConceptNode)
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

	for id, node := range g.Nodes {
		outDegree := len(node.Outbound)
		inDegree := len(node.Inbound)
		result[id] = float64(outDegree+inDegree) / normalizer
	}

	return result
}

// OrphanNodes returns nodes with no connections
func (g *ConceptGraph) OrphanNodes() []*ConceptNode {
	var orphans []*ConceptNode
	for _, node := range g.Nodes {
		if len(node.Outbound) == 0 && len(node.Inbound) == 0 {
			orphans = append(orphans, node)
		}
	}
	return orphans
}
