package merger

import (
	"fmt"
	"strings"

	"github.com/kittclouds/gokitt/pkg/graph"
	"github.com/kittclouds/gokitt/pkg/reality/pcst"
)

// Provenance indicates where an edge came from
type Provenance string

const (
	ProvenanceScanner Provenance = "scanner" // Go CST projection
	ProvenanceLLM     Provenance = "llm"     // LLM extraction
	ProvenanceManual  Provenance = "manual"  // User-created
)

// MergedEdge represents an edge with combined metadata from multiple sources
type MergedEdge struct {
	SourceID    string         `json:"sourceId"`
	TargetID    string         `json:"targetId"`
	RelType     string         `json:"relType"`
	Confidence  float64        `json:"confidence"`
	Provenances []Provenance   `json:"provenances"` // Can have multiple sources
	Attributes  map[string]any `json:"attributes,omitempty"`
	SourceNotes []string       `json:"sourceNotes,omitempty"` // Which notes this edge came from
}

// MergedGraph is the combined graph from all sources
type MergedGraph struct {
	Nodes map[string]*graph.ConceptNode `json:"nodes"`
	Edges map[string]*MergedEdge        `json:"edges"` // Key: sourceId-relType-targetId
}

// MergeResult contains stats about the merge operation
type MergeResult struct {
	TotalEdges        int `json:"totalEdges"`
	ScannerEdges      int `json:"scannerEdges"`
	LLMEdges          int `json:"llmEdges"`
	ManualEdges       int `json:"manualEdges"`
	DeduplicatedEdges int `json:"deduplicatedEdges"`
}

// Merger combines edges from multiple sources
type Merger struct {
	merged *MergedGraph
}

// New creates a new Merger
func New() *Merger {
	return &Merger{
		merged: &MergedGraph{
			Nodes: make(map[string]*graph.ConceptNode),
			Edges: make(map[string]*MergedEdge),
		},
	}
}

// edgeKey generates a unique key for deduplication
func edgeKey(sourceID, targetID, relType string) string {
	// Normalize: always use smaller ID first for undirected comparison
	// But keep direction for directed edges (most relationship edges ARE directed)
	return fmt.Sprintf("%s-%s-%s", sourceID, strings.ToUpper(relType), targetID)
}

// AddScannerGraph adds edges from the Go CST scanner/projection
func (m *Merger) AddScannerGraph(g *graph.ConceptGraph, sourceNoteID string) int {
	added := 0

	// Add nodes
	for _, node := range g.AllNodes() {
		if _, exists := m.merged.Nodes[node.ID]; !exists {
			m.merged.Nodes[node.ID] = node
		}
	}

	// Add edges
	for _, edge := range g.AllEdges() {
		key := edgeKey(edge.Source.ID, edge.Target.ID, string(edge.Edge.Relation))

		if existing, exists := m.merged.Edges[key]; exists {
			// Merge: add provenance, update confidence
			existing.Provenances = appendUnique(existing.Provenances, ProvenanceScanner)
			if sourceNoteID != "" {
				existing.SourceNotes = appendUniqueStr(existing.SourceNotes, sourceNoteID)
			}
			// Boost confidence when multiple sources agree
			existing.Confidence = boostConfidence(existing.Confidence, edge.Edge.Weight)
		} else {
			// New edge
			notes := []string{}
			if sourceNoteID != "" {
				notes = append(notes, sourceNoteID)
			}
			m.merged.Edges[key] = &MergedEdge{
				SourceID:    edge.Source.ID,
				TargetID:    edge.Target.ID,
				RelType:     string(edge.Edge.Relation),
				Confidence:  edge.Edge.Weight,
				Provenances: []Provenance{ProvenanceScanner},
				SourceNotes: notes,
			}
			added++
		}
	}

	return added
}

// LLMEdgeInput is the structure for LLM-extracted edges
type LLMEdgeInput struct {
	SourceID     string         `json:"sourceId"`
	TargetID     string         `json:"targetId"`
	RelType      string         `json:"relType"`
	Confidence   float64        `json:"confidence"`
	Attributes   map[string]any `json:"attributes,omitempty"`
	SourceNoteID string         `json:"sourceNoteId"`
}

// AddLLMEdges adds edges from LLM extraction
func (m *Merger) AddLLMEdges(edges []LLMEdgeInput) int {
	added := 0

	for _, e := range edges {
		key := edgeKey(e.SourceID, e.TargetID, e.RelType)

		if existing, exists := m.merged.Edges[key]; exists {
			// Merge
			existing.Provenances = appendUnique(existing.Provenances, ProvenanceLLM)
			if e.SourceNoteID != "" {
				existing.SourceNotes = appendUniqueStr(existing.SourceNotes, e.SourceNoteID)
			}
			existing.Confidence = boostConfidence(existing.Confidence, e.Confidence)
			// Merge attributes
			if existing.Attributes == nil {
				existing.Attributes = make(map[string]any)
			}
			for k, v := range e.Attributes {
				if _, ok := existing.Attributes[k]; !ok {
					existing.Attributes[k] = v
				}
			}
		} else {
			notes := []string{}
			if e.SourceNoteID != "" {
				notes = append(notes, e.SourceNoteID)
			}
			m.merged.Edges[key] = &MergedEdge{
				SourceID:    e.SourceID,
				TargetID:    e.TargetID,
				RelType:     e.RelType,
				Confidence:  e.Confidence,
				Provenances: []Provenance{ProvenanceLLM},
				Attributes:  e.Attributes,
				SourceNotes: notes,
			}
			added++
		}
	}

	return added
}

