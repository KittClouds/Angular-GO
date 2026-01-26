package graph

import "testing"

func TestGraphBasics(t *testing.T) {
	g := NewGraph()

	// Add nodes
	g.EnsureNode("frodo", "Frodo Baggins", "CHARACTER")
	g.EnsureNode("sam", "Samwise Gamgee", "CHARACTER")
	g.EnsureNode("shire", "The Shire", "PLACE")

	if g.NodeCount() != 3 {
		t.Errorf("NodeCount = %d, want 3", g.NodeCount())
	}

	// Add edges
	g.AddEdgeWithNodes(
		"frodo", "Frodo Baggins", "CHARACTER",
		"sam", "Samwise Gamgee", "CHARACTER",
		"friend_of", 1.0,
	)
	g.AddEdgeWithNodes(
		"frodo", "Frodo Baggins", "CHARACTER",
		"shire", "The Shire", "PLACE",
		"lives_in", 1.0,
	)

	if g.EdgeCount() != 2 {
		t.Errorf("EdgeCount = %d, want 2", g.EdgeCount())
	}

	// Query neighbors
	neighbors := g.Neighbors("frodo")
	if len(neighbors) != 2 {
		t.Errorf("Frodo neighbors = %d, want 2", len(neighbors))
	}
}

func TestOutgoingIncoming(t *testing.T) {
	g := NewGraph()

	g.EnsureNode("gandalf", "Gandalf", "CHARACTER")
	g.EnsureNode("sauron", "Sauron", "CHARACTER")

	g.AddEdge("gandalf", "sauron", &ConceptEdge{
		Relation: "DEFEATED",
		Weight:   1.0,
	})

	outgoing := g.OutgoingEdges("gandalf")
	if len(outgoing) != 1 {
		t.Errorf("Gandalf outgoing = %d, want 1", len(outgoing))
	}
	if outgoing[0].Edge.Relation != "DEFEATED" {
		t.Errorf("Relation = %s, want DEFEATED", outgoing[0].Edge.Relation)
	}

	incoming := g.IncomingEdges("sauron")
	if len(incoming) != 1 {
		t.Errorf("Sauron incoming = %d, want 1", len(incoming))
	}
}

func TestOrphanNodes(t *testing.T) {
	g := NewGraph()

	g.EnsureNode("connected", "Connected", "TEST")
	g.EnsureNode("orphan", "Orphan", "TEST")
	g.EnsureNode("target", "Target", "TEST")

	g.AddEdge("connected", "target", &ConceptEdge{Relation: "LINKS"})

	orphans := g.OrphanNodes()
	if len(orphans) != 1 {
		t.Errorf("Orphan count = %d, want 1", len(orphans))
	}
	if orphans[0].ID != "orphan" {
		t.Errorf("Orphan ID = %s, want 'orphan'", orphans[0].ID)
	}
}

func TestDegreeCentrality(t *testing.T) {
	g := NewGraph()

	g.EnsureNode("hub", "Hub", "TEST")
	g.EnsureNode("a", "A", "TEST")
	g.EnsureNode("b", "B", "TEST")
	g.EnsureNode("c", "C", "TEST")

	// Hub connects to all
	g.AddEdge("hub", "a", &ConceptEdge{Relation: "LINKS"})
	g.AddEdge("hub", "b", &ConceptEdge{Relation: "LINKS"})
	g.AddEdge("hub", "c", &ConceptEdge{Relation: "LINKS"})

	centrality := g.DegreeCentrality()

	// Hub should have highest centrality
	if centrality["hub"] <= centrality["a"] {
		t.Error("Hub should have higher centrality than leaf nodes")
	}
}
