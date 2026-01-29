package hierarchy

import "github.com/kittclouds/gokitt/pkg/graph"

// ProvenanceContext carries vault/folder context into projection
type ProvenanceContext struct {
	VaultID    string // Narrative vault ID (Universe)
	WorldID    string // Note ID (World)
	ParentPath string // For debugging / label generation
	FolderType string // Galaxy type (empty = SolarSystem)
}

// WormholeSpec defines a cross-world link input
type WormholeSpec struct {
	SourceWorldID  string
	TargetWorldID  string
	SourceEntityID string // Optional - empty = world-level link
	TargetEntityID string // Optional - empty = world-level link
}

// AddWormholeEdges creates cross-world links in the graph.
// It assumes the relevant World and Entity nodes already exist (or creates them if missing).
func AddWormholeEdges(g *graph.ConceptGraph, specs []WormholeSpec) int {
	added := 0
	for _, spec := range specs {
		// 1. Resolve effective Source ID
		srcID := spec.SourceEntityID
		srcKind := "Entity" // Default
		if srcID == "" {
			srcID = "world:" + spec.SourceWorldID
			srcKind = graph.KindWorld
		}

		// 2. Resolve effective Target ID
		tgtID := spec.TargetEntityID
		tgtKind := "Entity"
		if tgtID == "" {
			tgtID = "world:" + spec.TargetWorldID
			tgtKind = graph.KindWorld
		}

		// 3. Ensure nodes exist (even if just placeholders)
		// Usually these should exist from prior projection, but for robustness we ensure them.
		g.EnsureNode(srcID, srcID, srcKind)
		g.EnsureNode(tgtID, tgtID, tgtKind)

		// 4. Add the Golden Spike!
		edge := &graph.ConceptEdge{
			Relation: graph.RelWormhole,
			Weight:   1.0,
			// Wormholes are "outside time/space" - no doc span
		}

		// Use low-level AddEdge to avoid QuadPlus complexity for simple links
		srcNode := g.GetNode(srcID)
		tgtNode := g.GetNode(tgtID)
		g.AddEdge(srcNode, tgtNode, edge)

		added++
	}
	return added
}