// ManualEdgeInput is the structure for manually created edges
type ManualEdgeInput struct {
	SourceID   string         `json:"sourceId"`
	TargetID   string         `json:"targetId"`
	RelType    string         `json:"relType"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

// AddManualEdges adds user-created edges (always high confidence)
func (m *Merger) AddManualEdges(edges []ManualEdgeInput) int {
	added := 0

	for _, e := range edges {
		key := edgeKey(e.SourceID, e.TargetID, e.RelType)

		if existing, exists := m.merged.Edges[key]; exists {
			// Manual always wins for confidence
			existing.Provenances = appendUnique(existing.Provenances, ProvenanceManual)
			existing.Confidence = 1.0 // Manual = certain
			if existing.Attributes == nil {
				existing.Attributes = make(map[string]any)
			}
			for k, v := range e.Attributes {
				existing.Attributes[k] = v
			}
		} else {
			m.merged.Edges[key] = &MergedEdge{
				SourceID:    e.SourceID,
				TargetID:    e.TargetID,
				RelType:     e.RelType,
				Confidence:  1.0, // Manual = certain
				Provenances: []Provenance{ProvenanceManual},
				Attributes:  e.Attributes,
			}
			added++
		}
	}

	return added
}

// GetMergedGraph returns the combined graph
func (m *Merger) GetMergedGraph() *MergedGraph {
	return m.merged
}

// GetStats returns merge statistics
func (m *Merger) GetStats() MergeResult {
	result := MergeResult{
		TotalEdges: len(m.merged.Edges),
	}

	for _, edge := range m.merged.Edges {
		for _, prov := range edge.Provenances {
			switch prov {
			case ProvenanceScanner:
				result.ScannerEdges++
			case ProvenanceLLM:
				result.LLMEdges++
			case ProvenanceManual:
				result.ManualEdges++
			}
		}
		if len(edge.Provenances) > 1 {
			result.DeduplicatedEdges++
		}
	}

	return result
}

// ToConceptGraph converts merged graph to a ConceptGraph for PCST
func (m *Merger) ToConceptGraph() *graph.ConceptGraph {
	g := graph.NewGraph()

	// Add nodes
	for id, node := range m.merged.Nodes {
		g.EnsureNode(id, node.Label, node.Kind)
	}

	// Add edges
	for _, edge := range m.merged.Edges {
		source, _ := g.Nodes[edge.SourceID]
		target, _ := g.Nodes[edge.TargetID]

		if source == nil || target == nil {
			// Create placeholder nodes if needed
			if source == nil {
				source = g.EnsureNode(edge.SourceID, edge.SourceID, graph.KindConcept)
			}
			if target == nil {
				target = g.EnsureNode(edge.TargetID, edge.TargetID, graph.KindConcept)
			}
		}

		// Weight = 1 - confidence (PCST uses cost, lower is better)
		weight := 1.0 - edge.Confidence
		if weight < 0.01 {
			weight = 0.01 // Minimum cost
		}

		g.AddEdge(source, target, &graph.ConceptEdge{
			Relation: edge.RelType,
			Weight:   weight,
		})
	}

	return g
}

// RunPCST runs the PCST algorithm on the merged graph
// prizes: map of nodeID -> prize (importance)
// rootID: optional root node for the tree
// Returns the filtered subgraph
func (m *Merger) RunPCST(prizes map[string]float64, rootID string) (*MergedGraph, error) {
	g := m.ToConceptGraph()

	solver := pcst.NewIpcstSolver(pcst.DefaultConfig())
	solution, err := solver.Solve(g, prizes, rootID)
	if err != nil {
		return nil, err
	}

	// Build filtered graph from solution
	filtered := &MergedGraph{
		Nodes: make(map[string]*graph.ConceptNode),
		Edges: make(map[string]*MergedEdge),
	}

	// Add solution nodes
	nodeSet := make(map[string]bool)
	for _, nodeID := range solution.Nodes {
		nodeSet[nodeID] = true
		if node, ok := m.merged.Nodes[nodeID]; ok {
			filtered.Nodes[nodeID] = node
		}
	}

	// Add solution edges
	for _, edge := range solution.Edges {
		// Find matching edge in merged graph
		for key, mergedEdge := range m.merged.Edges {
			if (mergedEdge.SourceID == edge.SourceID && mergedEdge.TargetID == edge.TargetID) ||
				(mergedEdge.SourceID == edge.TargetID && mergedEdge.TargetID == edge.SourceID) {
				filtered.Edges[key] = mergedEdge
				break
			}
		}
	}

	return filtered, nil
}

// Helper functions

func boostConfidence(existing, new float64) float64 {
	// When multiple sources agree, boost confidence
	// Formula: 1 - (1-a)(1-b) = a + b - ab
	combined := existing + new - (existing * new)
	if combined > 1.0 {
		combined = 1.0
	}
	return combined
}

func appendUnique(slice []Provenance, p Provenance) []Provenance {
	for _, existing := range slice {
		if existing == p {
			return slice
		}
	}
	return append(slice, p)
}

func appendUniqueStr(slice []string, s string) []string {
	for _, existing := range slice {
		if existing == s {
			return slice
		}
	}
	return append(slice, s)
}
