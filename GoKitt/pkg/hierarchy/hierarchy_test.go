package hierarchy

import (
	"testing"

	"github.com/kittclouds/gokitt/pkg/graph"
)

func TestAddWormholeEdges(t *testing.T) {
	g := graph.NewGraph()

	// Pre-populate some entities (simulation of existing graph)
	g.EnsureNode("entity:frodo", "Frodo", "CHARACTER")
	g.EnsureNode("entity:sam", "Sam", "CHARACTER")

	specs := []WormholeSpec{
		{
			// Explicit Entity -> Entity
			SourceEntityID: "entity:frodo",
			TargetEntityID: "entity:sam",
		},
		{
			// World -> World (implicit entities created)
			SourceWorldID: "note-1",
			TargetWorldID: "note-2",
		},
		{
			// Mixed: World -> Entity
			SourceWorldID:  "note-1",
			TargetEntityID: "entity:frodo",
		},
	}

	count := AddWormholeEdges(g, specs)

	if count != 3 {
		t.Errorf("Expected 3 wormholes, got %d", count)
	}

	// Verify World nodes were created
	if g.GetNode("world:note-1") == nil {
		t.Error("world:note-1 should have been created")
	}
	if g.GetNode("world:note-2") == nil {
		t.Error("world:note-2 should have been created")
	}

	// Verify edges
	frodo := g.GetNode("entity:frodo")
	found := false
	for _, edge := range frodo.Outbound {
		if edge.Target.ID == "entity:sam" && edge.Relation == graph.RelWormhole {
			found = true
			break
		}
	}
	if !found {
		t.Error("Missing wormhole edge from Frodo -> Sam")
	}
}
