package gldr

import (
	"reflect"
	"testing"
)

func TestGLDR_DetectCommunities(t *testing.T) {
	idx := NewGLDR(DefaultGLDRConfig())

	// Graph topology:
	// Cluster A: Alice, Bob, Charlie (completely connected to each other)
	// Cluster B: Dave, Eve, Frank (completely connected to each other)
	// Bridge: Charlie <-> Dave (weak connection)

	// Cluster A
	idx.AddGraphEdgeBidirectional("Alice", "Bob", "knows", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Bob", "Charlie", "knows", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Alice", "Charlie", "knows", 1.0, "explicit")

	// Cluster B
	idx.AddGraphEdgeBidirectional("Dave", "Eve", "knows", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Eve", "Frank", "knows", 1.0, "explicit")
	idx.AddGraphEdgeBidirectional("Dave", "Frank", "knows", 1.0, "explicit")

	// Bridge (weak)
	idx.AddGraphEdgeBidirectional("Charlie", "Dave", "knows", 0.1, "explicit")

	// Unconnected component (Singleton)
	idx.AddGraphEdgeBidirectional("LoneWolf", "LoneWolf", "self", 1.0, "explicit") // self edge to ensure vertex exists
	// Workaround to add a vertex without edges properly in the test if needed, but a self-loop is fine.

	communities := idx.DetectCommunities()

	if len(communities) == 0 {
		t.Fatalf("expected communities, got none")
	}

	// We expect 3 communities: [Alice, Bob, Charlie], [Dave, Eve, Frank], [LoneWolf]
	// Order should be deterministic because it sorts by size then lexicographically.

	expected := [][]string{
		{"Alice", "Bob", "Charlie"},
		{"Dave", "Eve", "Frank"},
		{"LoneWolf"},
	}

	if !reflect.DeepEqual(communities, expected) {
		t.Errorf("expected communities %v, got %v", expected, communities)
	}
}
